"""
recover_exhausted_clip_errors.py
=================================

Reset retry_count to 0 for kills stuck in `status='clip_error' AND
retry_count>=3` so the new pipeline (post-PR23.6 NVENC fix, post
youtube cookies, post-Wave-2 vod_fallback_finder, post-channel
reconciler v3) can take another swing at them.

THE PROBLEM
-----------
The legacy retry guard `retry_count<3` in backfill_clip_errors.py
(Agent N, Wave 3) skips kills that exhausted their 3 attempts under
the OLD code. But many of those failures had specific root causes
that have since been fixed:
  * NVENC "Invalid Level 4.1" → fixed in PR23.7 (level=auto)
  * YouTube "Sign in to confirm" → fixed in PR23.6 (cookies.txt + sentinel exception)
  * VOD missing official → fixed by Wave 2 vod_fallback_finder
  * Channel reconciler not matching titles → fixed by Wave 2 v3 rewrite

So those 1126 kills (~from kc_matches.json older than 90 days)
deserve a second chance with the current code.

THIS SCRIPT
-----------
  1. Scans kills WHERE status='clip_error' AND retry_count >= 3
     (paginated 500 at a time, dodging PostgREST 1000-row cap)
  2. Resets retry_count to 0 AND sets status='enriched' so the legacy
     dispatcher doesn't loop on them
  3. Enqueues a fresh `clip.create` job into pipeline_jobs at low
     priority (default 30 — below the score-based 50+ default for
     fresh kills, so we don't crowd them out)
  4. Per-batch progress + final summary

USAGE
-----
    python scripts/recover_exhausted_clip_errors.py --dry-run
    python scripts/recover_exhausted_clip_errors.py --limit 100
    python scripts/recover_exhausted_clip_errors.py             # all of them
    python scripts/recover_exhausted_clip_errors.py --priority 50  # bump priority

Idempotency: the unique partial index on pipeline_jobs
  `(type, entity_type, entity_id) WHERE status IN ('pending', 'claimed')`
  means re-running is safe — second-pass enqueue() returns None
  for rows already in flight.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any

import httpx
from dotenv import load_dotenv

# Worker package imports require sys.path adjustments when running via
# `python scripts/...` from worker/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import job_queue  # noqa: E402
from services.observability import run_logged  # noqa: E402

load_dotenv()


PAGE_SIZE = 500
DEFAULT_PRIORITY = 30


def _supabase() -> tuple[httpx.Client, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_KEY"
    )
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    base = url.rstrip("/") + "/rest/v1"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    return httpx.Client(headers=headers, timeout=30.0), base


def _fetch_page(client: httpx.Client, base: str, offset: int) -> list[dict[str, Any]]:
    """Fetch one page of exhausted clip_errors, oldest first.

    Order: created_at ASC so the oldest backlog drains first. The
    operator usually wants the historical clips re-attempted before
    today's stragglers (today's are still under retry_count<3 in
    backfill_clip_errors).
    """
    r = client.get(
        f"{base}/kills",
        params={
            "select": "id,game_id,highlight_score,killer_champion,victim_champion,event_epoch,retry_count,created_at",
            "status": "eq.clip_error",
            "retry_count": "gte.3",
            "limit": str(PAGE_SIZE),
            "offset": str(offset),
            "order": "created_at.asc",
        },
    )
    r.raise_for_status()
    return r.json() or []


def _reset_status(client: httpx.Client, base: str, kill_id: str) -> bool:
    """Set status='enriched' AND retry_count=0 so the legacy dispatcher
    stops bridging it AND a fresh attempt is allowed.

    `enriched` is invisible to job_dispatcher's bridge scan (which
    only matches `vod_found / clipped / analyzed`). The new
    pipeline_jobs row is the source of truth for what happens next.
    """
    r = client.patch(
        f"{base}/kills",
        params={"id": f"eq.{kill_id}"},
        json={"status": "enriched", "retry_count": 0},
    )
    return r.status_code in (200, 204)


@run_logged()
async def main_async(args: argparse.Namespace) -> int:
    client, base = _supabase()

    print("=" * 60)
    print("  recover_exhausted_clip_errors — re-arm retry_count>=3 kills")
    print("=" * 60)
    print(f"  dry_run    : {args.dry_run}")
    print(f"  limit      : {args.limit if args.limit else 'all'}")
    print(f"  min_score  : {args.min_score}")
    print(f"  priority   : {args.priority}")
    print()

    scanned = 0
    enqueued = 0
    skipped_score = 0
    skipped_dup = 0
    errors = 0
    offset = 0

    # The exhaust-recovery loop. Pagination by offset because the
    # scan + status-flip is destructive — what was at offset=0 in
    # iteration 1 won't match the filter in iteration 2 (status
    # changed to 'enriched'). So offset+=PAGE_SIZE wouldn't be safe
    # if filter changed, but since rows that flip OUT of clip_error
    # leave the result set, the offset effectively stays at 0.
    # Re-fetch from offset=0 each time.
    while True:
        page = _fetch_page(client, base, 0)
        if not page:
            break

        for row in page:
            scanned += 1
            if args.limit and scanned > args.limit:
                break

            score = row.get("highlight_score") or 0.0
            if score < args.min_score:
                skipped_score += 1
                continue

            payload = {"kill_id": row["id"], "game_id": row.get("game_id")}
            try:
                job_id = job_queue.enqueue(
                    job_type="clip.create",
                    entity_type="kill",
                    entity_id=row["id"],
                    payload=payload,
                    priority=args.priority,
                )
            except Exception as e:
                print(f"  ! enqueue error for {row['id'][:8]}: {str(e)[:120]}")
                errors += 1
                continue

            if job_id is None:
                # unique partial index dedup — already in flight
                skipped_dup += 1
            else:
                enqueued += 1

            # Reset status regardless of whether the enqueue was a
            # dedup-no-op. If the dispatcher already bridged this kill
            # before we got here, we still want to clear the legacy
            # state so it doesn't keep getting bridged.
            if not args.dry_run:
                ok = _reset_status(client, base, row["id"])
                if not ok:
                    errors += 1

            if scanned % 100 == 0:
                print(
                    f"  [progress] scanned={scanned} enqueued={enqueued} "
                    f"skipped_score={skipped_score} skipped_dup={skipped_dup} "
                    f"errors={errors}"
                )

        if args.limit and scanned >= args.limit:
            break

        # If we just acted on the page, the next fetch should return
        # the NEXT batch (those rows just had status changed). If we
        # were dry-run, we'd loop forever — bail after first page in
        # that case.
        if args.dry_run:
            break

    print()
    print("-" * 60)
    print(f"  scanned       : {scanned}")
    print(f"  enqueued      : {enqueued}")
    print(f"  skipped_score : {skipped_score}  (highlight_score < {args.min_score})")
    print(f"  skipped_dup   : {skipped_dup}    (already in flight in queue)")
    print(f"  errors        : {errors}")
    print("-" * 60)
    if args.dry_run:
        print("  (dry-run — no writes performed)")

    client.close()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="Report without writing.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap how many to process (default: all).")
    ap.add_argument("--min-score", type=float, default=0.0,
                    help="Only re-enqueue kills with highlight_score >= F "
                         "(default 0 — all).")
    ap.add_argument("--priority", type=int, default=DEFAULT_PRIORITY,
                    help=f"pipeline_jobs.priority for enqueued rows "
                         f"(default {DEFAULT_PRIORITY} — below the score-based "
                         f"50+ default for fresh kills).")
    args = ap.parse_args()

    import asyncio
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
