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

# ─── Sentry init (Wave 11 / DB) ──────────────────────────────────────
# Must run BEFORE structlog so the SDK can hook into stdlib logging
# early. No-op when KCKILLS_SENTRY_DSN_WORKER is unset — see
# services/observability_sentry.py for the full design.
try:
    from services.observability_sentry import init_sentry as _init_sentry
    _init_sentry()
except Exception:
    # Defensive : Sentry must NEVER block the worker from starting,
    # even if its own init blows up.
    pass

import structlog

# Wave 14 (2026-05-07) — switch to JSONRenderer when KCKILLS_ENV=production
# so logs are parseable by Loki / Sentry / Datadog. ConsoleRenderer stays
# the default for dev because it's much easier to read interactively.
# Operator can force either explicitly via KCKILLS_LOG_FORMAT={console,json}.
_log_format = (os.environ.get("KCKILLS_LOG_FORMAT", "") or "").lower()
if not _log_format:
    _log_format = "json" if os.environ.get("KCKILLS_ENV", "").lower() == "production" else "console"
_renderer = (
    structlog.processors.JSONRenderer()
    if _log_format == "json"
    else structlog.dev.ConsoleRenderer()
)
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        _renderer,
    ]
)

log = structlog.get_logger()

# Module intervals are now resolved via services.runtime_tuning :
#   * KCKILLS_INTERVAL_<MODULE>=N  → operator override per module
#   * KCKILLS_LOW_POWER=1          → doubles every interval (gaming mode)
#   * Otherwise the DEFAULTS table in runtime_tuning provides the
#     historic values listed in the comments below — same numbers as
#     before this knob existed, so worker behaviour is byte-identical
#     when no env var is set.
#
# The order is intentional: sentinel finds matches → harvester fills
# kills → clipper produces videos → analyzer tags them → og_generator
# publishes them.
from services.runtime_tuning import get_interval as _get_interval

DAEMON_MODULES: list[tuple[str, int, str]] = [
    # (name, interval_seconds, dotted import path)
    ("sentinel",          _get_interval("sentinel"),          "modules.sentinel"),               # default 300s   — 5 min
    ("harvester",         _get_interval("harvester"),         "modules.harvester"),              # default 600s   — 10 min
    ("event_mapper",      _get_interval("event_mapper"),      "modules.event_mapper"),           # default 600s   — populate canonical game_events table (PR6-B)
    ("transitioner",      _get_interval("transitioner"),      "modules.transitioner"),           # default 300s   — raw -> vod_found
    ("vod_offset_finder", _get_interval("vod_offset_finder"), "modules.vod_offset_finder_v2"),   # default 3600s  — multi-candidate scan (PR23.3)
    ("clipper",           _get_interval("clipper"),           "modules.clipper"),                # default 300s   — 5 min
    ("analyzer",          _get_interval("analyzer"),          "modules.analyzer"),               # default 600s   — 10 min
    ("og_generator",      _get_interval("og_generator"),      "modules.og_generator"),           # default 900s   — 15 min
    ("event_publisher",   _get_interval("event_publisher"),   "modules.event_publisher"),        # default 300s   — bridge game_events.is_publishable -> kills.status (PR6-D)
    ("embedder",          _get_interval("embedder"),          "modules.embedder"),               # default 1800s  — Gemini embedding-001 -> kills.embedding (PR17)
    ("translator",        _get_interval("translator"),        "modules.translator"),             # default 1800s  — Wave 11 : DeepSeek FR->EN/KO/ES (gated KCKILLS_TRANSLATOR_ENABLED)
    ("moderator",         _get_interval("moderator"),         "modules.moderator"),              # default 180s   — Haiku comment moderation
    ("discord_autopost",  _get_interval("discord_autopost"),  "modules.discord_autopost"),       # default 60s    — auto-share high-score kills (P2 Phase 3)
    ("hls_packager",      _get_interval("hls_packager"),      "modules.hls_packager"),           # default 1800s  — HLS adaptive bitrate
    ("channel_discoverer",  _get_interval("channel_discoverer"),  "modules.channel_discoverer"), # default 21600s — Kameto pivot K-Phase 0
    ("channel_reconciler",  _get_interval("channel_reconciler"),  "modules.channel_reconciler"), # default 3600s  — K-Phase 1
    ("vod_fallback_finder", _get_interval("vod_fallback_finder"), "modules.vod_fallback_finder"),# default 1800s  — bridge reconciled videos -> game_vod_sources
    ("match_planner",     _get_interval("match_planner"),     "modules.match_planner"),          # default 3600s  — pre-schedule next 21d KC matches
    ("qc_sampler",        _get_interval("qc_sampler"),        "modules.qc_sampler"),             # default 21600s — random 2% sampling
    ("job_runner",        _get_interval("job_runner"),        "modules.job_runner"),             # default 30s    — admin-triggered jobs + boost dispatch
    ("job_dispatcher",    _get_interval("job_dispatcher"),    "modules.job_dispatcher"),         # default 60s    — bridge legacy kills.status -> pipeline_jobs
    ("admin_job_runner",  _get_interval("admin_job_runner"),  "modules.admin_job_runner"),       # default 30s    — claim+exec worker.backfill jobs
    ("heartbeat",         _get_interval("heartbeat"),         "modules.heartbeat"),              # default 21600s — 6h
    ("watchdog",          _get_interval("watchdog"),          "modules.watchdog"),               # default 1800s  — 30 min
    ("queue_health",      _get_interval("queue_health"),      "modules.queue_health"),           # default 300s   — Wave 6 P2 : stale-lock + queue snapshot
    ("dlq_drainer",       _get_interval("dlq_drainer"),       "modules.dlq_drainer"),            # default 1800s  — Wave 9 : auto-recover fresh DLQ entries
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

    # Wave 13f: NOT migrated to TaskGroup — this is the supervisor itself.
    # Each `tasks` entry is a `supervised_task(...)` wrapper that catches
    # per-module exceptions and respawns the module after RESTART_DELAY,
    # so the gathered tasks should never raise in normal operation. If
    # they did (rare bug), TaskGroup would CANCEL ALL OTHER MODULES, which
    # is the OPPOSITE of the crash-isolation guarantee the daemon provides.
    # Keep gather() so a freak crash in one module's supervisor wrapper
    # cannot take down sentinel/harvester/clipper/analyzer with it.
    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        log.info("daemon_stopped_by_user")
    except asyncio.CancelledError:
        log.info("daemon_cancelled")
    finally:
        # Wave 27.2 — drain the pooled httpx clients so the asyncio loop
        # can close cleanly without "Unclosed client session" warnings.
        try:
            from services import http_pool, supabase_client as _sb, task_supervisor
            # Wave 27.9 — let in-flight bg tasks finish (5s budget) so
            # we don't kill a supabase_batch flusher mid-write or a
            # boost loop that's about to log its "done" line.
            drained = await task_supervisor.drain(timeout=5.0)
            if drained:
                log.info("bg_tasks_drained", count=drained)
            await http_pool.close_all()
            _sb.close_db()
        except Exception as e:
            log.warn("http_pool_close_failed", error=str(e)[:160])


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

    try:
        await mod.run()
    finally:
        # Wave 27.2 — same as the daemon path : close pooled clients
        # before asyncio.run() tears down the loop, avoiding spurious
        # "Unclosed client session" warnings on one-shot module runs.
        try:
            from services import http_pool, supabase_client as _sb, task_supervisor
            # Wave 27.9 — let in-flight bg tasks finish (5s budget) so
            # we don't kill a supabase_batch flusher mid-write or a
            # boost loop that's about to log its "done" line.
            drained = await task_supervisor.drain(timeout=5.0)
            if drained:
                log.info("bg_tasks_drained", count=drained)
            await http_pool.close_all()
            _sb.close_db()
        except Exception as e:
            log.warn("http_pool_close_failed", error=str(e)[:160])


async def run_pipeline(match_external_id: str):
    """Run the end-to-end pipeline on a single match."""
    from modules import pipeline
    try:
        report = await pipeline.run_for_match(match_external_id)
        pipeline.print_report(report)
    finally:
        try:
            from services import http_pool, supabase_client as _sb, task_supervisor
            # Wave 27.9 — let in-flight bg tasks finish (5s budget) so
            # we don't kill a supabase_batch flusher mid-write or a
            # boost loop that's about to log its "done" line.
            drained = await task_supervisor.drain(timeout=5.0)
            if drained:
                log.info("bg_tasks_drained", count=drained)
            await http_pool.close_all()
            _sb.close_db()
        except Exception as e:
            log.warn("http_pool_close_failed", error=str(e)[:160])


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
