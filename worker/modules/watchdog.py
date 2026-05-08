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
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
import structlog

from local_cache import cache
from scheduler import scheduler
from services import discord_webhook, disk_hygiene
from services.observability import note, run_logged
from services.supabase_client import get_db, safe_select, safe_update

log = structlog.get_logger()


# ─── Wave 14 alert thresholds (operator overrides via env) ────────────
# Proactive mid-day alerts. The watchdog's 5-min cycle calls these on
# every loop ; cooldown prevents Discord spam by only firing once per
# threshold-crossing per UTC day.

# Gemini quota — alert when remaining drops below this %.
GEMINI_ALERT_PCT = int(os.getenv("KCKILLS_ALERT_GEMINI_PCT", "20") or "20")

# Disk free — alert when host free space drops below this %.
DISK_ALERT_FREE_PCT = float(os.getenv("KCKILLS_ALERT_DISK_FREE_PCT", "10") or "10")

# DLQ growth — alert when added-today exceeds this count.
DLQ_ALERT_TODAY_THRESHOLD = int(os.getenv("KCKILLS_ALERT_DLQ_TODAY", "20") or "20")

# Disk GC cadence — purge stale artefacts every N hours. None disables.
DISK_GC_INTERVAL_HOURS = float(os.getenv("KCKILLS_DISK_GC_HOURS", "24") or "24")

# Wave 20.1 — alert cooldown state. Was in-memory only, which meant
# every daemon restart re-fired same-day alerts (Discord noise + alarm
# fatigue). Now backed by `worker/state/alert_cooldowns.json` so the
# cooldown survives `systemctl restart kckills-worker` / supervisor
# auto-restarts. Key shape : `{kind}|{utc_date}` → bool.
#
# Why a file and not the DB : zero migration, atomic rename pattern is
# trivial, the file stays small (one entry per alert kind per day,
# pruned to last 14 days on each write), and a Supabase outage
# shouldn't double-fire alerts during the outage either (the DB is
# what's down and we don't want to spam Discord with that).
_ALERT_STATE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "state",
    "alert_cooldowns.json",
)
_alert_state: dict[str, bool] = {}
_alert_state_loaded: bool = False
_last_disk_gc_ts: float = 0.0


def _load_alert_state() -> None:
    """Hydrate `_alert_state` from disk on first call. Idempotent."""
    global _alert_state, _alert_state_loaded
    if _alert_state_loaded:
        return
    _alert_state_loaded = True
    try:
        if os.path.exists(_ALERT_STATE_PATH):
            import json
            with open(_ALERT_STATE_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f) or {}
            if isinstance(raw, dict):
                _alert_state = {str(k): bool(v) for k, v in raw.items()}
    except Exception as e:
        log.warn("alert_state_load_failed", error=str(e)[:160])
        _alert_state = {}


def _persist_alert_state() -> None:
    """Atomic-write `_alert_state` to disk, pruning entries older than
    14 days so the file stays tiny."""
    try:
        import json
        os.makedirs(os.path.dirname(_ALERT_STATE_PATH), exist_ok=True)
        # Prune : drop keys whose date suffix is > 14 days old.
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")
        pruned = {
            k: v for k, v in _alert_state.items()
            if "|" in k and k.split("|", 1)[1] >= cutoff
        }
        tmp = _ALERT_STATE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(pruned, f, separators=(",", ":"))
        os.replace(tmp, _ALERT_STATE_PATH)
    except Exception as e:
        log.warn("alert_state_persist_failed", error=str(e)[:160])


def _alerted_today(kind: str) -> bool:
    """True if `kind` already fired today (UTC). Mutates + persists state.

    Wave 20.1 : was in-memory only, now hydrates from disk on first
    call and atomically persists each fire so a daemon restart inside
    a UTC day doesn't re-fire alerts that already pinged Discord.
    """
    _load_alert_state()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"{kind}|{today}"
    if _alert_state.get(key):
        return True
    _alert_state[key] = True
    _persist_alert_state()
    return False


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
        # Wave 27.4 — order by `updated_at.asc` so the oldest stuck
        # rows surface first, regardless of PostgREST's row cap. The
        # _limit is intentionally generous (5000) — we want to clear
        # the whole backlog of stuck rows on each watchdog tick, and
        # 5000 well exceeds the worst observed multi-day outage.
        rows = safe_select(
            "kills",
            "id, status, updated_at",
            status=status,
            _limit=5000,
            _order="updated_at.asc",
        )
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


def _supabase_count(
    db,
    table: str,
    params: dict[str, str],
    field: str = "watchdog_count",
) -> int:
    """Generic count helper for the daily-report metric block.

    Wraps PostgREST's count=exact pattern with the same defensive logic
    as `_kills_published_today` (handles HTTP 200 + 206, empty header,
    `*` non-numeric total). Errors are logged + return 0 so the daily
    report still ships with a partial picture rather than crashing.
    """
    if db is None:
        return 0
    try:
        client = db._get_client()
        r = client.get(
            f"{db.base}/{table}",
            params={**params, "select": "id", "limit": "1"},
            headers={**db.headers, "Prefer": "count=exact"},
        )
        # Both 200 (full) and 206 (partial-content) are success — see
        # the matching fix in scripts/production_rate.py for the same
        # gotcha.
        if r.status_code not in (200, 206):
            log.warn(
                "watchdog_count_unexpected_status",
                field=field,
                status=r.status_code,
            )
            return 0
        cr = r.headers.get("content-range") or ""
        if "/" not in cr:
            return 0
        tail = cr.rsplit("/", 1)[-1]
        if not tail or tail == "*":
            return 0
        try:
            return int(tail)
        except ValueError:
            return 0
    except Exception as e:
        log.warn(
            "watchdog_count_failed",
            field=field,
            table=table,
            error=str(e)[:160],
        )
        return 0


def _kills_detected_today(db) -> int:
    """Real count of kills created today (any status), measures
    sentinel + harvester intake. Wave 20.7 — added to the daily
    report so the operator can see "raw input" vs "real publish"
    side by side."""
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return _supabase_count(
        db,
        "kills",
        {"created_at": f"gte.{today_start.isoformat()}"},
        field="kills_detected_today",
    )


def _published_total(db) -> int:
    """All-time count of kills currently published. Lets the operator
    track catalog growth in the daily summary."""
    return _supabase_count(
        db,
        "kills",
        {"status": "eq.published"},
        field="published_total",
    )


def _catalog_total(db) -> int:
    """All-time total kills (any status). Combined with `published_total`
    gives a coverage % the operator can sanity-check at a glance."""
    return _supabase_count(db, "kills", {}, field="catalog_total")


# ─── Wave 14 proactive alerts ─────────────────────────────────────────


async def _send_alert(title: str, body: str, color: int = 0xFF6B00) -> None:
    """Wrap Discord webhook posting so a webhook outage never crashes
    the watchdog cycle. Called only on threshold-crossing events."""
    try:
        await discord_webhook.send(embed={
            "title": title,
            "description": body,
            "color": color,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        log.warn("watchdog_alert_send_failed", title=title, error=str(e)[:160])


async def _maybe_alert_low_quota(stats: dict, disk: dict) -> None:
    """Check the three Wave 14 alert thresholds and post a Discord
    embed when one is crossed (once per UTC day per alert kind)."""

    # ── Gemini quota ──
    # scheduler.get_stats() returns daily_remaining as ABSOLUTE counts
    # against scheduler limits. Convert to %. If `gemini` isn't in the
    # daily_counts dict at all, the scheduler hasn't seen a call yet —
    # skip silently.
    counts = stats.get("daily_counts") or {}
    remaining = stats.get("daily_remaining") or {}
    gemini_total = counts.get("gemini", 0) + remaining.get("gemini", 0)
    if gemini_total > 0:
        pct_remaining = remaining.get("gemini", 0) / gemini_total * 100
        if pct_remaining < GEMINI_ALERT_PCT and not _alerted_today("gemini_low"):
            await _send_alert(
                "⚠️ Gemini daily quota nearly exhausted",
                f"Remaining : **{remaining.get('gemini', 0)}** "
                f"calls (**{pct_remaining:.0f} %**) of "
                f"{gemini_total} daily.\n"
                f"Consider switching `KCKILLS_GEMINI_TIER=balanced` "
                f"(paid 3 Flash, $0.30/$2.50) or letting analyzer "
                f"degrade until 07:00 UTC reset.",
                color=0xFFB000,
            )

    # ── Disk free space ──
    free_pct = disk.get("host_free_pct", 100)
    if free_pct < DISK_ALERT_FREE_PCT and not _alerted_today("disk_low"):
        free_gb = disk.get("host_free_bytes", 0) / 1024 / 1024 / 1024
        managed_gb = disk.get("managed_total_bytes", 0) / 1024 / 1024 / 1024
        await _send_alert(
            "🔴 Worker host disk free below threshold",
            f"Free : **{free_pct:.1f} %** "
            f"(~{free_gb:.1f} GB free).\n"
            f"Worker-managed : {managed_gb:.1f} GB.\n"
            f"GC runs every {DISK_GC_INTERVAL_HOURS:.0f} h ; "
            f"if this re-fires daily, lower the per-dir retention "
            f"(`KCKILLS_VODS_RETENTION_DAYS=3` etc.) or extend the host.",
            color=0xFF3030,
        )

    # ── DLQ growth ──
    # build_daily_report assembles _dlq_growth lazily ; replicate the
    # cheap part here so we don't run every queue/error query each
    # watchdog cycle. Just count today.
    db = get_db()
    if db is not None:
        try:
            client = db._get_client()
            today_start = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            r = client.get(
                f"{db.base}/dead_letter_jobs",
                params={
                    "select": "id",
                    "failed_at": f"gte.{today_start.isoformat()}",
                    "limit": "1",
                },
                headers={**db.headers, "Prefer": "count=exact"},
            )
            r.raise_for_status()
            cr = r.headers.get("content-range") or ""
            today_n = 0
            if "/" in cr:
                tail = cr.split("/")[-1]
                if tail and tail != "*":
                    try:
                        today_n = int(tail)
                    except ValueError:
                        today_n = 0
            if today_n >= DLQ_ALERT_TODAY_THRESHOLD and not _alerted_today("dlq_spike"):
                await _send_alert(
                    "⚠️ Dead-letter queue spiking",
                    f"**{today_n}** jobs failed terminally today.\n"
                    f"Threshold : `{DLQ_ALERT_TODAY_THRESHOLD}`.\n"
                    f"Check `/admin/pipeline/dlq` and run "
                    f"`scripts/backfill_stuck_pipeline.py --state failed` "
                    f"if it's a transient external (Gemini / yt-dlp / R2) issue.",
                    color=0xFF6060,
                )
        except Exception as e:
            log.warn("watchdog_dlq_alert_check_failed", error=str(e)[:160])


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

    # Wave 14 — disk usage snapshot + periodic GC
    disk = disk_hygiene.usage_stats()
    global _last_disk_gc_ts
    if DISK_GC_INTERVAL_HOURS > 0 and (
        time.time() - _last_disk_gc_ts > DISK_GC_INTERVAL_HOURS * 3600
    ):
        try:
            purge = disk_hygiene.purge_aged()
            log.info(
                "disk_gc_cycle",
                files_deleted=purge["files_deleted"],
                bytes_freed_mb=round(purge["bytes_freed"] / 1024 / 1024, 1),
                errors=purge["errors"],
            )
        except Exception as e:
            log.warn("disk_gc_failed", error=str(e)[:200])
        _last_disk_gc_ts = time.time()

    log.info(
        "watchdog_stats",
        gemini_remaining=stats["daily_remaining"].get("gemini", "?"),
        youtube_remaining=stats["daily_remaining"].get("youtube_search", "?"),
        cache_pending=cache.pending_count(),
        stuck_reset=reset_stats["reset"],
        stuck_skipped_active_job=reset_stats["skipped_active_job"],
        stuck_skipped_recent=reset_stats["skipped_recent"],
        disk_free_pct=disk.get("host_free_pct", -1),
        disk_managed_mb=round(disk.get("managed_total_bytes", 0) / 1024 / 1024, 1),
    )

    # Wave 14 — proactive Discord alerts (cooldown : once per UTC day per alert kind)
    await _maybe_alert_low_quota(stats, disk)

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

    # Wave 14 — disk usage + GC summary in the daily report
    try:
        disk = disk_hygiene.usage_stats()
    except Exception as e:
        log.warn("watchdog_daily_disk_failed", error=str(e)[:160])
        disk = None

    # Wave 20.7 — surface catalog totals + intake rate so the daily
    # Discord embed answers "are we keeping up ?" at a glance, not just
    # "how many published today".
    pub_total = _published_total(db)
    cat_total = _catalog_total(db)
    coverage_pct = (
        (pub_total / cat_total * 100) if cat_total > 0 else 0.0
    )

    return {
        "scheduler": {
            "gemini_calls":   stats["daily_counts"].get("gemini", 0),
            "youtube_calls":  stats["daily_counts"].get("youtube_search", 0),
            "gemini_remaining":  stats["daily_remaining"].get("gemini", 0),
        },
        "cache_pending":      cache.pending_count(),
        "kills_published_today": _kills_published_today(db),
        "kills_detected_today":  _kills_detected_today(db),
        "published_total":    pub_total,
        "catalog_total":      cat_total,
        "coverage_pct":       round(coverage_pct, 1),
        "top_error_codes":    _top_error_codes(runs, n=5),
        "dlq_growth":         _dlq_growth(db),
        "per_module_latency": _per_module_latency(runs),
        "queue_depth":        _queue_depth_per_kind(db),
        "disk":               disk,
    }


def _format_report_lines(report: dict) -> list[str]:
    """Render the report dict to a Discord-friendly list of lines.

    Hard-cap each section so we stay under Discord's 4000-char embed
    description limit even when something explodes (e.g. 100 different
    error codes).
    """
    lines: list[str] = []

    sched = report.get("scheduler") or {}
    pub_today = report.get("kills_published_today", 0)
    detected_today = report.get("kills_detected_today", 0)
    pub_total = report.get("published_total", 0)
    cat_total = report.get("catalog_total", 0)
    coverage = report.get("coverage_pct", 0.0)
    lines.append(
        f"**Pipeline today** : {pub_today} published / "
        f"{detected_today} detected"
    )
    lines.append(
        f"**Catalog** : {pub_total} live / {cat_total} total "
        f"({coverage} %)"
    )
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

    # Wave 14 — disk health
    disk = report.get("disk") or {}
    if disk:
        managed_mb = disk.get("managed_total_bytes", 0) / 1024 / 1024
        free_pct = disk.get("host_free_pct", 0)
        free_gb = disk.get("host_free_bytes", 0) / 1024 / 1024 / 1024
        lines.append(
            f"**Disk** : worker {managed_mb:.0f} MB · "
            f"host free {free_pct:.1f} % (~{free_gb:.0f} GB)"
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
