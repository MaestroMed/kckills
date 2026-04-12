"""
Fast backfill runner — patches scheduler delays so 10 matches run in ~2.5h
instead of ~8h. Disposable wrapper around modules.backfill.

Usage:
    python backfill_fast.py                # top 10 newest matches
    python backfill_fast.py --limit 5      # top 5
    python backfill_fast.py --from 2026-02-01
"""

from __future__ import annotations

import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ─── Patch scheduler before importing anything that uses it ─────────────
from scheduler import scheduler
scheduler.DELAYS["livestats"] = 0.3
scheduler.DELAYS["lolesports_idle"] = 0.5
scheduler.DELAYS["lolesports_live"] = 0.5
scheduler.DELAYS["ytdlp"] = 5.0
# gemini stays at 4.0 (15 RPM cap), r2 at 0.5, ffmpeg cooldown at 5

# ─── Force the harvester to walk the full game ──────────────────────────
from modules import harvester  # noqa: E402
_orig_extract = harvester.extract_kills_from_game


async def _bounded_extract(*args, **kwargs):
    kwargs.setdefault("max_game_minutes", 65)
    kwargs.setdefault("max_consecutive_empty", 60)
    return await _orig_extract(*args, **kwargs)


harvester.extract_kills_from_game = _bounded_extract  # type: ignore[assignment]

from modules import backfill  # noqa: E402


def _parse_args(argv: list[str]) -> dict:
    opts: dict = {"limit": 10, "since": None, "resume": True}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--limit" and i + 1 < len(argv):
            opts["limit"] = int(argv[i + 1])
            i += 2
        elif a.startswith("--limit="):
            opts["limit"] = int(a.split("=", 1)[1])
            i += 1
        elif a == "--from" and i + 1 < len(argv):
            opts["since"] = argv[i + 1]
            i += 2
        elif a.startswith("--from="):
            opts["since"] = a.split("=", 1)[1]
            i += 1
        elif a == "--no-resume":
            opts["resume"] = False
            i += 1
        else:
            i += 1
    return opts


async def main():
    opts = _parse_args(sys.argv[1:])
    print(
        f"[backfill-fast] limit={opts['limit']} since={opts['since']} "
        f"resume={opts['resume']}"
    )
    print("[backfill-fast] scheduler patched: livestats=0.3, lolesports=0.5, ytdlp=5")
    print("[backfill-fast] harvester bounded: max_game_minutes=65")
    await backfill.run(
        limit=opts["limit"],
        since=opts["since"],
        resume=opts["resume"],
    )


if __name__ == "__main__":
    asyncio.run(main())
