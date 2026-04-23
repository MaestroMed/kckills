"""
REANALYZE_WITH_PREMIUM — Upgrade existing clip descriptions with the
premium Gemini tier (Pro 2.5 by default).

Why
---
Phase-1 of the KC catalog was analyzed with Gemini 2.5 Flash-Lite (free
tier). Descriptions land in the 50-80 char range — functional but terse.
PR12 added env-var-driven model selection. With KCKILLS_GEMINI_TIER=premium
+ paid billing, the analyzer now uses Gemini 2.5 Pro for new clips.

This script back-runs Pro 2.5 over clips that already have a Flash-Lite
description, replacing the description / tags / score in-place. Idempotent:
re-running on a clip already upgraded skips it (controlled by
--force / --since-status).

Cost math (€45 budget, 2,021 KC clips at Pro 2.5 default-res) :
  - per clip : 40s × 300 tokens/sec input + 500 tokens output
  - cost per clip : ~$0.020 = €0.018
  - 2,021 clips total : €37.50
  - leaves €7+ for QC + retries + 30 days of new clips

Run
---
  # Dry-run (lists candidates, no API calls)
  python scripts/reanalyze_with_premium.py --dry-run

  # Live, capped to 50 clips per run (safe one-shot test)
  python scripts/reanalyze_with_premium.py --limit 50

  # Full backfill (respects scheduler daily quota)
  python scripts/reanalyze_with_premium.py --commit

  # Only clips published in last 7 days (delta upgrade)
  python scripts/reanalyze_with_premium.py --commit --since-days 7

Persistence
-----------
Descriptions written to Supabase kills.ai_description (NULL-protected by
validate_description). The investment is permanent : a daemon restart,
worktree reset, or even a fresh checkout doesn't lose the descriptions.
The Google Cloud billing project is separate from the code; as long as
your project + API key + budget remain, this script is rerunnable.

Persistence guard : the script will REFUSE to run if config.GEMINI_MODEL_ANALYZER
is still on flash-lite (no point spending without the upgrade).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import httpx  # noqa: E402

from config import config  # noqa: E402
from scheduler import scheduler  # noqa: E402
from services.supabase_client import get_db, safe_update  # noqa: E402
from modules.analyzer import analyze_kill_row, validate_description  # noqa: E402


def _fetch_candidates(since_days: int | None, limit: int | None,
                      force: bool) -> list[dict]:
    """Get clips eligible for re-analysis."""
    db = get_db()
    if not db:
        print("ERROR : Supabase unavailable")
        sys.exit(1)
    params: dict[str, str] = {
        "select": "id,killer_champion,victim_champion,is_first_blood,multi_kill,"
                  "tracked_team_involvement,fight_type,matchup_lane,lane_phase,"
                  "kill_visible,assistants,shutdown_bounty,retry_count,"
                  "clip_url_vertical,clip_url_horizontal,ai_description,"
                  "highlight_score,reanalyzed_at,created_at",
        "status": "eq.published",
        "order": "highlight_score.desc.nullslast",
    }
    if since_days is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()
        params["created_at"] = f"gte.{cutoff}"
    if not force:
        # skip already-upgraded
        params["reanalyzed_at"] = "is.null"
    if limit:
        params["limit"] = str(limit)
    else:
        params["limit"] = "5000"
    r = httpx.get(f"{db.base}/kills", headers=db.headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json() or []


async def _process_one(kill: dict) -> tuple[bool, str]:
    """Re-analyze one kill. Returns (ok, reason)."""
    # Download clip to a temp path
    import tempfile
    clip_url = kill.get("clip_url_vertical") or kill.get("clip_url_horizontal")
    if not clip_url:
        return False, "no clip URL"
    tmp_dir = config.CLIPS_DIR
    os.makedirs(tmp_dir, exist_ok=True)
    clip_path = os.path.join(tmp_dir, f"reanalyze_{kill['id'][:8]}.mp4")
    try:
        with httpx.stream("GET", clip_url, follow_redirects=True, timeout=60) as resp:
            resp.raise_for_status()
            with open(clip_path, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
        result = await analyze_kill_row(kill, clip_path=clip_path)
    except Exception as e:
        return False, f"download/analyze error: {str(e)[:100]}"
    finally:
        if os.path.exists(clip_path):
            try: os.remove(clip_path)
            except OSError: pass

    if not result:
        return False, "analyzer returned None"
    desc = result.get("description_fr")
    ok, reason = validate_description(desc)
    if not ok:
        return False, f"validate_description: {reason}"

    patch = {
        "ai_description": desc,
        "ai_tags": result.get("tags") or [],
        "highlight_score": result.get("highlight_score"),
        "kill_visible": bool(result.get("kill_visible_on_screen", True)),
        "caster_hype_level": result.get("caster_hype_level"),
        "reanalyzed_at": datetime.now(timezone.utc).isoformat(),
        "reanalyzed_model": config.GEMINI_MODEL_ANALYZER,
    }
    safe_update("kills", patch, "id", kill["id"])
    return True, f"ok ({len(desc)} chars)"


async def main_async(dry_run: bool, limit: int | None, since_days: int | None,
                     force: bool) -> int:
    # Persistence guard : refuse if still on cheap model
    if "flash-lite" in config.GEMINI_MODEL_ANALYZER.lower():
        print(f"ABORT : GEMINI_MODEL_ANALYZER is '{config.GEMINI_MODEL_ANALYZER}'.")
        print("        You're about to spend Gemini quota on the same model that")
        print("        wrote the descriptions you're trying to upgrade. Set")
        print("        KCKILLS_GEMINI_TIER=premium in .env (or override via")
        print("        GEMINI_MODEL_ANALYZER=gemini-2.5-pro) and re-run.")
        return 1

    print(f"Model      : {config.GEMINI_MODEL_ANALYZER}")
    print(f"Daily cap  : {scheduler.DAILY_QUOTAS.get('gemini', '?')} calls")
    print(f"Resolution : {config.GEMINI_MEDIA_RESOLUTION}")
    print()

    candidates = _fetch_candidates(since_days, limit, force)
    print(f"Found {len(candidates)} candidate clips")
    if not candidates:
        return 0

    if dry_run:
        for c in candidates[:20]:
            score = c.get("highlight_score") or 0
            desc_len = len(c.get("ai_description") or "")
            print(f"  {c['id'][:8]} score={score:.1f} desc_len={desc_len} "
                  f"{c.get('killer_champion')}->{c.get('victim_champion')}")
        if len(candidates) > 20:
            print(f"  ... +{len(candidates) - 20} more")
        print(f"\nDry-run: {len(candidates)} clips would be re-analyzed.")
        return 0

    print(f"Processing {len(candidates)} clips serially (respecting Gemini quota)...")
    print()

    counters = {"ok": 0, "fail": 0, "skip_quota": 0}
    for i, kill in enumerate(candidates, 1):
        # Respect daily quota — abort if exhausted
        remaining = scheduler.get_remaining("gemini")
        if remaining is not None and remaining <= 0:
            print(f"\nDaily Gemini quota exhausted at clip {i}/{len(candidates)}. "
                  f"Resume tomorrow.")
            counters["skip_quota"] = len(candidates) - i
            break
        ok, reason = await _process_one(kill)
        if ok:
            counters["ok"] += 1
            sym = "+"
        else:
            counters["fail"] += 1
            sym = "x"
        print(f"  [{i:>4}/{len(candidates)}] {sym} {kill['id'][:8]}  {reason}")

    print()
    print("-" * 60)
    print(f"  ok       : {counters['ok']}")
    print(f"  failed   : {counters['fail']}")
    print(f"  skipped  : {counters['skip_quota']} (quota exhausted)")
    print(f"  remaining gemini quota today : {scheduler.get_remaining('gemini')}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="List candidates, no API calls")
    ap.add_argument("--commit", action="store_true", help="Process all candidates")
    ap.add_argument("--limit", type=int, default=None, help="Cap to N clips (default: all)")
    ap.add_argument("--since-days", type=int, default=None,
                    help="Only clips published in the last N days")
    ap.add_argument("--force", action="store_true",
                    help="Re-process even already-upgraded clips")
    args = ap.parse_args()

    if not args.dry_run and not args.commit and not args.limit:
        print("Specify --dry-run, --commit, or --limit N")
        return 2

    return asyncio.run(main_async(
        dry_run=args.dry_run and not args.commit,
        limit=args.limit,
        since_days=args.since_days,
        force=args.force,
    ))


if __name__ == "__main__":
    sys.exit(main())
