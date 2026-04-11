"""
KCKills Worker — Main entry point.

Runs all 5 modules in a scheduled loop:
1. SENTINEL  — every 5 min: scan for new KC matches
2. HARVESTER — every 5 min: extract kills from new games
3. VOD_HUNTER — every 10 min: find VODs and calibrate offsets
4. CLIPPER   — every 5 min: clip kills and upload to R2
5. WATCHDOG  — every 30 min: monitor pipeline health

Usage:
    python -m src.main          # Run the full worker daemon
    python -m src.main sentinel # Run only the sentinel once
    python -m src.main harvest  # Run only the harvester once
    python -m src.main vod      # Run only the VOD hunter once
    python -m src.main clip     # Run only the clipper once
    python -m src.main watch    # Run only the watchdog once
"""

import sys
import time
import traceback
from datetime import datetime, timezone

import schedule

from . import sentinel, harvester, vod_hunter, clipper, watchdog
from .config import config
from .db import log


def safe_run(module_name: str, func):
    """Run a module function with error handling."""
    try:
        start = time.time()
        func()
        elapsed = time.time() - start
        log("info", "main", f"{module_name} completed in {elapsed:.1f}s")
    except Exception as e:
        error_msg = f"{module_name} failed: {e}\n{traceback.format_exc()}"
        log("error", "main", error_msg)
        try:
            watchdog.notify_error(module_name, str(e))
        except Exception:
            pass


def run_all_once():
    """Run all modules once (useful for testing)."""
    print(f"[{datetime.now(timezone.utc).isoformat()}] Running all modules...")
    safe_run("sentinel", sentinel.run)
    safe_run("harvester", harvester.run)
    safe_run("vod_hunter", vod_hunter.run)
    safe_run("clipper", clipper.run)
    safe_run("watchdog", watchdog.run)
    print("Done.")


def start_daemon():
    """Start the worker as a daemon with scheduled tasks."""
    print("=" * 60)
    print("  KCKills Worker — Starting daemon")
    print(f"  Poll interval: {config.POLL_INTERVAL}s")
    print(f"  Team: {config.KC_TEAM_NAME}")
    print(f"  Clip window: -{config.CLIP_BEFORE}s / +{config.CLIP_AFTER}s")
    print("=" * 60)

    log("info", "main", "Worker daemon started", {
        "poll_interval": config.POLL_INTERVAL,
        "team": config.KC_TEAM_NAME,
    })

    # Schedule modules
    schedule.every(config.POLL_INTERVAL).seconds.do(
        safe_run, "sentinel", sentinel.run
    )
    schedule.every(config.POLL_INTERVAL).seconds.do(
        safe_run, "harvester", harvester.run
    )
    schedule.every(config.POLL_INTERVAL * 2).seconds.do(
        safe_run, "vod_hunter", vod_hunter.run
    )
    schedule.every(config.POLL_INTERVAL).seconds.do(
        safe_run, "clipper", clipper.run
    )
    schedule.every(1800).seconds.do(
        safe_run, "watchdog", watchdog.run
    )

    # Run everything once at startup
    run_all_once()

    # Enter the schedule loop
    print(f"\nDaemon running. Next check in {config.POLL_INTERVAL}s...")
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down gracefully...")
        log("info", "main", "Worker daemon stopped by user")


def main():
    if len(sys.argv) > 1:
        command = sys.argv[1].lower()
        commands = {
            "sentinel": ("sentinel", sentinel.run),
            "harvest": ("harvester", harvester.run),
            "harvester": ("harvester", harvester.run),
            "vod": ("vod_hunter", vod_hunter.run),
            "vod_hunter": ("vod_hunter", vod_hunter.run),
            "clip": ("clipper", clipper.run),
            "clipper": ("clipper", clipper.run),
            "watch": ("watchdog", watchdog.run),
            "watchdog": ("watchdog", watchdog.run),
            "once": ("all", run_all_once),
        }

        if command in commands:
            name, func = commands[command]
            if command == "once":
                func()
            else:
                safe_run(name, func)
        else:
            print(f"Unknown command: {command}")
            print("Available: sentinel, harvest, vod, clip, watch, once")
            sys.exit(1)
    else:
        start_daemon()


if __name__ == "__main__":
    main()
