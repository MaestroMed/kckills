"""Test runner for the MOMENTS pipeline.

Usage:
    python test_moments_pipeline.py [match_external_id]

Default match: KC vs VIT Week 1 (115548668059523724)
"""

from __future__ import annotations

import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Patch scheduler delays for fast testing
from scheduler import scheduler
scheduler.DELAYS["livestats"] = 0.3
scheduler.DELAYS["lolesports_idle"] = 0.5
scheduler.DELAYS["lolesports_live"] = 0.5
scheduler.DELAYS["ytdlp"] = 5.0

# Limit harvester walk window
from modules import harvester
_orig_moments = harvester.extract_moments_from_game

async def _limited_moments(*args, **kwargs):
    kwargs.setdefault("max_game_minutes", 65)
    kwargs.setdefault("max_consecutive_empty", 60)
    return await _orig_moments(*args, **kwargs)

harvester.extract_moments_from_game = _limited_moments  # type: ignore

from modules import pipeline


async def main():
    match_id = sys.argv[1] if len(sys.argv) > 1 else "115548668059523724"
    print(f"\n[test] MOMENTS pipeline for match {match_id}")
    print("[test] scheduler patched: livestats=0.3, lolesports=0.5, ytdlp=5")
    print("[test] harvester max_game_minutes=65\n")

    report = await pipeline.run_moments_for_match(match_id)
    pipeline.print_moments_report(report)


if __name__ == "__main__":
    asyncio.run(main())
