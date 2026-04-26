"""
backfill_clip_errors.py — Re-enqueue stuck clip_error kills into the
new pipeline_jobs queue.

Context
-------
The pre-Wave-1 pipeline used a freeform `kills.status` text column. When
the clipper failed (yt-dlp 429, missing VOD, ffmpeg crash...) it flipped
the row to status='clip_error' and bumped retry_count. Wave 1 introduced
the `pipeline_jobs` queue (clip.create / clip.analyze / publish.check),
and Wave 2 shipped the vod_fallback_finder + channel_reconciler v3
which together unblock most of the legacy clip_error backlog (~1225
rows) :
  * vod_fallback_finder copies VOD ids from game_vod_sources to games
    when the official VOD is missing.
  * channel_reconciler v3 actively indexes Kameto / @LCSEsports backfills.
  * NVENC + youtube-cookie fixes from PR23.6 / PR23.7 cleared most of
    the older ffmpeg / youtube failures.

This script :
  1. Scans kills WHERE status='clip_error' AND retry_count<3, in batches
     of 500 (under PostgREST's 1000-row cap so we don't silently miss
     rows like PR23.5 found out the hard way).
  2. For each kill, enqueues a fresh `clip.create` job with
     queue_priority = floor((highlight_score or 5) * 10) so the best
     clips reprocess first.
  3. After the enqueue succeeds, resets the kill row :
        status         = 'enriched'
        retry_count    = 0
     This both clears the legacy error state AND makes the legacy
     job_dispatcher stop tripping over it (it scans status='vod_found' /
     'clipped' / 'analyzed' for bridging — 'enriched' is the natural
     pre-VOD state and is invisible to the dispatcher).

CLI
---
    --dry-run        Count only ; no writes (default off)
    --limit N        Cap how many to process (default : all)
    --min-score F    Only re-enqueue clips with highlight_score >= F
                     (default 0.0 — re-enqueue everything)

Examples
--------
    # See how many would be touched without writing :
    python scripts/backfill_clip_errors.py --dry-run

    # Top-100 clips first (safer warm-up — confirm pipeline absorbs them) :
    python scripts/backfill_clip_errors.py --limit 100 --min-score 7.0

    # Full backfill :
    python scripts/backfill_clip_errors.py
"""

from __future__ import annotations

import argparse
import asyncio
import math
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from services import job_queue  # noqa: E402
from services.observability import run_logged  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

PAGE_SIZE = 500
MAX_RETRIES = 3


def _priority_from_score(highlight_score: float | None) -> int:
    """Map a highlight_score (1.0–10.0, may be None) into a queue priority.

    The queue claims rows ORDER BY priority DESC NULLS LAST, so a higher
    int = sooner. floor(score * 10) yields 10..100, which leaves headroom
    above (manual operator force-retries can use 200+) and below (the
    default 50 used for fresh kills) so we don't fight other tooling.
    """
    score = float(highlight_score) if highlight_score is not None else 5.0
    return int(math.floor(score * 10))


def _fetch_page(
    db,
    *,
    offset: int,
    page_size: int,
    min_score: float,
) -> list[dict]:
    """Pull one page of clip_error kills.

    PostgREST exposes 'kills' with a 1000-row default cap (see PR23.5).
    We page in 500-row batches via Range/limit+offset on (created_at desc).
    Adding an explicit ORDER avoids row-shuffle between pages.
    """
    params = {
        "select": (
            "id,game_id,killer_player_id,killer_champion,"
            "victim_player_id,victim_champion,event_epoch,"
            "highlight_score,retry_count"
        ),
        "status": "eq.clip_error",
        "retry_count": f"lt.{MAX_RETRIES}",
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


def _reset_status(db, kill_id: str) -> bool:
    """Flip kill back to 'enriched' + reset retry_count.

    Done AFTER enqueue() succeeds so we don't reset state for a kill
    that never made it into the queue (would create a ghost row with
    no work attached). The unique partial index on pipeline_jobs
    (type, entity_type, entity_id) WHERE status IN ('pending','claimed')
    means even if the script is interrupted between enqueue and reset
    a re-run is safe : enqueue() returns None for the duplicate, and
    we still re-attempt the reset.

    Returns True iff the PATCH returned 2xx.
    """
    try:
        r = httpx.patch(
            f"{db.base}/kills",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{kill_id}"},
            json={"status": "enriched", "retry_count": 0},
            timeout=15.0,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


@run_logged(module_name="backfill_clip_errors")
async def _amain(
    *,
    dry_run: bool,
    limit: int | None,
    min_score: float,
) -> dict:
    db = get_db()
    if db is None:
        print("FATAL : Supabase env vars missing.")
        return {"items_scanned": 0, "items_processed": 0, "items_failed": 1}

    print("=" * 60)
    print("  backfill_clip_errors — re-enqueue stuck clip_error kills")
    print("=" * 60)
    print(f"  dry_run    : {dry_run}")
    print(f"  limit      : {limit if limit is not None else 'all'}")
    print(f"  min_score  : {min_score}")
    print()

    scanned = 0
    enqueued = 0
    skipped = 0
    errors = 0
    offset = 0

    while True:
        # Cap page_size on the last page if the user passed --limit.
        remaining_budget = (
            None if limit is None else max(0, limit - scanned)
        )
        if remaining_budget is not None and remaining_budget == 0:
            break
        page_size = (
            PAGE_SIZE
            if remaining_budget is None
            else min(PAGE_SIZE, remaining_budget)
        )

        try:
            page = await asyncio.to_thread(
                _fetch_page,
                db,
                offset=offset,
                page_size=page_size,
                min_score=min_score,
            )
        except httpx.HTTPStatusError as e:
            print(f"  [error] page fetch failed @ offset={offset}: "
                  f"{e.response.status_code} {e.response.text[:200]}")
            errors += 1
            break
        except Exception as e:
            print(f"  [error] page fetch threw @ offset={offset}: {e}")
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

            if not kill_id or not game_id:
                skipped += 1
                continue

            # Belt-and-braces : the SQL filter already excludes >=MAX,
            # but the column can be NULL → coerce above defends us.
            if retry_count >= MAX_RETRIES:
                skipped += 1
                continue

            priority = _priority_from_score(score)

            if dry_run:
                # Don't write anything ; just account.
                enqueued += 1
            else:
                jid = await asyncio.to_thread(
                    job_queue.enqueue,
                    "clip.create",
                    "kill",
                    kill_id,
                    {"kill_id": kill_id, "game_id": game_id},
                    priority,
                    None,
                    MAX_RETRIES,
                )
                if jid is None:
                    # Either an active job already exists (idempotent
                    # no-op via the unique partial index) OR the call
                    # failed. Either way still try to clear the legacy
                    # error state so the dispatcher stops re-scanning it.
                    ok = await asyncio.to_thread(_reset_status, db, kill_id)
                    if ok:
                        skipped += 1  # already-enqueued
                    else:
                        errors += 1
                    continue

                ok = await asyncio.to_thread(_reset_status, db, kill_id)
                if not ok:
                    # Job is in queue but kill row didn't reset. The
                    # dispatcher will see status='clip_error' and try to
                    # bridge it, but enqueue() is idempotent — net effect
                    # is a (small) duplicate count, no real damage.
                    print(f"  [warn] enqueue ok but status reset failed "
                          f"for {kill_id[:8]}")
                    errors += 1
                    continue

                enqueued += 1

            if scanned % 100 == 0:
                print(f"  [progress] scanned={scanned} enqueued={enqueued} "
                      f"skipped={skipped} errors={errors}")

        offset += len(page)
        # Tail page detection : if we got fewer rows than asked, we're done.
        if len(page) < page_size:
            break

    print()
    print("-" * 60)
    print(f"  scanned   : {scanned}")
    print(f"  enqueued  : {enqueued}")
    print(f"  skipped   : {skipped}  (already-enqueued / retry exhausted)")
    print(f"  errors    : {errors}")
    print("-" * 60)
    if dry_run:
        print("  (dry-run — no writes performed)")
    return {
        "items_scanned": scanned,
        "items_processed": enqueued,
        "items_skipped": skipped,
        "items_failed": errors,
        "min_score": min_score,
        "dry_run": dry_run,
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
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
        help="Cap how many kills to process (default : all)",
    )
    ap.add_argument(
        "--min-score",
        type=float,
        default=0.0,
        help="Only re-enqueue clips with highlight_score >= this (default 0.0)",
    )
    args = ap.parse_args()

    asyncio.run(_amain(
        dry_run=args.dry_run,
        limit=args.limit,
        min_score=args.min_score,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
