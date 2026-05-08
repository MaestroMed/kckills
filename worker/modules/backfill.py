"""
BACKFILL — Batch-run the pipeline over every match in data/kc_matches.json.

Intended to populate Supabase + R2 with the full 83-match KC history in one
(week-end) pass. Respects rate limits via the existing scheduler; each match
is processed sequentially so yt-dlp, Gemini, and ffmpeg don't fight for
bandwidth / CPU.

Usage:
    python main.py backfill                    # full 83 matches
    python main.py backfill --limit 5          # first 5 matches only
    python main.py backfill --from 2025-01-01  # matches scheduled after date
    python main.py backfill --resume           # skip matches already published

Writes a JSON checkpoint file (worker/.backfill_state.json) between matches
so a crash doesn't restart from zero.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

import structlog

from modules import pipeline
from services.supabase_client import safe_select

log = structlog.get_logger()

# repo root = worker/.. — matches the data file location
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_PATH = os.path.join(REPO_ROOT, "data", "kc_matches.json")
STATE_PATH = os.path.join(os.path.dirname(__file__), "..", ".backfill_state.json")


def _load_matches() -> list[dict]:
    if not os.path.exists(DATA_PATH):
        log.error("backfill_no_data", path=DATA_PATH)
        return []
    with open(DATA_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    return data.get("matches", []) if isinstance(data, dict) else []


def _load_state() -> dict:
    if not os.path.exists(STATE_PATH):
        return {"processed": [], "started_at": None, "last_match": None}
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"processed": [], "started_at": None, "last_match": None}


def _save_state(state: dict):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


def _is_already_published(match_ext_id: str) -> bool:
    """Check Supabase: does this match already have published kills?"""
    rows = safe_select("matches", "id", external_id=match_ext_id)
    if not rows:
        return False
    match_db_id = rows[0]["id"]
    games = safe_select("games", "id", match_id=match_db_id)
    if not games:
        return False
    for g in games:
        kills = safe_select("kills", "id", game_id=g["id"], status="published")
        if kills:
            return True
    return False


# Wave 20.1 — circuit-breaker threshold. Stops the backfill loop when
# Gemini's remaining daily quota drops below this many calls. Each
# match analysis spends 5-15 calls (one per kill) ; 50 leaves room for
# the in-flight match to finish without the rest of the loop accumulating
# silent quota-exceeded failures (which were turning into
# `analyzed_failed` ghosts the operator only saw the next morning).
#
# Override via KCKILLS_BACKFILL_GEMINI_FLOOR. Set to 0 to disable
# (e.g. paid tier, no quota concern).
_GEMINI_QUOTA_FLOOR = int(os.environ.get("KCKILLS_BACKFILL_GEMINI_FLOOR", "50") or "50")


async def run(
    limit: int | None = None,
    since: str | None = None,
    resume: bool = False,
    dry_run: bool = False,
) -> dict:
    """Main backfill loop. Returns a summary report.

    Wave 20.1 — adds a Gemini quota circuit-breaker. The loop stops
    early (clean break, summary still printed) when remaining daily
    quota drops below `_GEMINI_QUOTA_FLOOR`. This prevents the silent
    "quota exceeded → kill stuck → operator finds out next morning"
    failure mode that the audit flagged.
    """
    all_matches = _load_matches()
    if not all_matches:
        return {"error": "no matches in data/kc_matches.json"}

    # Sort newest first so a --limit N pass gives us the freshest data
    all_matches.sort(key=lambda m: m.get("date", ""), reverse=True)

    if since:
        all_matches = [m for m in all_matches if m.get("date", "") >= since]

    if limit:
        all_matches = all_matches[:limit]

    state = _load_state()
    processed_set = set(state.get("processed") or []) if resume else set()

    report = {
        "total": len(all_matches),
        "skipped": 0,
        "processed": 0,
        "failed": 0,
        "kills_detected": 0,
        "kills_clipped": 0,
        "kills_published": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "errors": [],
    }

    log.info(
        "backfill_start",
        total=len(all_matches),
        resume=resume,
        dry=dry_run,
        gemini_floor=_GEMINI_QUOTA_FLOOR,
    )

    for idx, match in enumerate(all_matches, start=1):
        # Wave 20.1 — Gemini quota circuit-breaker. Check BEFORE each
        # match so we don't enqueue work that's guaranteed to stall on
        # `scheduler.wait_for("gemini")` returning False.
        if _GEMINI_QUOTA_FLOOR > 0:
            try:
                from scheduler import scheduler
                remaining = scheduler.get_remaining("gemini")
            except Exception:
                remaining = None
            if remaining is not None and remaining < _GEMINI_QUOTA_FLOOR:
                log.warn(
                    "backfill_stopping_low_quota",
                    gemini_remaining=remaining,
                    floor=_GEMINI_QUOTA_FLOOR,
                    matches_remaining=len(all_matches) - idx + 1,
                )
                report["errors"].append(
                    f"stopped early : gemini quota {remaining} < floor "
                    f"{_GEMINI_QUOTA_FLOOR}, {len(all_matches) - idx + 1} "
                    f"matches deferred"
                )
                break

        match_ext_id = match.get("id")
        if not match_ext_id:
            continue

        opponent = (match.get("opponent") or {}).get("code", "?")
        label = f"[{idx}/{len(all_matches)}] {match.get('date', '?')[:10]} KC vs {opponent}"

        if match_ext_id in processed_set:
            log.info("backfill_skip_cached", match=match_ext_id, label=label)
            report["skipped"] += 1
            continue

        if resume and _is_already_published(match_ext_id):
            log.info("backfill_skip_published", match=match_ext_id, label=label)
            processed_set.add(match_ext_id)
            state["processed"] = list(processed_set)
            state["last_match"] = match_ext_id
            _save_state(state)
            report["skipped"] += 1
            continue

        print(f"\n{'=' * 60}\n  {label}\n{'=' * 60}")

        if dry_run:
            print("  (dry-run, skipping real pipeline call)")
            report["processed"] += 1
            continue

        try:
            sub = await pipeline.run_for_match(match_ext_id)
            report["processed"] += 1
            report["kills_detected"] += sub.get("kills_detected", 0)
            report["kills_clipped"] += sub.get("kills_clipped", 0)
            report["kills_published"] += sub.get("kills_published", 0)
            processed_set.add(match_ext_id)
            state["processed"] = list(processed_set)
            state["last_match"] = match_ext_id
            if not state.get("started_at"):
                state["started_at"] = report["started_at"]
            _save_state(state)
        except Exception as e:
            report["failed"] += 1
            report["errors"].append(f"{match_ext_id}: {e}")
            log.error("backfill_match_failed", match=match_ext_id, error=str(e))

    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    _print_summary(report)
    return report


def _print_summary(report: dict):
    print()
    print("=" * 60)
    print("  BACKFILL SUMMARY")
    print("=" * 60)
    print(f"  Total matches     : {report['total']}")
    print(f"  Processed         : {report['processed']}")
    print(f"  Skipped (cached)  : {report['skipped']}")
    print(f"  Failed            : {report['failed']}")
    print(f"  Kills detected    : {report['kills_detected']}")
    print(f"  Kills clipped     : {report['kills_clipped']}")
    print(f"  Kills published   : {report['kills_published']}")
    if report.get("errors"):
        print(f"  First errors      :")
        for e in report["errors"][:5]:
            print(f"    - {e}")
    print("=" * 60)
    print()


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="backfill")
    p.add_argument("--limit", type=int, default=None, help="Process only the first N matches (newest first)")
    p.add_argument("--from", dest="since", default=None, help="Only matches on/after YYYY-MM-DD")
    p.add_argument("--resume", action="store_true", help="Skip matches already processed in state file OR already published")
    p.add_argument("--dry-run", action="store_true", help="Iterate but don't call the pipeline")
    return p.parse_args(argv)


def main_cli(argv: list[str]):
    args = parse_args(argv)
    asyncio.run(run(limit=args.limit, since=args.since, resume=args.resume, dry_run=args.dry_run))


if __name__ == "__main__":
    main_cli(sys.argv[1:])
