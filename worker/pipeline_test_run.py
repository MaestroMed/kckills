"""
One-shot pipeline test runner.

Patches scheduler delays for fast feedback and shorts the harvester walk
window so the first end-to-end test completes in 10-15 minutes instead of
~50. Disposable script — once the pipeline is proven we run it via
`python main.py pipeline <match_id>` with default delays.
"""

from __future__ import annotations

import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ─── Patch scheduler delays for the test ──────────────────────────────
from scheduler import scheduler
scheduler.DELAYS["livestats"] = 0.3
scheduler.DELAYS["lolesports_idle"] = 0.5
scheduler.DELAYS["lolesports_live"] = 0.5
scheduler.DELAYS["ytdlp"] = 5.0
# gemini stays at 4.0 (15 RPM cap), r2 at 0.5, ffmpeg cooldown at 5

# ─── Limit harvester walk window to early-mid game ────────────────────
from modules import harvester
_orig_extract = harvester.extract_kills_from_game


async def _limited_extract(*args, **kwargs):
    kwargs.setdefault("max_game_minutes", 65)
    kwargs.setdefault("max_consecutive_empty", 60)
    return await _orig_extract(*args, **kwargs)


harvester.extract_kills_from_game = _limited_extract  # type: ignore[assignment]

# ─── Run the pipeline ────────────────────────────────────────────────
from modules import pipeline


async def main():
    match_id = sys.argv[1] if len(sys.argv) > 1 else "115548668059523724"
    print(f"\n[test] running pipeline.run_for_match({match_id!r})")
    print("[test] scheduler delays patched: livestats=0.3, lolesports=0.5, ytdlp=5")
    print("[test] harvester max_game_minutes=15 (early-mid game only)\n")
    report = await pipeline.run_for_match(match_id)
    pipeline.print_report(report)


if __name__ == "__main__":
    asyncio.run(main())
