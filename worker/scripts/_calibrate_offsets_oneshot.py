"""One-shot: drain the vod_offset_seconds IS NULL backlog outside the daemon.

The daemon runs vod_offset_finder_v2 at GAMES_PER_RUN=5 every ~76 min
(interval 3600 + run time) => ~10h for a 60-game backlog. This loop runs
back-to-back batches until run() reports nothing left. Writes are the same
idempotent PATCHes the daemon does; safe to run alongside it (worst case a
game gets calibrated twice with the same result).
"""
import asyncio
import sys
from pathlib import Path

_WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_WORKER_ROOT))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from modules import vod_offset_finder_v2 as m  # noqa: E402

m.GAMES_PER_RUN = 10


async def main() -> None:
    total = 0
    for i in range(30):  # hard cap: 300 games
        n = await m.run()
        total += n or 0
        print(f"[batch {i+1}] fixed={n} total={total}", flush=True)
        if not n:
            break
    print(f"DONE total={total}")


if __name__ == "__main__":
    asyncio.run(main())
