"""
backfill_og_images.py — Enqueue og.generate jobs for published kills
that lack an og_image_url (or, with --force, regenerate every published
kill).

Context
-------
525-ish kills currently sit in status='published'. A handful (legacy
backfill rows, transient R2 / Pillow failures, kills that were
republished after a manual qc unblock) never had their OG image
materialised. The frontend `/api/og/[id]` route falls back to a generic
PNG when og_image_url is NULL, which kills the share-card preview.

PR-arch P1 wired og_generator.py to the pipeline_jobs queue
(`og.generate`, entity_type='kill'). This script feeds that queue with
the legacy backlog. The unique partial index on
(type, entity_type, entity_id) WHERE status IN ('pending','claimed')
makes enqueue idempotent — re-runs are safe, the script just sees
"already enqueued" and accounts it as skipped.

Behaviour
---------
1. Pages through `kills WHERE status='published' [AND og_image_url IS NULL]`
   in 500-row batches (under PostgREST's 1000-row default cap, see PR23.5).
2. For each row, enqueues an `og.generate` job at priority 60 (above the
   default 50 used for fresh kills, below the editorial 80 reserved for
   admin force-publishes).
3. We do NOT touch `kills.status`. The kill is already published and the
   downstream UX is unaffected — all we care about is the OG image
   being regenerated. og_generator.py also short-circuits the
   "already-has-OG" fast path, which is what we want when --force is on.

CLI
---
    --dry-run        Count only ; no writes.
    --limit N        Cap how many kills to process (default : all).
    --min-score F    Only enqueue kills with highlight_score >= F.
                     (Default 0.0 — enqueue everything.)
    --force          Re-enqueue even when og_image_url is already set.
                     Use this to regen after a description rewrite, when
                     the OG template changes, or after a brand refresh.

Examples
--------
    # See how many kills are missing an OG image without writing :
    python scripts/backfill_og_images.py --dry-run

    # Top-100 kills first, only the high-score ones :
    python scripts/backfill_og_images.py --limit 100 --min-score 7.0

    # Full backlog :
    python scripts/backfill_og_images.py

    # Force regen of every published kill (e.g. template change) :
    python scripts/backfill_og_images.py --force
"""

from __future__ import annotations

import argparse
import asyncio
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
# Priority 60: above the default 50 used by fresh og.generate jobs from
# the analyzer hand-off, but below the editorial 80 used for admin
# force-publishes. Backfill should be visible-but-not-disruptive.
QUEUE_PRIORITY = 60


def _fetch_page(
    db,
    *,
    offset: int,
    page_size: int,
    min_score: float,
    force: bool,
) -> list[dict]:
    """Pull one page of published kills.

    PostgREST exposes 'kills' with a 1000-row default cap (see PR23.5).
    We page in 500-row batches via limit+offset on (created_at desc).
    Adding an explicit ORDER avoids row-shuffle between pages.

    When force=False we add og_image_url=is.null. When force=True we
    skip that filter and re-enqueue everything — the og_generator quality
    gate + idempotent enqueue keep things sane.
    """
    params = {
        "select": (
            "id,game_id,killer_champion,victim_champion,"
            "ai_description,highlight_score,og_image_url"
        ),
        "status": "eq.published",
        "order": "highlight_score.desc.nullslast,created_at.desc",
        "limit": str(page_size),
        "offset": str(offset),
    }
    if not force:
        params["og_image_url"] = "is.null"
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


@run_logged(module_name="backfill_og_images")
async def _amain(
    *,
    dry_run: bool,
    limit: int | None,
    min_score: float,
    force: bool,
) -> dict:
    db = get_db()
    if db is None:
        print("FATAL : Supabase env vars missing.")
        return {"items_scanned": 0, "items_processed": 0, "items_failed": 1}

    print("=" * 60)
    print("  backfill_og_images — enqueue og.generate for published kills")
    print("=" * 60)
    print(f"  dry_run    : {dry_run}")
    print(f"  limit      : {limit if limit is not None else 'all'}")
    print(f"  min_score  : {min_score}")
    print(f"  force      : {force}")
    print(f"  priority   : {QUEUE_PRIORITY}")
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
                force=force,
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

            if not kill_id:
                skipped += 1
                continue

            if dry_run:
                # Don't write anything ; just account.
                enqueued += 1
            else:
                jid = await asyncio.to_thread(
                    job_queue.enqueue,
                    "og.generate",
                    "kill",
                    kill_id,
                    {"kill_id": kill_id, "game_id": game_id},
                    QUEUE_PRIORITY,
                    None,
                    MAX_RETRIES,
                )
                if jid is None:
                    # Either an active job already exists (dedup via the
                    # unique partial index) OR the call failed. We can't
                    # easily tell the two apart from here ; treat as
                    # skipped, the og_generator daemon will pick it up.
                    skipped += 1
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
    print(f"  skipped   : {skipped}  (already-enqueued / dedup)")
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
        "force": force,
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
        help="Only enqueue kills with highlight_score >= this (default 0.0)",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="Re-enqueue even when og_image_url is already set (regen mode)",
    )
    args = ap.parse_args()

    asyncio.run(_amain(
        dry_run=args.dry_run,
        limit=args.limit,
        min_score=args.min_score,
        force=args.force,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
