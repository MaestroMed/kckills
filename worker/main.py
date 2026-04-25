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
import io
import os
import sys
import time
import traceback

# ─── Force UTF-8 console output on Windows ───────────────────────────
# Without this, structlog's ConsoleRenderer crashes on emoji-bearing
# log lines (Kameto YouTube titles like "💀 Kameto bouge un Sett 😳")
# because the default Windows console codepage is cp1252 which can't
# encode anything outside Latin-1. The result is a UnicodeEncodeError
# inside the log handler that bubbles up as `error="'charmap' codec
# can't encode character '\\U0001f602'"`. The errors don't break the
# pipeline (the log line is dropped) but they pollute the output and
# we lose the actual title we were trying to log.
#
# stdout.reconfigure(encoding='utf-8', errors='replace') was added in
# Python 3.7 and is a no-op on already-UTF-8 streams (Linux/macOS).
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, io.UnsupportedOperation):
        # Older Python or a stream that can't be reconfigured (e.g.
        # piped through `tee`). Fall back to wrapping with TextIOWrapper.
        try:
            sys.stdout = io.TextIOWrapper(  # type: ignore[assignment]
                sys.stdout.buffer, encoding="utf-8", errors="replace",
                line_buffering=True,
            )
            sys.stderr = io.TextIOWrapper(  # type: ignore[assignment]
                sys.stderr.buffer, encoding="utf-8", errors="replace",
                line_buffering=True,
            )
        except Exception:
            pass  # last-resort — keep going with whatever we have
    # Belt-and-braces: also tell child Python processes (subprocess,
    # admin_job_runner) to use UTF-8 by default.
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

# ─── Make `deno` discoverable by yt-dlp subprocesses ────────────────
# yt-dlp ≥2026-04 needs a JavaScript runtime + EJS challenge solver
# script to resolve YouTube's n-decoder. Without these, `--list-formats`
# only returns image streams and the actual video download fails with
# "Requested format is not available". Deno is the default supported
# runtime per yt-dlp's EJS docs. Installed via winget on this machine,
# but lives in a non-standard path — prepend it so subprocesses inherit.
_DENO_CANDIDATES = [
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe"),
    os.path.expandvars(r"%USERPROFILE%\.deno\bin"),
    r"C:\Program Files\deno",
]
for _deno_dir in _DENO_CANDIDATES:
    if os.path.isfile(os.path.join(_deno_dir, "deno.exe")):
        _current_path = os.environ.get("PATH", "")
        if _deno_dir not in _current_path:
            os.environ["PATH"] = _deno_dir + os.pathsep + _current_path
        break

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
    ("event_mapper",  600,   "modules.event_mapper"),  # 10 min — populate canonical game_events table (PR6-B)
    ("transitioner",  300,   "modules.transitioner"),  # 5 min — raw -> vod_found
    ("vod_offset_finder", 3600, "modules.vod_offset_finder_v2"),  # 1h — multi-candidate scan (PR23.3 - replaces v1 which bailed instantly when Gemini reads NONE; v2 walks forward in 90s steps to find gameplay)
    ("clipper",       300,   "modules.clipper"),       # 5 min
    ("analyzer",      600,   "modules.analyzer"),      # 10 min
    ("og_generator",  900,   "modules.og_generator"),  # 15 min
    ("event_publisher", 300, "modules.event_publisher"), # 5 min — bridge game_events.is_publishable -> kills.status (PR6-D)
    ("embedder",      1800,  "modules.embedder"),      # 30 min — Gemini text-embedding-004 -> kills.embedding for similarity (PR17)
    ("moderator",     180,   "modules.moderator"),     # 3 min — Haiku comment moderation
    ("discord_autopost", 60, "modules.discord_autopost"), # 60s — auto-share high-score kills to Discord webhook (PR-arch P2 Phase 3)
    ("hls_packager",  1800,  "modules.hls_packager"),  # 30 min — HLS adaptive bitrate (5 clips/run)
    ("channel_discoverer", 21600, "modules.channel_discoverer"),  # 6h — Kameto pivot K-Phase 0
    ("channel_reconciler", 3600, "modules.channel_reconciler"),   # 1h — K-Phase 1 (channel_videos -> matches)
    ("vod_fallback_finder", 1800, "modules.vod_fallback_finder"), # 30 min — bridge reconciled videos -> game_vod_sources / games.vod_youtube_id
    ("match_planner", 3600,  "modules.match_planner"), # 1h — pre-schedule next 21d KC matches + boost jobs
    ("qc_sampler",    21600, "modules.qc_sampler"),    # 6h — random 2% sampling -> clip_qc.verify (Gemini drift)
    ("job_runner",    30,    "modules.job_runner"),    # 30s — admin-triggered jobs + boost dispatch
    ("job_dispatcher", 60,   "modules.job_dispatcher"), # 60s — bridge legacy kills.status -> pipeline_jobs
    ("admin_job_runner", 30, "modules.admin_job_runner"), # 30s — claim+exec worker.backfill jobs (whitelisted scripts)
    ("heartbeat",     21600, "modules.heartbeat"),     # 6h
    ("watchdog",      1800,  "modules.watchdog"),      # 30 min
    ("queue_health",  300,   "modules.queue_health"),  # 5 min — Wave 6 P2 : stale-lock release + queue-depth snapshot + Discord pings on threshold breach
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
