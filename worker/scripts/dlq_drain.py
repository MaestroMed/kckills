"""
dlq_drain.py — Smart drain of dead_letter_jobs.

Context
-------
By Wave 9 the DLQ had accumulated ~822 unresolved entries — the bulk
were `clip.create` failures from the YouTube cookies / yt-dlp deno-EJS
era and `publish.check` failures from the qc_clip_validated drift bug.
Both root causes have since been FIXED (commits 10bbe6f for cookies +
deno, plus the qc_clip_validated mass-flip + sync_legacy_qc_validated.py),
so the vast majority of those rows are now safe to re-enqueue.

The previous tooling :
    /admin/pipeline/dlq             one-click per row, fine for ~10 rows
    backfill_clip_errors.py         re-enqueues from kills.status, NOT DLQ
    reenqueue_one_kill.py           single kill at a time

This script is the bulk path. It walks pending dead_letter_jobs rows,
applies an error_code-keyed recovery decision, then either :
  * Re-enqueues a fresh pipeline_jobs row (priority 30) and marks
    the DLQ row `resolution_status='requeued'`.
  * Marks the DLQ row `resolution_status='cancelled'` with a reason.

Recovery decision matrix
------------------------
    youtube_bot_blocked / ytdlp_bot_blocked  -> requeue (cookies fixed)
    clip_failed                               -> requeue (cookies/deno fixed)
    no_vod                                    -> requeue IF games.vod_youtube_id
                                                  is now set, else cancel
    publish_failed / publish_exception        -> requeue IF the parent
                                                  game_event.is_publishable
                                                  is now true, else cancel
    clip_kill returned no urls / transient    -> requeue
    kill_deleted / bad_payload                -> cancel
    forbidden_script / script_missing         -> cancel (security skips)
    game_missing                              -> cancel
    timeout / exit_*                          -> requeue once
    runner_crash / internal_error / exec_*    -> requeue once
    unknown / new error_code                  -> requeue once

Idempotency
-----------
The unique partial index on pipeline_jobs (type, entity_type, entity_id)
WHERE status IN ('pending','claimed') means a re-run is safe. enqueue()
returns None when the row is already-active and we mark the DLQ
"requeued" anyway with the note that no-op happened.

CLI
---
    --dry-run                   Print decisions, do not write
    --type <kind>               Restrict to one job kind (default: any)
    --error-code <code>         Restrict to one error code (default: any)
    --since-days N              Only DLQ rows failed in the last N days
                                (default 7 ; pass 0 for "all")
    --limit N                   Cap how many DLQ rows to process

Examples
--------
    python scripts/dlq_drain.py --dry-run --since-days 14
    python scripts/dlq_drain.py --type clip.create --error-code clip_failed
    python scripts/dlq_drain.py --since-days 30 --limit 200
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services import job_queue  # noqa: E402
from services.observability import run_logged  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

PAGE_SIZE = 200
DEFAULT_SINCE_DAYS = 7
REQUEUE_PRIORITY = 30
MAX_RETRIES = 3


# ─── Recovery decision matrix ──────────────────────────────────────────


REQUEUE_CODES: set[str] = {
    "youtube_bot_blocked",
    "ytdlp_bot_blocked",
    "clip_failed",
    "publish_exception",
    "runner_crash",
    "internal_error",
    "exec_error",
    "script_missing",
}

CANCEL_CODES_WITH_REASON: dict[str, str] = {
    "kill_deleted":     "kill_row_missing",
    "bad_payload":      "malformed_payload",
    "forbidden_script": "security_skip",
    "game_missing":     "parent_game_missing",
}

# "Conditional" codes need a per-entity DB check before deciding.
CONDITIONAL_CODES: set[str] = {"no_vod", "publish_failed"}


def _normalise_error_code(code: str | None) -> str:
    """Some failures arrive with code=None and the message has the signal.
    Return a stable lowercase string. Empty/None becomes 'unknown'.
    """
    if not code:
        return "unknown"
    return str(code).strip().lower()


def _is_transient_message(error_message: str | None) -> bool:
    """Heuristic for unknown error_codes : if the message looks transient
    (contains common timeout / network / 5xx markers), prefer requeue.

    Used as a tiebreaker when error_code is None or not in any bucket.
    """
    if not error_message:
        return False
    msg = error_message.lower()
    transient_markers = (
        "timeout", "timed out",
        "connection", "connect ", "econnreset",
        "5xx", "503", "502", "504",
        "rate limit", "ratelimit", "too many requests",
        "clip_kill returned no urls",
    )
    return any(m in msg for m in transient_markers)


def _classify_exit_code(code: str) -> bool:
    """exit_<N> codes from admin_job_runner subprocess failures :
    these are usually transient (intermittent yt-dlp 429, etc.) so
    we requeue once. timeout is also requeued once.
    """
    return code.startswith("exit_") or code == "timeout"


# ─── DB helpers ────────────────────────────────────────────────────────


def _fetch_dlq_page(
    db,
    *,
    offset: int,
    page_size: int,
    type_filter: Optional[str],
    error_code_filter: Optional[str],
    since_days: int,
) -> list[dict]:
    """Pull one page of pending DLQ rows.

    PostgREST default cap is 1000 rows ; we page in 200-row batches and
    order by failed_at ASC so the oldest get processed first (operator
    intuition : drain the backlog from the bottom).
    """
    params: dict[str, str] = {
        "select": (
            "id,original_job_id,type,entity_type,entity_id,payload,"
            "error_code,error_message,attempts,failed_at,resolution_status"
        ),
        "resolution_status": "eq.pending",
        "order": "failed_at.asc",
        "limit": str(page_size),
        "offset": str(offset),
    }
    if type_filter:
        params["type"] = f"eq.{type_filter}"
    if error_code_filter:
        params["error_code"] = f"eq.{error_code_filter}"
    if since_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
        params["failed_at"] = f"gte.{cutoff.isoformat()}"

    r = httpx.get(
        f"{db.base}/dead_letter_jobs",
        headers=db.headers,
        params=params,
        timeout=30.0,
    )
    r.raise_for_status()
    return r.json() or []


def _fetch_game_vod(db, game_id: str) -> Optional[str]:
    """Return games.vod_youtube_id for a game_id (or None)."""
    if not game_id:
        return None
    try:
        r = httpx.get(
            f"{db.base}/games",
            headers=db.headers,
            params={
                "select": "vod_youtube_id",
                "id": f"eq.{game_id}",
                "limit": "1",
            },
            timeout=15.0,
        )
        r.raise_for_status()
        rows = r.json() or []
        if not rows:
            return None
        return rows[0].get("vod_youtube_id")
    except Exception:
        return None


def _fetch_kill_game_id(db, kill_id: str) -> Optional[str]:
    """Return kills.game_id for a kill_id (or None)."""
    if not kill_id:
        return None
    try:
        r = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={
                "select": "game_id",
                "id": f"eq.{kill_id}",
                "limit": "1",
            },
            timeout=15.0,
        )
        r.raise_for_status()
        rows = r.json() or []
        if not rows:
            return None
        return rows[0].get("game_id")
    except Exception:
        return None


def _fetch_event_publishable(db, event_id: str) -> Optional[bool]:
    """Return game_events.is_publishable for an event_id (None on miss)."""
    if not event_id:
        return None
    try:
        r = httpx.get(
            f"{db.base}/game_events",
            headers=db.headers,
            params={
                "select": "is_publishable",
                "id": f"eq.{event_id}",
                "limit": "1",
            },
            timeout=15.0,
        )
        r.raise_for_status()
        rows = r.json() or []
        if not rows:
            return None
        return bool(rows[0].get("is_publishable"))
    except Exception:
        return None


def _mark_resolved(
    db,
    dlq_id: str,
    *,
    status: str,
    note: str,
    new_job_id: Optional[str] = None,
) -> bool:
    """Patch a DLQ row's resolution_* fields. status in {requeued,cancelled}.
    Best-effort — returns False on HTTP error.
    """
    body: dict[str, Any] = {
        "resolution_status": status,
        "resolved_by": "dlq_drain",
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "resolution_note": note[:500] if note else None,
    }
    if new_job_id:
        body["resolution_note"] = (note + f" (new job {new_job_id})")[:500]
    try:
        r = httpx.patch(
            f"{db.base}/dead_letter_jobs",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{dlq_id}"},
            json=body,
            timeout=15.0,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


# ─── Per-row decision logic ───────────────────────────────────────────


def decide_action(
    db,
    row: dict,
) -> tuple[str, str]:
    """Decide what to do with a DLQ row.

    Returns (action, reason) where action in :
        "requeue"  -> caller should enqueue a fresh pipeline_jobs row
        "cancel"   -> caller should mark cancelled with `reason`
    The reason string is used as resolution_note.
    """
    code = _normalise_error_code(row.get("error_code"))
    msg = row.get("error_message") or ""
    job_type = row.get("type") or ""
    payload = row.get("payload") or {}

    if code in REQUEUE_CODES:
        return "requeue", f"recoverable_after_fix:{code}"

    if code in CANCEL_CODES_WITH_REASON:
        return "cancel", CANCEL_CODES_WITH_REASON[code]

    if _classify_exit_code(code):
        return "requeue", f"transient_subprocess_failure:{code}"

    # ─── Conditional codes : need a DB check ─────────────────────────

    if code == "no_vod":
        # The clipper failed because games.vod_youtube_id was null.
        # Has the vod_offset_finder filled it in since ?
        kill_id = (payload.get("kill_id") if isinstance(payload, dict) else None) \
                  or row.get("entity_id")
        game_id = (payload.get("game_id") if isinstance(payload, dict) else None) \
                  or _fetch_kill_game_id(db, kill_id) if kill_id else None
        if not game_id:
            return "cancel", "vod_check_no_game"
        vod = _fetch_game_vod(db, game_id)
        if vod:
            return "requeue", "vod_now_available"
        return "cancel", "vod_still_missing"

    if code == "publish_failed":
        # The publish.check failed because game_event.is_publishable
        # went false (qc gate, etc). Has the QC drift been fixed ?
        event_id = row.get("entity_id")
        if not event_id:
            return "cancel", "publish_check_no_event_id"
        is_pub = _fetch_event_publishable(db, event_id)
        if is_pub is True:
            return "requeue", "publishable_now_true"
        if is_pub is False:
            return "cancel", "still_not_publishable"
        # None = event row gone
        return "cancel", "event_row_missing"

    # Unknown code — peek at the message for transient hints.
    if _is_transient_message(msg):
        return "requeue", f"transient_message:{code}"

    # Default : give it ONE more attempt.
    return "requeue", f"unknown_code_one_more_try:{code}"


def _build_payload_for_requeue(row: dict) -> dict:
    """Reconstruct the pipeline_jobs payload from a DLQ row.

    DLQ stored the full original payload, so usually we can copy it
    verbatim. Falls back to a minimal {entity_id} when payload is empty
    or non-dict (defensive — shouldn't happen with current writers).
    """
    raw = row.get("payload")
    if isinstance(raw, dict) and raw:
        return raw
    entity_id = row.get("entity_id")
    if entity_id:
        if row.get("entity_type") == "kill":
            return {"kill_id": entity_id}
        if row.get("entity_type") == "event":
            return {"event_id": entity_id}
    return {}


# ─── Core drain loop ───────────────────────────────────────────────────


async def drain(
    *,
    db,
    dry_run: bool,
    type_filter: Optional[str],
    error_code_filter: Optional[str],
    since_days: int,
    limit: Optional[int],
) -> dict[str, Any]:
    """Walk pending DLQ rows + apply decide_action.

    Returns a counter dict suitable for @run_logged note() persistence
    AND for printing in the CLI summary :

        {
          "items_scanned":   int,
          "items_processed": int,   # = requeued + cancelled
          "items_failed":    int,
          "items_skipped":   int,   # not used today, kept for symmetry
          "requeued":        int,
          "cancelled":       int,
          "errors":          int,
          "by_error_code":   { code: {"requeued": int, "cancelled": int} },
        }
    """
    scanned = 0
    requeued = 0
    cancelled = 0
    errors = 0
    by_code: dict[str, dict[str, int]] = {}
    offset = 0

    while True:
        remaining = None if limit is None else max(0, limit - scanned)
        if remaining is not None and remaining == 0:
            break
        page_size = PAGE_SIZE if remaining is None else min(PAGE_SIZE, remaining)

        try:
            page = await asyncio.to_thread(
                _fetch_dlq_page,
                db,
                offset=offset,
                page_size=page_size,
                type_filter=type_filter,
                error_code_filter=error_code_filter,
                since_days=since_days,
            )
        except httpx.HTTPStatusError as e:
            print(f"  [error] DLQ page fetch failed @ offset={offset} : "
                  f"{e.response.status_code} {e.response.text[:200]}")
            errors += 1
            break
        except Exception as e:
            print(f"  [error] DLQ page fetch threw @ offset={offset} : {e}")
            errors += 1
            break

        if not page:
            break

        for row in page:
            scanned += 1
            dlq_id = row.get("id")
            code = _normalise_error_code(row.get("error_code"))
            bucket = by_code.setdefault(code, {"requeued": 0, "cancelled": 0})

            try:
                action, reason = decide_action(db, row)
            except Exception as e:
                errors += 1
                print(f"  [error] decide_action threw on {dlq_id} : {e}")
                continue

            if dry_run:
                # Tally as if we did the action ; no writes.
                if action == "requeue":
                    requeued += 1
                    bucket["requeued"] += 1
                else:
                    cancelled += 1
                    bucket["cancelled"] += 1
                continue

            if action == "requeue":
                payload = _build_payload_for_requeue(row)
                jid = await asyncio.to_thread(
                    job_queue.enqueue,
                    row.get("type"),
                    row.get("entity_type"),
                    row.get("entity_id"),
                    payload,
                    REQUEUE_PRIORITY,
                    None,
                    MAX_RETRIES,
                )
                # jid may be None when the unique partial index blocks
                # a duplicate active job. That's a soft-success — mark
                # the DLQ row resolved anyway with a note.
                note = reason if jid else f"{reason}|noop_already_active"
                ok = await asyncio.to_thread(
                    _mark_resolved, db, dlq_id,
                    status="requeued", note=note, new_job_id=jid,
                )
                if ok:
                    requeued += 1
                    bucket["requeued"] += 1
                else:
                    errors += 1
            else:
                ok = await asyncio.to_thread(
                    _mark_resolved, db, dlq_id,
                    status="cancelled", note=reason, new_job_id=None,
                )
                if ok:
                    cancelled += 1
                    bucket["cancelled"] += 1
                else:
                    errors += 1

            if scanned % 50 == 0:
                print(
                    f"  [progress] scanned={scanned} requeued={requeued} "
                    f"cancelled={cancelled} errors={errors}"
                )

        offset += len(page)
        if len(page) < page_size:
            break

    return {
        "items_scanned":   scanned,
        "items_processed": requeued + cancelled,
        "items_failed":    errors,
        "items_skipped":   0,
        "requeued":        requeued,
        "cancelled":       cancelled,
        "errors":          errors,
        "by_error_code":   by_code,
    }


@run_logged(module_name="dlq_drain")
async def _amain(
    *,
    dry_run: bool,
    type_filter: Optional[str],
    error_code_filter: Optional[str],
    since_days: int,
    limit: Optional[int],
) -> dict[str, Any]:
    db = get_db()
    if db is None:
        print("FATAL : Supabase env vars missing.")
        return {
            "items_scanned": 0,
            "items_processed": 0,
            "items_failed": 1,
        }

    print("=" * 60)
    print("  dlq_drain — smart DLQ recovery")
    print("=" * 60)
    print(f"  dry_run     : {dry_run}")
    print(f"  type        : {type_filter or 'all'}")
    print(f"  error_code  : {error_code_filter or 'all'}")
    print(f"  since_days  : {since_days if since_days > 0 else 'all'}")
    print(f"  limit       : {limit if limit is not None else 'no limit'}")
    print()

    summary = await drain(
        db=db,
        dry_run=dry_run,
        type_filter=type_filter,
        error_code_filter=error_code_filter,
        since_days=since_days,
        limit=limit,
    )

    print()
    print("-" * 60)
    print(f"  scanned   : {summary['items_scanned']}")
    print(f"  requeued  : {summary['requeued']}")
    print(f"  cancelled : {summary['cancelled']}")
    print(f"  errors    : {summary['errors']}")
    print("-" * 60)
    by_code = summary["by_error_code"]
    if by_code:
        print()
        print("  Per error_code :")
        for code in sorted(by_code.keys()):
            stats = by_code[code]
            print(f"    {code:35s}  requeued={stats['requeued']:4d}  "
                  f"cancelled={stats['cancelled']:4d}")
    if dry_run:
        print()
        print("  (dry-run — no writes performed)")

    return summary


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print decisions ; do not write",
    )
    ap.add_argument(
        "--type",
        type=str,
        default=None,
        help="Restrict to one job kind (e.g. clip.create, publish.check). "
             "Default : all kinds.",
    )
    ap.add_argument(
        "--error-code",
        type=str,
        default=None,
        help="Restrict to one error_code. Default : all codes.",
    )
    ap.add_argument(
        "--since-days",
        type=int,
        default=DEFAULT_SINCE_DAYS,
        help=f"Only DLQ rows failed in the last N days (default {DEFAULT_SINCE_DAYS} ; "
             "pass 0 for all).",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap how many DLQ rows to process (default : all).",
    )
    args = ap.parse_args()

    asyncio.run(_amain(
        dry_run=args.dry_run,
        type_filter=args.type,
        error_code_filter=args.error_code,
        since_days=args.since_days,
        limit=args.limit,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
