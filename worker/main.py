"""
LoLTok Worker — Asyncio supervised daemon.

Each module runs in its own task with auto-restart on crash.
Modules are independent — a crash in CLIPPER doesn't block HARVESTER.

Usage:
    python main.py              # Start daemon
    python main.py sentinel     # Run only sentinel once
    python main.py harvester    # Run only harvester once
    python main.py watchdog     # Run only watchdog once
"""

import sys
import asyncio
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

# Module intervals (seconds)
MODULE_CONFIG = {
    "sentinel":  {"interval": 300,  "module": "modules.sentinel"},
    "harvester": {"interval": 300,  "module": "modules.harvester"},
    "clipper":   {"interval": 300,  "module": "modules.clipper"},
    "analyzer":  {"interval": 300,  "module": "modules.analyzer"},
    "watchdog":  {"interval": 1800, "module": "modules.watchdog"},
}

RESTART_DELAY = 10  # seconds before restarting a crashed task


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
            log.error("module_crash", module=name, error=str(e),
                      traceback=traceback.format_exc()[:1000])
            try:
                from services import discord_webhook
                await discord_webhook.notify_error(name, str(e))
            except Exception:
                pass

        await asyncio.sleep(interval)


async def run_daemon():
    """Start all modules as supervised asyncio tasks."""
    log.info("daemon_start", modules=list(MODULE_CONFIG.keys()))

    tasks = []

    # Sentinel
    from modules import sentinel
    tasks.append(asyncio.create_task(
        supervised_task("sentinel", 300, sentinel.run),
        name="sentinel"
    ))

    # VOD Hunter
    from modules import vod_hunter
    tasks.append(asyncio.create_task(
        supervised_task("vod_hunter", 600, vod_hunter.run),
        name="vod_hunter"
    ))

    # Heartbeat (every 6h to prevent Supabase pause)
    from modules import heartbeat
    tasks.append(asyncio.create_task(
        supervised_task("heartbeat", 21600, heartbeat.run),
        name="heartbeat"
    ))

    # Watchdog
    from modules import watchdog
    tasks.append(asyncio.create_task(
        supervised_task("watchdog", 1800, watchdog.run),
        name="watchdog"
    ))

    # Daily report at 23:00 UTC
    async def daily_report_loop():
        from modules import watchdog as wd
        while True:
            await asyncio.sleep(3600)  # check every hour
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            if now.hour == 23:
                await wd.send_daily_report()

    tasks.append(asyncio.create_task(daily_report_loop(), name="daily_report"))

    log.info("daemon_running", task_count=len(tasks))

    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        log.info("daemon_stopped_by_user")
    except asyncio.CancelledError:
        log.info("daemon_cancelled")


async def run_once(module_name: str):
    """Run a single module once."""
    modules_map = {
        "sentinel": "modules.sentinel",
        "watchdog": "modules.watchdog",
        "vod_hunter": "modules.vod_hunter",
        "heartbeat": "modules.heartbeat",
    }
    if module_name in modules_map:
        import importlib
        mod = importlib.import_module(modules_map[module_name])
        await mod.run()
    else:
        log.error("unknown_module", module=module_name)
        print(f"Available: {', '.join(modules_map.keys())}")


def main():
    if len(sys.argv) > 1:
        module = sys.argv[1].lower()
        asyncio.run(run_once(module))
    else:
        print("=" * 50)
        print("  LoLTok Worker — Starting daemon")
        print("=" * 50)
        asyncio.run(run_daemon())


if __name__ == "__main__":
    main()
