"""
SEED_AI_ANNOTATIONS — One-shot backfill of ai_annotations rows for the
existing kills that already have ai_description_* set on the kills row
but no corresponding ai_annotations row.

Why : after migration 028 lands, every NEW analyzer pass writes to
ai_annotations and the trigger keeps kills.* in sync. But the ~340
kills already in production (analyzed before PR23-arch) have no
ai_annotations row — they show up as `is_current = NULL` in any join
and break the v_ai_cost_24h view's sample size, the lab generator's
per-model A/B comparisons, and the qc_sampler's confidence-bump risk
heuristic.

This script reads the legacy denormalised columns and inserts a
synthetic ai_annotations row per kill, marked :
  model_provider="legacy"
  model_name="pre-pr23"
  prompt_version="legacy"
  analysis_version="v0"
  confidence_score=0.5
  is_current=TRUE

Idempotent : skips kills that already have a current ai_annotations row.
Run-once but safe to re-run (becomes a no-op once everything is seeded).

Usage (from worker/) :
    python scripts/seed_ai_annotations.py
    python scripts/seed_ai_annotations.py --dry-run
    python scripts/seed_ai_annotations.py --batch-size 100 --max-batches 3
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import structlog

from services.supabase_client import get_db, safe_insert

structlog.configure(processors=[
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()


# Legacy synthetic annotation provenance. Anyone querying ai_annotations
# can filter these out via `WHERE model_provider != 'legacy'` to get only
# the real model-produced rows.
LEGACY_PROVIDER = "legacy"
LEGACY_MODEL_NAME = "pre-pr23"
LEGACY_PROMPT_VERSION = "legacy"
LEGACY_ANALYSIS_VERSION = "v0"
LEGACY_CONFIDENCE = 0.5

DEFAULT_BATCH_SIZE = 500


# Columns we copy from kills → ai_annotations.
KILL_FIELDS = (
    "id, highlight_score, ai_tags, ai_description, ai_description_fr, "
    "ai_description_en, ai_description_ko, ai_description_es, "
    "ai_thumbnail_timestamp_sec, created_at"
)


def _fetch_already_seeded_ids(db, kill_ids: list[str]) -> set[str]:
    """Return the subset of kill_ids that already have ANY ai_annotations row."""
    if not kill_ids:
        return set()
    seen: set[str] = set()
    BATCH = 200
    for i in range(0, len(kill_ids), BATCH):
        batch = kill_ids[i : i + BATCH]
        in_filter = "in.(" + ",".join(batch) + ")"
        try:
            r = httpx.get(
                f"{db.base}/ai_annotations",
                headers=db.headers,
                params={
                    "select": "kill_id",
                    "kill_id": in_filter,
                    "limit": 5000,
                },
                timeout=20.0,
            )
            if r.status_code == 200:
                for row in r.json() or []:
                    kid = row.get("kill_id")
                    if kid:
                        seen.add(kid)
            else:
                log.warn("seed_dedup_query_failed",
                         status=r.status_code, body=r.text[:200])
        except Exception as e:
            log.warn("seed_dedup_query_error", error=str(e)[:200])
    return seen


def _fetch_candidates(db, batch_size: int) -> list[dict]:
    """Fetch up to batch_size kills with ai_description_fr set.

    The "no current ai_annotations row" filter is done in Python after
    the fetch — PostgREST's NOT IN sub-select is awkward and the kill_ids
    we'd need are unbounded. We instead pull a batch, dedup against
    ai_annotations, and let the caller iterate.
    """
    try:
        r = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={
                "select": KILL_FIELDS,
                "ai_description_fr": "not.is.null",
                "order": "created_at.desc",
                "limit": batch_size,
            },
            timeout=30.0,
        )
        if r.status_code != 200:
            log.error("seed_fetch_failed", status=r.status_code, body=r.text[:200])
            return []
        return r.json() or []
    except Exception as e:
        log.error("seed_fetch_error", error=str(e)[:200])
        return []


def _build_legacy_row(kill: dict) -> dict:
    """Build a synthetic ai_annotations row from the legacy kills.* columns."""
    return {
        "kill_id": kill["id"],
        "model_provider": LEGACY_PROVIDER,
        "model_name": LEGACY_MODEL_NAME,
        "prompt_version": LEGACY_PROMPT_VERSION,
        "analysis_version": LEGACY_ANALYSIS_VERSION,
        # No asset reference — these were all clipped before migration 026
        # (or before kill_assets was wired into the analyzer).
        "input_asset_id": None,
        "input_asset_version": None,
        # Carry the existing values verbatim
        "highlight_score": kill.get("highlight_score"),
        "ai_tags": kill.get("ai_tags") or [],
        # ai_description (no _fr suffix) is the OLDEST canonical column —
        # use it as a fallback when ai_description_fr is null. The query
        # filters on ai_description_fr being non-null, but stay defensive.
        "ai_description_fr": kill.get("ai_description_fr") or kill.get("ai_description"),
        "ai_description_en": kill.get("ai_description_en"),
        "ai_description_ko": kill.get("ai_description_ko"),
        "ai_description_es": kill.get("ai_description_es"),
        "ai_thumbnail_timestamp_sec": kill.get("ai_thumbnail_timestamp_sec"),
        "confidence_score": LEGACY_CONFIDENCE,
        # No raw response, no token counts, no cost, no latency — these
        # are unrecoverable from the legacy row.
        "raw_response": None,
        "input_tokens": None,
        "output_tokens": None,
        "cost_usd": None,
        "latency_ms": None,
        "is_current": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--max-batches", type=int, default=10,
                        help="safety cap on iteration count (default 10)")
    parser.add_argument("--dry-run", action="store_true",
                        help="report what would be inserted without writing")
    args = parser.parse_args()

    db = get_db()
    if not db:
        log.error("seed_no_db")
        return 1

    log.info(
        "seed_start",
        batch_size=args.batch_size, max_batches=args.max_batches,
        dry_run=args.dry_run,
    )

    total_inserted = 0
    total_skipped = 0

    for batch_idx in range(args.max_batches):
        candidates = _fetch_candidates(db, args.batch_size)
        if not candidates:
            log.info("seed_no_more_candidates", batch=batch_idx)
            break

        candidate_ids = [c["id"] for c in candidates if c.get("id")]
        already = _fetch_already_seeded_ids(db, candidate_ids)
        todo = [c for c in candidates if c["id"] not in already]

        log.info(
            "seed_batch_filtered",
            batch=batch_idx,
            fetched=len(candidates), already_seeded=len(already), todo=len(todo),
        )

        if not todo:
            # Could be that this fetch's whole window is already seeded but
            # earlier kills aren't yet. The order is descending (newest
            # first), so once a whole batch is fully-seeded we're DONE —
            # everything older was either re-fetched or already covered.
            # Safety : if `already` covered the entire fetch, we're at the
            # boundary and can stop.
            if len(already) == len(candidates):
                log.info("seed_window_fully_covered", batch=batch_idx)
                break
            continue

        batch_inserted = 0
        for kill in todo:
            row = _build_legacy_row(kill)
            if args.dry_run:
                log.info(
                    "seed_dry_insert",
                    kill_id=kill["id"][:8],
                    has_fr=bool(row.get("ai_description_fr")),
                    score=row.get("highlight_score"),
                )
                batch_inserted += 1
                continue
            rec = safe_insert("ai_annotations", row)
            if rec:
                batch_inserted += 1
            else:
                # safe_insert returns None on Supabase 4xx OR on cache fall-
                # through — log and continue. The local cache flush will
                # replay the row later. Worst case it slipped past us once
                # — re-run the script and idempotency catches it.
                log.warn("seed_insert_failed_or_cached",
                         kill_id=kill["id"][:8])

        total_inserted += batch_inserted
        total_skipped += len(already)

        log.info(
            "seed_batch_done",
            batch=batch_idx,
            inserted=batch_inserted, skipped_already=len(already),
        )

        # Stop early if this batch was much smaller than batch_size — we
        # almost certainly hit the tail of the eligible population.
        if len(candidates) < args.batch_size:
            log.info("seed_tail_reached", batch=batch_idx)
            break

    log.info(
        "seed_done",
        total_inserted=total_inserted,
        total_skipped=total_skipped,
        dry_run=args.dry_run,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
