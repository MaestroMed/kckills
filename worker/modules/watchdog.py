"""
WATCHDOG — Pipeline health monitor + daily report.

Wave 6 hardening (PR-arch P2) :

  * stuck_kill_reset is now QUEUE-AWARE. The legacy logic blindly reset
    any kill stuck > 4h in {clipping, vod_found} back to 'raw' regardless
    of whether a worker was actively holding a pipeline_jobs lease for it.
    With the lease-locked queue (migration 024 + 025) this caused the
    watchdog to step on legitimate work : the row would flip back to
    'raw', the dispatcher would re-enqueue it, and the original worker
    that was halfway through the upload would commit on top, leaking
    half-clips into R2.

    The new reset SKIPS any kill that has an active lease for its kind
    (clip.create / clipping for status='clipping', vod.offset_find /
    vod.reconcile for status='vod_found'). It also bumps the threshold
    from 4h to 24h for {clipping, vod_found, clipped, analyzed} — the
    queue's own retry path handles transient failures, no need to rush.

  * Daily report is RICHER. Adds :
        - Top 5 worst error_codes in pipeline_runs last 24h
        - dead_letter_jobs growth (today vs yesterday)
        - Per-module run count + p50/p95/p99 latency
        - Queue depth per kind (pipeline_jobs.status='pending')
        - kills_published_today (real metric, not the indexed approx)

Discord calls are wrapped in try/except — the daily report never blocks
the watchdog loop.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
import structlog

from local_cache import cache
from scheduler import scheduler
from services import discord_webhook
from services.observability import note, run_logged
from services.supabase_client import get_db, safe_select, safe_update

log = structlog.get_logger()


# ─── Reset thresholds ────────────────────────────────────────────────

# Wave 6 : the stuck threshold for queue-managed statuses gets bumped
# from 4h → 24h. The lease-locked queue gives natural retry — a lease
# expires after 5 min, fn_release_stale_pipeline_locks frees it after
# 60 min, and the dispatcher re-enqueues from kills.status if needed.
# Watchdog's reset is the LAST-RESORT before manual_review, not the
# first line of defense. 24h means we only act after a full day with no
# progress.
STUCK_THRESHOLD_HOURS_BY_STATUS: dict[str, float] = {
    "clipping":     24.0,
    "vod_found":    24.0,
    "clipped":      24.0,
    "analyzed":     24.0,
    # Legacy fallbacks for statuses NOT covered by the new queue. These
    # keep the original 4h behavior because no job-queue path protects them.
    "enriched":      4.0,
}

# Map kills.status → the pipeline_jobs.type that's expected to be
# actively working it. If we find an active claim for the entity, we
# SKIP the reset.
STATUS_TO_ACTIVE_JOB_TYPE: dict[str, list[str]] = {
    "clipping":   ["clip.create", "clip.reclip"],
    "vod_found":  ["clip.create"],
    "clipped":    ["clip.analyze"],
    "analyzed":   ["og.generate", "embedding.compute", "event.map"],
}


# ─── Queue-awareness helpers ─────────────────────────────────────────

def _kill_has_active_job(db, kill_id: str, job_types: list[str]) -> bool:
    """Return True if any pipeline_jobs row for this kill_id is in
    'pending' or 'claimed' status for any of the given types.

    Used to skip the legacy stuck-kill reset when the new queue has
    an in-flight job for the same entity.
    """
    if db is None or not kill_id or not job_types:
        return False
    types_filter = "in.(" + ",".join(job_types) + ")"
    try:
        client = db._get_client()
        r = client.get(
            f"{db.base}/pipeline_jobs",
            params={
                "select": "id",
                "entity_type": "eq.kill",
                "entity_id": f"eq.{kill_id}",
                "type": types_filter,
                "status": "in.(pending,claimed)",
                "limit": "1",
            },
        )
        r.raise_for_status()
        rows = r.json() or []
        return len(rows) > 0
    except Exception as e:
        log.warn("watchdog_active_job_check_failed",
                 kill_id=kill_id[:8] if kill_id else "?",
                 error=str(e)[:160])
        # Conservative : on error, treat as "active" (safer to skip
        # reset than to step on a real worker).
        return True


# ─── stuck_kill_reset ─────────────────────────────────────────────────

def stuck_kill_reset() -> dict[str, int]:
    """Walk known transitional statuses and reset truly-stuck rows.

    Returns counters {reset, skipped_active_job, skipped_recent}.
    Errors on individual rows are logged + swallowed so the loop
    doesn't bail mid-iteration.
    """
    db = get_db()
    counters = {"reset": 0, "skipped_active_job": 0, "skipped_recent": 0}

    for status, threshold_hours in STUCK_THRESHOLD_HOURS_BY_STATUS.items():
        rows = safe_select("kills", "id, status, updated_at", status=status)
        active_job_types = STATUS_TO_ACTIVE_JOB_TYPE.get(status, [])

        for kill in rows:
            updated = kill.get("updated_at", "")
            kill_id = kill.get("id")
            if not updated or not kill_id:
                continue
            try:
                updated_dt = datetime.fromisoformat(
                    str(updated).replace("Z", "+00:00")
                )
            except ValueError:
                continue
            age_hours = (
                datetime.now(timezone.utc) - updated_dt
            ).total_seconds() / 3600

            if age_hours <= threshold_hours:
                counters["skipped_recent"] += 1
                continue

            # Check if an active queue job is working this kill — if so,
            # don't step on it.
            if active_job_types and _kill_has_active_job(
                db, kill_id, active_job_types
            ):
                counters["skipped_active_job"] += 1
                log.info(
                    "stuck_kill_reset_skip_active_job",
                    kill_id=kill_id, status=status,
                    age_hours=round(age_hours, 1),
                    job_types=active_job_types,
                )
                continue

            try:
                safe_update(
                    "kills",
                    {"status": "raw", "retry_count": 0},
                    "id", kill_id,
                )
                counters["reset"] += 1
                log.warn(
                    "stuck_kill_reset",
                    kill_id=kill_id, status=status,
                    hours=round(age_hours, 1),
                    threshold_h=threshold_hours,
                )
            except Exception as e:
                log.warn(
                    "stuck_kill_reset_failed",
                    kill_id=kill_id, error=str(e)[:160],
                )

    return counters


# ─── Daily report data collection ────────────────────────────────────

def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Compute pth percentile from a pre-sorted list, linear interp.
    Returns 0.0 for empty list. pct is 0-100."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    k = (len(sorted_values) - 1) * (pct / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(sorted_values[int(k)])
    return float(
        sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)
    )


def _fetch_pipeline_runs_24h(db) -> list[dict]:
    """Pull module_name + status + duration_ms + error_summary for the
    last 24h. Returns [] on any error.

    PostgREST request paginates implicitly to 1000 rows ; for the
    daily window we care about, that's plenty (17 modules × ~720
    runs/day at 5-min cadence ≈ 12k rows worst case — but failures
    are rare, so we focus on the failed subset for the error_codes
    table and grab the rest in batches if need be).
    """
    if db is None:
        return []
    try:
        client = db._get_client()
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        r = client.get(
            f"{db.base}/pipeline_runs",
            params={
                "select": "module_name,status,duration_ms,error_summary,started_at",
                "started_at": f"gte.{cutoff}",
                "order": "started_at.desc",
                "limit": "5000",
            },
        )
        r.raise_for_status()
        return r.json() or []
    except Exception as e:
        log.warn("watchdog_fetch_runs_failed", error=str(e)[:160])
        return []


def _top_error_codes(runs: list[dict], n: int = 5) -> list[dict]:
    """Aggregate failed runs by the first token of error_summary
    (which by convention is the exception class name, e.g. 'HTTPError'
    or 'ValueError'). Returns top n by count, with a sample message.
    """
    buckets: dict[str, dict[str, Any]] = {}
    for run in runs:
        if (run.get("status") or "").lower() != "failed":
            continue
        summary = (run.get("error_summary") or "").strip()
        if not summary:
            continue
        # First token before ':' = error class name (per observability
        # convention : f"{type(e).__name__}: {e}").
        code = summary.split(":", 1)[0].strip()[:80] or "unknown"
        b = buckets.setdefault(code, {"count": 0, "sample": summary[:200]})
        b["count"] += 1
    out = [
        {"code": k, "count": v["count"], "sample": v["sample"]}
        for k, v in buckets.items()
    ]
    out.sort(key=lambda r: r["count"], reverse=True)
    return out[:n]


def _per_module_latency(runs: list[dict]) -> dict[str, dict[str, Any]]:
    """Per-module run count + p50/p95/p99 latency in ms."""
    by_mod: dict[str, list[float]] = {}
    for run in runs:
        mod = run.get("module_name") or "unknown"
        d = run.get("duration_ms")
        if d is None:
            continue
        try:
            by_mod.setdefault(mod, []).append(float(d))
        except (TypeError, ValueError):
            continue

    out: dict[str, dict[str, Any]] = {}
    for mod, values in by_mod.items():
        values.sort()
        out[mod] = {
            "count": len(values),
            "p50_ms": int(_percentile(values, 50)),
            "p95_ms": int(_percentile(values, 95)),
            "p99_ms": int(_percentile(values, 99)),
        }
    return out


def _dlq_growth(db) -> dict[str, int]:
    """Count dead_letter_jobs added today vs yesterday (UTC days)."""
    if db is None:
        return {"today": 0, "yesterday": 0}
    try:
        client = db._get_client()
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - timedelta(days=1)

        def _count(start, end=None) -> int:
            params = {
                "select": "id",
                "failed_at": f"gte.{start.isoformat()}",
                "limit": "1",
            }
            if end is not None:
                params["failed_at"] = f"gte.{start.isoformat()}"
                # PostgREST allows multiple filter params on the same column
                # via Prefer comma-syntax — easier to do two GETs here.
            r = client.get(
                f"{db.base}/dead_letter_jobs",
                params=params,
                headers={**db.headers, "Prefer": "count=exact"},
            )
            r.raise_for_status()
            cr = r.headers.get("content-range") or ""
            if "/" in cr:
                tail = cr.split("/")[-1]
                if tail and tail != "*":
                    try:
                        return int(tail)
                    except ValueError:
                        return 0
            return 0

        # "today" = since today_start. "yesterday total" = since yesterday_start
        # MINUS today's count = yesterday's count alone.
        today_n = _count(today_start)
        yesterday_plus_today = _count(yesterday_start)
        yesterday_n = max(0, yesterday_plus_today - today_n)
        return {"today": today_n, "yesterday": yesterday_n}
    except Exception as e:
        log.warn("watchdog_dlq_growth_failed", error=str(e)[:160])
        return {"today": 0, "yesterday": 0}


def _queue_depth_per_kind(db) -> dict[str, int]:
    """pipeline_jobs.status='pending' grouped by type. Returns {type: count}."""
    if db is None:
        return {}
    try:
        client = db._get_client()
        # We don't have a built-in GROUP BY in PostgREST without an RPC ;
        # iterate the known kinds and fetch a count per. Slow O(N) HTTP
        # calls but N <= ~25 and this is a once-a-day report.
        from modules.queue_health import JOB_KINDS
        out: dict[str, int] = {}
        for kind in JOB_KINDS:
            r = client.get(
                f"{db.base}/pipeline_jobs",
                params={
                    "select": "id",
                    "type": f"eq.{kind}",
                    "status": "eq.pending",
                    "limit": "1",
                },
                headers={**db.headers, "Prefer": "count=exact"},
            )
            try:
                r.raise_for_status()
                cr = r.headers.get("content-range") or ""
                if "/" in cr:
                    tail = cr.split("/")[-1]
                    if tail and tail != "*":
                        try:
                            n = int(tail)
                            if n > 0:
                                out[kind] = n
                        except ValueError:
                            pass
            except Exception:
                continue
        return out
    except Exception as e:
        log.warn("watchdog_queue_depth_failed", error=str(e)[:160])
        return {}


def _kills_published_today(db) -> int:
    """Real count of kills with status='published' updated today."""
    if db is None:
        return 0
    try:
        client = db._get_client()
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        r = client.get(
            f"{db.base}/kills",
            params={
                "select": "id",
                "status": "eq.published",
                "updated_at": f"gte.{today_start.isoformat()}",
                "limit": "1",
            },
            headers={**db.headers, "Prefer": "count=exact"},
        )
        r.raise_for_status()
        cr = r.headers.get("content-range") or ""
        if "/" in cr:
            tail = cr.split("/")[-1]
            if tail and tail != "*":
                try:
                    return int(tail)
                except ValueError:
                    return 0
        return 0
    except Exception as e:
        log.warn("watchdog_kills_published_failed", error=str(e)[:160])
        return 0


# ─── @run_logged main loop ────────────────────────────────────────────

@run_logged()
async def run() -> dict:
    """Check pipeline health, reset stuck kills (queue-aware), flush cache."""

    # Flush local cache if pending
    pending = cache.pending_count()
    if pending > 0:
        from services.supabase_client import flush_cache
        flushed = await flush_cache()
        log.info("cache_flush", pending=pending, flushed=flushed)

    # Reset stuck kills (queue-aware)
    reset_stats = stuck_kill_reset()

    # Scheduler stats
    stats = scheduler.get_stats()
    log.info(
        "watchdog_stats",
        gemini_remaining=stats["daily_remaining"].get("gemini", "?"),
        youtube_remaining=stats["daily_remaining"].get("youtube_search", "?"),
        cache_pending=cache.pending_count(),
        stuck_reset=reset_stats["reset"],
        stuck_skipped_active_job=reset_stats["skipped_active_job"],
        stuck_skipped_recent=reset_stats["skipped_recent"],
    )

    note(
        items_scanned=reset_stats["reset"]
                       + reset_stats["skipped_active_job"]
                       + reset_stats["skipped_recent"],
        items_processed=reset_stats["reset"],
        items_skipped=reset_stats["skipped_active_job"]
                       + reset_stats["skipped_recent"],
        cache_pending=pending,
        gemini_remaining=stats["daily_remaining"].get("gemini", -1),
    )

    return {
        "items_scanned": reset_stats["reset"]
                          + reset_stats["skipped_active_job"]
                          + reset_stats["skipped_recent"],
        "items_processed": reset_stats["reset"],
        "items_skipped": reset_stats["skipped_active_job"]
                          + reset_stats["skipped_recent"],
        "stuck_skipped_active_job": reset_stats["skipped_active_job"],
    }


# ─── Daily report ────────────────────────────────────────────────────

def build_daily_report() -> dict:
    """Collect every metric for the daily Discord report.

    Pure data assembly, no I/O on Discord. Errors per-source are
    logged + swallowed ; the report still renders with zeroes for
    failed sections.
    """
    db = get_db()
    runs = _fetch_pipeline_runs_24h(db)
    stats = scheduler.get_stats()

    return {
        "scheduler": {
            "gemini_calls":   stats["daily_counts"].get("gemini", 0),
            "youtube_calls":  stats["daily_counts"].get("youtube_search", 0),
            "gemini_remaining":  stats["daily_remaining"].get("gemini", 0),
        },
        "cache_pending":      cache.pending_count(),
        "kills_published_today": _kills_published_today(db),
        "top_error_codes":    _top_error_codes(runs, n=5),
        "dlq_growth":         _dlq_growth(db),
        "per_module_latency": _per_module_latency(runs),
        "queue_depth":        _queue_depth_per_kind(db),
    }


def _format_report_lines(report: dict) -> list[str]:
    """Render the report dict to a Discord-friendly list of lines.

    Hard-cap each section so we stay under Discord's 4000-char embed
    description limit even when something explodes (e.g. 100 different
    error codes).
    """
    lines: list[str] = []

    sched = report.get("scheduler") or {}
    lines.append(f"**Kills published today** : {report.get('kills_published_today', 0)}")
    lines.append(
        f"**Gemini** : {sched.get('gemini_calls', 0)} calls, "
        f"{sched.get('gemini_remaining', 0)} left"
    )
    lines.append(f"**YouTube search** : {sched.get('youtube_calls', 0)} calls")
    lines.append(f"**Cache pending** : {report.get('cache_pending', 0)}")

    dlq = report.get("dlq_growth") or {}
    lines.append(
        f"**DLQ growth** : today={dlq.get('today', 0)}, "
        f"yesterday={dlq.get('yesterday', 0)}"
    )

    top = report.get("top_error_codes") or []
    if top:
        lines.append("")
        lines.append("**Top errors (24h)** :")
        for row in top[:5]:
            sample = (row.get("sample") or "")[:80].replace("\n", " ")
            lines.append(f"  - `{row.get('code', '?')}` x{row.get('count', 0)} — {sample}")

    qd = report.get("queue_depth") or {}
    if qd:
        lines.append("")
        lines.append("**Queue depth (pending)** :")
        # Sort by count desc, top 8 (more would blow the embed limit).
        for kind, n in sorted(qd.items(), key=lambda kv: kv[1], reverse=True)[:8]:
            lines.append(f"  - `{kind}` : {n}")

    pml = report.get("per_module_latency") or {}
    if pml:
        lines.append("")
        lines.append("**Per-module latency p50/p95/p99 (ms)** :")
        # Sort by p99 desc for readability.
        rows = sorted(
            pml.items(),
            key=lambda kv: kv[1].get("p99_ms", 0),
            reverse=True,
        )
        for mod, lat in rows[:10]:
            lines.append(
                f"  - `{mod}` n={lat.get('count', 0)} : "
                f"{lat.get('p50_ms', 0)}/{lat.get('p95_ms', 0)}/{lat.get('p99_ms', 0)}"
            )

    return lines


async def send_daily_report() -> None:
    """Build + post the daily report. Wrapped in try/except so the
    daemon's daily_report_loop never crashes the worker.
    """
    try:
        report = build_daily_report()
        lines = _format_report_lines(report)
        # Discord embed description hard-cap is 4096 chars ; we trim
        # at 3800 to leave room for the title + footer.
        description = "\n".join(lines)
        if len(description) > 3800:
            description = description[:3790] + "\n…(truncated)"

        await discord_webhook.send(embed={
            "title": "LoLTok — Rapport quotidien",
            "description": description,
            "color": 0x0057FF,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        # Daily report failure is NEVER fatal. Log loudly so on-call sees it
        # in the structured logs, then move on.
        log.warn("daily_report_send_failed", error=str(e)[:200])
