"""
KCKILLS / LoLTok Worker — Asyncio supervised daemon.

Each module runs in its own task with auto-restart on crash.
Modules are independent — a crash in CLIPPER doesn't block HARVESTER.

Usage:
    python main.py                         # Start supervised daemon
    python main.py sentinel                # Run sentinel once
    python main.py harvester               # Run harvester once
    python main.py clipper                 # Run clipper once
    python main.py analyzer                # Run analyzer once
    python main.py og                      # Run og_generator once
    python main.py heartbeat               # Run heartbeat once
    python main.py watchdog                # Run watchdog once
    python main.py pipeline <match_ext_id> # End-to-end run on one match
    python main.py backfill [--limit N] [--from YYYY-MM-DD] [--resume]
                                           # Batch the full kc_matches.json
"""

from __future__ import annotations

import asyncio
import sys
import time
import traceback

import structlog

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.dev.ConsoleRenderer(),
    ]
)

log = structlog.get_logger()

# Module intervals in seconds. The order in the daemon is intentional:
# sentinel finds matches → harvester fills kills → clipper produces videos →
# analyzer tags them → og_generator publishes them.
DAEMON_MODULES: list[tuple[str, int, str]] = [
    # (name, interval_seconds, dotted import path)
    ("sentinel",      300,   "modules.sentinel"),      # 5 min
    ("harvester",     600,   "modules.harvester"),     # 10 min
    ("transitioner",  300,   "modules.transitioner"),  # 5 min — raw -> vod_found
    ("clipper",       300,   "modules.clipper"),       # 5 min
    ("analyzer",      600,   "modules.analyzer"),      # 10 min
    ("og_generator",  900,   "modules.og_generator"),  # 15 min
    ("moderator",     180,   "modules.moderator"),     # 3 min — Haiku comment moderation
    ("hls_packager",  1800,  "modules.hls_packager"),  # 30 min — HLS adaptive bitrate (5 clips/run)
    ("channel_discoverer", 21600, "modules.channel_discoverer"),  # 6h — Kameto pivot K-Phase 0
    ("match_planner", 3600,  "modules.match_planner"), # 1h — pre-schedule next 21d KC matches + boost jobs
    ("job_runner",    30,    "modules.job_runner"),    # 30s — admin-triggered jobs + boost dispatch
    ("heartbeat",     21600, "modules.heartbeat"),     # 6h
    ("watchdog",      1800,  "modules.watchdog"),      # 30 min
]

RESTART_DELAY = 10  # seconds between a module crash and its next attempt


async def supervised_task(name: str, interval: int, run_func):
    """Run a module in a loop with auto-restart on crash."""
    while True:
        try:
            start = time.monotonic()
            log.info("module_start", module=name)
            await run_func()
            elapsed = time.monotonic() - start
            log.info("module_done", module=name, elapsed_s=round(elapsed, 1))
        except Exception as e:
            log.error(
                "module_crash",
                module=name,
                error=str(e),
                traceback=traceback.format_exc()[:1500],
            )
            try:
                from services import discord_webhook
                await discord_webhook.notify_error(name, f"{type(e).__name__}: {e}")
            except Exception:
                pass
            await asyncio.sleep(RESTART_DELAY)
            continue

        await asyncio.sleep(interval)


async def run_daemon():
    """Start every module as an independent supervised asyncio task."""
    log.info("daemon_start", modules=[m[0] for m in DAEMON_MODULES])

    import importlib

    tasks: list[asyncio.Task] = []
    for name, interval, dotted in DAEMON_MODULES:
        try:
            mod = importlib.import_module(dotted)
        except Exception as e:
            log.error("module_import_failed", module=name, error=str(e))
            continue
        if not hasattr(mod, "run"):
            log.error("module_no_run", module=name)
            continue
        tasks.append(asyncio.create_task(
            supervised_task(name, interval, mod.run),
            name=name,
        ))

    # Daily report at 23:00 UTC
    async def daily_report_loop():
        from modules import watchdog as wd
        while True:
            await asyncio.sleep(3600)
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            if now.hour == 23:
                try:
                    await wd.send_daily_report()
                except Exception as e:
                    log.warn("daily_report_failed", error=str(e))

    tasks.append(asyncio.create_task(daily_report_loop(), name="daily_report"))

    log.info("daemon_running", task_count=len(tasks))

    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        log.info("daemon_stopped_by_user")
    except asyncio.CancelledError:
        log.info("daemon_cancelled")


async def run_once(module_name: str):
    """Run a single module once, then return."""
    aliases = {
        "og": "og_generator",
        "ogen": "og_generator",
        "harvest": "harvester",
        "clip": "clipper",
        "analyze": "analyzer",
        "watch": "watchdog",
    }
    canonical = aliases.get(module_name, module_name)

    import importlib
    try:
        mod = importlib.import_module(f"modules.{canonical}")
    except ModuleNotFoundError:
        log.error("unknown_module", module=module_name)
        print(f"Available: sentinel, harvester, clipper, analyzer, og, heartbeat, watchdog, pipeline <match_id>")
        return

    if not hasattr(mod, "run"):
        log.error("module_no_run", module=canonical)
        return

    await mod.run()


async def run_pipeline(match_external_id: str):
    """Run the end-to-end pipeline on a single match."""
    from modules import pipeline
    report = await pipeline.run_for_match(match_external_id)
    pipeline.print_report(report)


def main():
    argv = sys.argv[1:]

    if not argv:
        print("=" * 60)
        print("  KCKILLS / LoLTok Worker — daemon mode")
        print("=" * 60)
        asyncio.run(run_daemon())
        return

    command = argv[0].lower()

    if command == "pipeline":
        if len(argv) < 2:
            print("Usage: python main.py pipeline <match_external_id>")
            sys.exit(1)
        asyncio.run(run_pipeline(argv[1]))
        return

    if command == "backfill":
        from modules import backfill
        backfill.main_cli(argv[1:])
        return

    asyncio.run(run_once(command))


if __name__ == "__main__":
    main()
