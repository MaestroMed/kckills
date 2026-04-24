"""
backfill_stuck_pipeline.py — Re-enqueue kills stuck mid-pipeline.

Context
-------
Wave 3 Agent N already shipped backfill_clip_errors.py for the
'clip_error' state. This script handles the OTHER stuck states that
accumulated during the legacy polling era and the various outages
(yt-dlp throttles, Gemini quota exhaustion, NVENC bugs pre-PR23.7,
event_publisher race conditions, etc.) :

  vod_found      -> enqueue clip.create   (clipper picks it up)
  clipped        -> enqueue clip.analyze  (analyzer picks it up)
  analyzed       -> enqueue publish.check (event_publisher promotes it)
  manual_review  -> enqueue clip.create with priority 30
                    (lower than score-based defaults — these are flagged
                    rows so we re-attempt politely, not aggressively)

For 'manual_review' specifically we ALSO check qc_status : if QC
explicitly killed a row (qc_status in {'failed', 'rejected'}), we skip.
The 'rejected' value is checked defensively even though the current
schema only allows {'pending','passed','failed','human_review'} —
forward-compat for any future QC pipeline that introduces an explicit
rejection state.

Same pagination + idempotency pattern as backfill_clip_errors.py :
  * 500-row pages via PostgREST limit/offset
  * `--since DAYS` filter (default 90) on created_at to avoid pulling
    ancient rows we've definitively given up on
  * `--limit N` caps total processed across all pages
  * `--min-score F` filters by highlight_score (most useful for the
    'analyzed' / 'clipped' states where we want to surface the best
    clips first)
  * Status reset AFTER successful enqueue, idempotent on the unique
    partial index (type, entity_type, entity_id) WHERE status IN
    ('pending','claimed') — re-runs are harmless

CLI
---
    --state {manual_review|vod_found|clipped|analyzed|all}   required
    --dry-run        Count only ; no writes
    --limit N        Cap how many to process (default : all)
    --min-score F    Only re-enqueue clips with highlight_score >= F
    --since DAYS     Only kills created in the last N days (default 90)

Examples
--------
    # See what's stuck in each bucket without writing :
    python scripts/backfill_stuck_pipeline.py --state all --dry-run

    # Push all stuck-at-analyzed kills (publisher race) to publish.check
    python scripts/backfill_stuck_pipeline.py --state analyzed

    # Manual-review re-attempt — only kills from the last 30d, top quality
    python scripts/backfill_stuck_pipeline.py --state manual_review \
        --since 30 --min-score 6.0
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services import job_queue  # noqa: E402
from services.observability import run_logged  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

# ─── Constants ────────────────────────────────────────────────────────

PAGE_SIZE = 500
MAX_RETRIES = 3
DEFAULT_SINCE_DAYS = 90

# Per-state config :
#   job_type        — pipeline_jobs.type to enqueue
#   entity_type     — usually "kill" but "publish.check" needs "event"
#                     when fed via game_events. We keep "kill" for the
#                     analyzed-state branch and let the publisher's own
#                     RPC handle the event linkage — matches the legacy
#                     job_dispatcher behaviour.
#   default_priority — fallback priority when score-based isn't appropriate
#   reset_status    — what kills.status to flip the row back to so the
#                     legacy job_dispatcher stops re-bridging it
#
# The reset target is chosen so the dispatcher's bridges don't double-
# enqueue : 'enriched' is invisible to the bridge (which only scans
# vod_found / clipped / analyzed / publishable game_events).
STATE_CONFIG: dict[str, dict] = {
    "manual_review": {
        "job_type": "clip.create",
        "entity_type": "kill",
        "default_priority": 30,  # explicitly low — these were flagged
        "reset_status": "enriched",
        "use_score_priority": False,
    },
    "vod_found": {
        "job_type": "clip.create",
        "entity_type": "kill",
        "default_priority": 50,
        "reset_status": "enriched",
        "use_score_priority": True,
    },
    "clipped": {
        "job_type": "clip.analyze",
        "entity_type": "kill",
        "default_priority": 50,
        # Don't reset — keep status='clipped' so if the analyzer skips
        # for any reason (corrupted clip, dispatcher catches it again,
        # etc.) the bridge can re-queue. The unique index dedupes.
        "reset_status": None,
        "use_score_priority": True,
    },
    "analyzed": {
        "job_type": "publish.check",
        "entity_type": "kill",
        "default_priority": 60,  # publish.check is cheap → push it through
        # Same reasoning : leave at 'analyzed', let the publisher do the
        # status flip when it actually publishes. Aligns with the existing
        # event_publisher behaviour.
        "reset_status": None,
        "use_score_priority": True,
    },
}

# QC verdicts that mean "leave it alone, the human said no". Both legal
# values + the speculative 'rejected' get filtered defensively so a
# future schema bump doesn't silently un-skip these rows.
QC_KILLED_STATES = {"failed", "rejected"}


def _priority_from_score(highlight_score: float | None, default: int = 50) -> int:
    """Map highlight_score (1.0–10.0, may be None) into a queue priority.

    floor(score * 10) yields 10..100 ; with the queue's ORDER BY priority
    DESC NULLS LAST claim ordering, a higher int = sooner. Default 5.0
    when score is None matches backfill_clip_errors.py.
    """
    if highlight_score is None:
        return default
    score = float(highlight_score)
    return int(math.floor(score * 10))


def _since_iso(since_days: int) -> str:
    """Render the cutoff datetime in ISO 8601 for PostgREST `gte` filter."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=int(since_days))
    return cutoff.isoformat()


def _fetch_page(
    db,
    *,
    state: str,
    offset: int,
    page_size: int,
    min_score: float,
    since_iso: str,
) -> list[dict]:
    """Pull one page of stuck kills for the given status.

    Same PostgREST pagination as backfill_clip_errors.py :
      * Order by highlight_score desc + created_at asc so high-quality
        clips reprocess first within the cutoff window
      * Always include qc_status so the manual_review branch can filter
        in-Python (the SQL filter for `not.in.(failed,rejected)` would
        miss NULL rows otherwise — null-safe handling is easier here)
    """
    params: dict[str, str] = {
        "select": (
            "id,game_id,killer_player_id,killer_champion,"
            "victim_player_id,victim_champion,event_epoch,"
            "highlight_score,retry_count,qc_status,created_at"
        ),
        "status": f"eq.{state}",
        "retry_count": f"lt.{MAX_RETRIES}",
        "created_at": f"gte.{since_iso}",
        "order": "highlight_score.desc.nullslast,created_at.asc",
        "limit": str(page_size),
        "offset": str(offset),
    }
    if min_score > 0:
        params["highlight_score"] = f"gte.{min_score}"

    r = httpx.get(
        f"{db.base}/kills",
        headers=db.headers,
        params=params,
        timeout=30.0,
    )
    r.raise_for_status()
    return r.json() or []


def _reset_status(db, kill_id: str, *, target_status: str) -> bool:
    """Flip kill status so the legacy bridge stops re-enqueueing it.

    Mirrors backfill_clip_errors._reset_status — we PATCH after the
    enqueue succeeds. retry_count gets reset too so the next failure
    has a full retry budget. Returns True iff the PATCH returned 2xx.

    When `target_status is None`, this is a no-op (used by the analyzed
    / clipped branches that intentionally leave kills at their current
    status — see STATE_CONFIG comments).
    """
    if target_status is None:
        return True
    try:
        r = httpx.patch(
            f"{db.base}/kills",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{kill_id}"},
            json={"status": target_status, "retry_count": 0},
            timeout=15.0,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


async def _process_state(
    db,
    state: str,
    *,
    dry_run: bool,
    limit: int | None,
    min_score: float,
    since_iso: str,
) -> dict:
    """Drain one stuck-state bucket, returning per-state counters."""
    cfg = STATE_CONFIG[state]
    job_type = cfg["job_type"]
    entity_type = cfg["entity_type"]
    default_priority = cfg["default_priority"]
    reset_status = cfg["reset_status"]
    use_score_priority = cfg["use_score_priority"]

    print(f"\n  -- state='{state}' -> {job_type} (priority "
          f"{'score-based' if use_score_priority else default_priority}) --")

    scanned = 0
    enqueued = 0
    skipped_qc = 0
    skipped_other = 0
    errors = 0
    offset = 0

    while True:
        remaining = None if limit is None else max(0, limit - scanned)
        if remaining is not None and remaining == 0:
            break
        page_size = (
            PAGE_SIZE if remaining is None else min(PAGE_SIZE, remaining)
        )

        try:
            page = await asyncio.to_thread(
                _fetch_page,
                db,
                state=state,
                offset=offset,
                page_size=page_size,
                min_score=min_score,
                since_iso=since_iso,
            )
        except httpx.HTTPStatusError as e:
            print(f"     [error] page fetch @ offset={offset} : "
                  f"{e.response.status_code} {e.response.text[:200]}")
            errors += 1
            break
        except Exception as e:
            print(f"     [error] page fetch threw @ offset={offset} : {e}")
            errors += 1
            break

        if not page:
            break

        for row in page:
            scanned += 1
            kill_id = row.get("id")
            game_id = row.get("game_id")
            score = row.get("highlight_score")
            retry_count = int(row.get("retry_count") or 0)
            qc_status = row.get("qc_status")

            if not kill_id or not game_id:
                skipped_other += 1
                continue
            if retry_count >= MAX_RETRIES:
                skipped_other += 1
                continue

            # qc_status filter — only enforced for manual_review.
            # For other states we trust the pipeline's own logic, since
            # a kill at 'vod_found' that was QC-failed would have been
            # flipped to 'manual_review' already.
            if (
                state == "manual_review"
                and qc_status in QC_KILLED_STATES
            ):
                skipped_qc += 1
                continue

            priority = (
                _priority_from_score(score, default=default_priority)
                if use_score_priority
                else default_priority
            )

            if dry_run:
                enqueued += 1
            else:
                jid = await asyncio.to_thread(
                    job_queue.enqueue,
                    job_type, entity_type, kill_id,
                    {"kill_id": kill_id, "game_id": game_id},
                    priority, None, MAX_RETRIES,
                )
                if jid is None:
                    # Already-active job for this entity (idempotent
                    # no-op) OR enqueue failed. Either way we still try
                    # to flip status so the legacy bridge stops
                    # re-scanning it. Same pattern as backfill_clip_errors.
                    ok = await asyncio.to_thread(
                        _reset_status, db, kill_id,
                        target_status=reset_status,
                    )
                    if ok:
                        skipped_other += 1
                    else:
                        errors += 1
                    continue

                ok = await asyncio.to_thread(
                    _reset_status, db, kill_id,
                    target_status=reset_status,
                )
                if not ok:
                    print(f"     [warn] enqueue ok but status reset failed "
                          f"for {kill_id[:8]}")
                    errors += 1
                    continue

                enqueued += 1

            if scanned % 100 == 0:
                print(f"     [progress] scanned={scanned} enqueued={enqueued} "
                      f"skipped_qc={skipped_qc} skipped_other={skipped_other} "
                      f"errors={errors}")

        offset += len(page)
        if len(page) < page_size:
            break

    print(f"     scanned={scanned} enqueued={enqueued} "
          f"skipped_qc={skipped_qc} skipped_other={skipped_other} "
          f"errors={errors}")

    return {
        "state": state,
        "scanned": scanned,
        "enqueued": enqueued,
        "skipped_qc": skipped_qc,
        "skipped_other": skipped_other,
        "errors": errors,
    }


@run_logged(module_name="backfill_stuck_pipeline")
async def _amain(
    *,
    state: str,
    dry_run: bool,
    limit: int | None,
    min_score: float,
    since_days: int,
) -> dict:
    db = get_db()
    if db is None:
        print("FATAL : Supabase env vars missing.")
        return {"items_scanned": 0, "items_processed": 0, "items_failed": 1}

    if state == "all":
        states = list(STATE_CONFIG.keys())
    else:
        if state not in STATE_CONFIG:
            print(f"FATAL : unknown state '{state}'. "
                  f"Valid : {list(STATE_CONFIG.keys())} or 'all'")
            return {"items_scanned": 0, "items_processed": 0, "items_failed": 1}
        states = [state]

    since_iso = _since_iso(since_days)

    print("=" * 60)
    print("  backfill_stuck_pipeline — re-enqueue mid-pipeline stuck kills")
    print("=" * 60)
    print(f"  state      : {state}")
    print(f"  dry_run    : {dry_run}")
    print(f"  limit      : {limit if limit is not None else 'all'} "
          f"(per-state)")
    print(f"  min_score  : {min_score}")
    print(f"  since      : last {since_days}d (>= {since_iso[:19]})")
    print()

    per_state: list[dict] = []
    for s in states:
        # Limit applies per-state when --state all, otherwise the single
        # state gets the full budget. This avoids the surprising case
        # where --limit 100 with --state all only drains the first state.
        per_state.append(
            await _process_state(
                db, s,
                dry_run=dry_run,
                limit=limit,
                min_score=min_score,
                since_iso=since_iso,
            )
        )

    total_scanned = sum(r["scanned"] for r in per_state)
    total_enqueued = sum(r["enqueued"] for r in per_state)
    total_skipped = sum(
        r["skipped_qc"] + r["skipped_other"] for r in per_state
    )
    total_errors = sum(r["errors"] for r in per_state)

    print()
    print("-" * 60)
    print("  SUMMARY")
    print("-" * 60)
    for r in per_state:
        print(f"  {r['state']:<16} scanned={r['scanned']:>5} "
              f"enqueued={r['enqueued']:>5} "
              f"skipped={r['skipped_qc'] + r['skipped_other']:>5} "
              f"(qc={r['skipped_qc']}, other={r['skipped_other']}) "
              f"errors={r['errors']}")
    print("-" * 60)
    print(f"  TOTAL            scanned={total_scanned:>5} "
          f"enqueued={total_enqueued:>5} "
          f"skipped={total_skipped:>5} "
          f"errors={total_errors}")
    print("-" * 60)
    if dry_run:
        print("  (dry-run — no writes performed)")

    return {
        "items_scanned": total_scanned,
        "items_processed": total_enqueued,
        "items_skipped": total_skipped,
        "items_failed": total_errors,
        "state": state,
        "dry_run": dry_run,
        "min_score": min_score,
        "since_days": since_days,
        "per_state": [
            {k: v for k, v in r.items() if isinstance(v, (int, str))}
            for r in per_state
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--state",
        required=True,
        choices=list(STATE_CONFIG.keys()) + ["all"],
        help="Stuck state to drain (or 'all' for every bridge)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Count candidates only ; no writes",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap how many kills to process per-state (default : all)",
    )
    ap.add_argument(
        "--min-score",
        type=float,
        default=0.0,
        help="Only re-enqueue clips with highlight_score >= this "
             "(default 0.0)",
    )
    ap.add_argument(
        "--since",
        type=int,
        default=DEFAULT_SINCE_DAYS,
        dest="since_days",
        help=f"Only kills created in the last N days "
             f"(default {DEFAULT_SINCE_DAYS})",
    )
    args = ap.parse_args()

    asyncio.run(_amain(
        state=args.state,
        dry_run=args.dry_run,
        limit=args.limit,
        min_score=args.min_score,
        since_days=args.since_days,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
