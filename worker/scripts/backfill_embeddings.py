"""
backfill_embeddings.py — Compute Gemini text embeddings for every
published kill that lacks one.

Context
-------
Wave 11 / Agent DI ships the per-session recommendation feed. The
recommender RPC (fn_recommend_kills, migration 046) is a no-op for
anchor kills that have NULL embedding — the user's centroid math then
collapses and the loader falls back to the recency feed.

Today the embedder daemon (worker/modules/embedder.py) runs every
30 minutes on a 50-row batch, so the ~525 published kills should all
be embedded already. But :
  * Daemon downtime windows leave gaps.
  * Re-publishes after manual QC unblock can land with embedding=NULL.
  * Past worker crashes mid-batch left a handful unembedded.

This script :
  1. Pages through `kills WHERE status='published' AND embedding IS NULL`
     in 200-row batches (well under PostgREST's 1000-row default cap).
  2. Calls `embedder.embed_one()` on each — re-using the production
     module's logic (Gemini call, vector validation, scheduler quota
     enforcement). Zero code duplication.
  3. Throttles to 5 RPS soft cap on top of the scheduler's 4 s/req
     floor — Gemini's free tier is 15 RPM, so the scheduler delay is
     binding and 5 RPS is a defensive ceiling.
  4. Idempotent : re-runs only touch kills still missing an embedding.
     Safe to invoke from cron, after a deploy, or manually.

CLI
---
    --dry-run        Count candidates only ; no Gemini calls.
    --limit N        Cap how many kills to process (default : all).
    --min-score F    Only embed kills with highlight_score >= F.
                     (Default 0.0 — embed everything.)
    --page-size N    Rows per Supabase page fetch (default 200).

Examples
--------
    # See how many published kills are missing an embedding :
    python scripts/backfill_embeddings.py --dry-run

    # Top-50 high-score kills first :
    python scripts/backfill_embeddings.py --limit 50 --min-score 7.0

    # Full backlog :
    python scripts/backfill_embeddings.py
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")

from modules import embedder  # noqa: E402  (re-uses production embed_one)
from services.observability import run_logged  # noqa: E402
from services.supabase_client import get_db, safe_update  # noqa: E402

DEFAULT_PAGE_SIZE = 200
# Gemini free tier is 15 RPM = 4 s between calls. The scheduler enforces
# that already (see modules/embedder.embed_one). 5 RPS is the absolute
# defensive ceiling — way above what the scheduler would let through —
# so the floor stays the scheduler's quota, this is just a hard cap.
RPS_SOFT_CAP = 5.0
MIN_INTERVAL_SECONDS = 1.0 / RPS_SOFT_CAP


def _format_vector(vec: list[float]) -> str:
    """Mirror embedder._format_vector — exposed here so we don't import
    a private helper. pgvector accepts the bracketed CSV literal form."""
    return "[" + ",".join(f"{v:.7f}" for v in vec) + "]"


def _fetch_page(
    db,
    *,
    offset: int,
    page_size: int,
    min_score: float,
) -> list[dict]:
    """Pull one page of published kills missing an embedding.

    PostgREST's default cap is 1000 rows so our 200 page_size leaves
    headroom for cross-batch ordering jitter.
    """
    params = {
        "select": "id,killer_champion,victim_champion,ai_description,ai_tags",
        "status": "eq.published",
        "embedding": "is.null",
        "order": "highlight_score.desc.nullslast,created_at.desc",
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


@run_logged(module_name="backfill_embeddings")
async def _amain(
    *,
    dry_run: bool,
    limit: int | None,
    min_score: float,
    page_size: int,
) -> dict:
    db = get_db()
    if db is None:
        print("FATAL : Supabase env vars missing.")
        return {
            "items_scanned": 0,
            "items_processed": 0,
            "items_failed": 1,
        }

    print("=" * 60)
    print("  backfill_embeddings — embed published kills missing vec")
    print("=" * 60)
    print(f"  dry_run    : {dry_run}")
    print(f"  limit      : {limit if limit is not None else 'all'}")
    print(f"  min_score  : {min_score}")
    print(f"  page_size  : {page_size}")
    print(f"  rps cap    : {RPS_SOFT_CAP}")
    print()

    scanned = 0
    embedded = 0
    skipped = 0
    errors = 0
    offset = 0
    last_call_at = 0.0

    while True:
        remaining_budget = (
            None if limit is None else max(0, limit - scanned)
        )
        if remaining_budget is not None and remaining_budget == 0:
            break
        this_page_size = (
            page_size
            if remaining_budget is None
            else min(page_size, remaining_budget)
        )

        try:
            page = await asyncio.to_thread(
                _fetch_page,
                db,
                offset=offset,
                page_size=this_page_size,
                min_score=min_score,
            )
        except httpx.HTTPStatusError as e:
            print(
                f"  [error] page fetch failed @ offset={offset}: "
                f"{e.response.status_code} {e.response.text[:200]}"
            )
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
            kid = row.get("id")
            if not kid:
                skipped += 1
                continue

            if dry_run:
                # Don't burn Gemini calls ; just count.
                embedded += 1
            else:
                # Defensive RPS cap on top of the scheduler floor.
                now = time.monotonic()
                wait = MIN_INTERVAL_SECONDS - (now - last_call_at)
                if wait > 0:
                    await asyncio.sleep(wait)
                last_call_at = time.monotonic()

                try:
                    vec = await embedder.embed_one(row)
                except Exception as e:
                    print(
                        f"  [error] embed_one threw for {kid[:8]}: {e}"
                    )
                    errors += 1
                    continue

                if vec is None:
                    # Embedder returns None on quota exhaustion or shape
                    # mismatch — neither is the kill's fault. Count as
                    # skipped so the dashboard isn't alarmed.
                    skipped += 1
                    continue

                ok = await asyncio.to_thread(
                    safe_update,
                    "kills",
                    {"embedding": _format_vector(vec)},
                    "id",
                    kid,
                )
                if not ok:
                    errors += 1
                    continue
                embedded += 1

            if scanned % 50 == 0:
                print(
                    f"  [progress] scanned={scanned} embedded={embedded} "
                    f"skipped={skipped} errors={errors}"
                )

        offset += len(page)
        # Tail page detection : fewer rows than asked → done.
        if len(page) < this_page_size:
            break

    print()
    print("-" * 60)
    print(f"  scanned   : {scanned}")
    print(f"  embedded  : {embedded}")
    print(f"  skipped   : {skipped}  (quota / shape / dry-run)")
    print(f"  errors    : {errors}")
    print("-" * 60)
    if dry_run:
        print("  (dry-run — no embed_one or update calls performed)")
    return {
        "items_scanned": scanned,
        "items_processed": embedded,
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
        help="Count candidates only ; no Gemini / Supabase writes",
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
        help="Only embed kills with highlight_score >= this (default 0.0)",
    )
    ap.add_argument(
        "--page-size",
        type=int,
        default=DEFAULT_PAGE_SIZE,
        help=f"Rows per Supabase page (default {DEFAULT_PAGE_SIZE})",
    )
    args = ap.parse_args()

    asyncio.run(
        _amain(
            dry_run=args.dry_run,
            limit=args.limit,
            min_score=args.min_score,
            page_size=max(1, args.page_size),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
