"""
QUEUE_HEALTH — Periodic snapshot of pipeline_jobs queue depth + age.

Wave 6 hardening companion to watchdog. Runs every 5 minutes (vs the
30-min watchdog cycle) so we catch a stuck queue inside one Discord-on-
call cycle instead of after multiple watchdog passes.

Each cycle :
    1. Calls fn_release_stale_pipeline_locks() — flips abandoned
       claimed rows back to 'pending' so a fresh worker can grab them.
       This is the self-healing gate : even if the worker that originally
       claimed a job dies and never re-claims, the row eventually returns
       to circulation.
    2. For each job kind, snapshots :
            * status counts (pending / claimed / succeeded / failed)
            * oldest_pending_age_s   (seconds since created_at)
            * oldest_claimed_age_s   (seconds since claimed_at)
            * succeed_throughput     (succeed_count_last_1h / 60.0 = per-min)
    3. Writes the snapshot into pipeline_runs.metadata via @run_logged
       so the admin dashboard / future analytics can plot trends.
    4. Emits warnings (and Discord pings) if :
            * oldest_pending_age_s > THRESHOLD_PENDING_WARN_SEC for any kind
            * oldest_claimed_age_s > 4 × DEFAULT_LEASE_SECONDS for any kind
              (i.e. a worker probably crashed mid-job and the lease auto-
              release in step 1 didn't catch it for some reason — usually
              because p_max_age_minutes is conservative)

Discord pings are best-effort : wrapped in try/except, NEVER block the
loop. If notify_error fails (no webhook configured, network blip,
whatever), we log and move on.

Design notes
────────────
* Talks via httpx + PostgREST like the rest of the worker. No psycopg.
* The status-count GROUP BY uses an aggregation RPC if available, but
  falls back to per-status COUNTs via Content-Range : count=exact —
  same trick as job_queue.get_active_count(). Safer than relying on
  yet another migration.
* Per-kind iteration walks JOB_KINDS (matches the constraint in
  migration 024 + 033). When we add new kinds, append here too.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import structlog

from services import discord_webhook
from services.observability import note, run_logged
from services.supabase_client import get_db

log = structlog.get_logger()


# ─── Config knobs ─────────────────────────────────────────────────────

# Job kinds we monitor (must stay in sync with the CHECK constraint
# in migration 024 / 033). Order is irrelevant — only used to drive
# the iteration that builds the snapshot.
JOB_KINDS: list[str] = [
    "match.discover",
    "live_stats.harvest",
    "vod.reconcile",
    "vod.offset_find",
    "channel.discover",
    "channel.reconcile",
    "clip.create",
    "clip.reclip",
    "hls.package",
    "clip.analyze",
    "og.generate",
    "embedding.compute",
    "qc.verify",
    "qc.reanalyze",
    "event.map",
    "publish.check",
    "publish.retract",
    "feature.pin",
    "feature.unpin",
    "kotw.auto_pick",
    "comment.moderate",
    "cache.flush",
    "health.heartbeat",
    "cleanup.expired",
    "worker.backfill",
]

# Statuses we count separately — the rest are bucketed as "other".
TRACKED_STATUSES: tuple[str, ...] = ("pending", "claimed", "succeeded", "failed")

# Default lease window claim() uses (matches services.job_queue.claim()
# default of 300s). Used to compute "stale claimed" threshold.
DEFAULT_LEASE_SECONDS: int = 300

# Pending older than 30 min for ANY kind triggers a warning.
THRESHOLD_PENDING_WARN_SEC: int = 30 * 60

# Claimed older than 4 × lease (= 20 min by default) → probable dead
# worker. Force-release happens in fn_release_stale_pipeline_locks
# (with a conservative max_age_minutes window) — the warning here is
# a belt-and-braces signal that something escaped the auto-release.
STALE_CLAIM_LEASE_MULTIPLIER: int = 4

# Window for fn_release_stale_pipeline_locks. The function only releases
# rows whose locked_until is older than now() - this many minutes.
#
# 🐛 2026-04-28 fix v2 : was 60 → 20 → now 10. The 20-min cutoff still
# missed the analyzer's stale claims because the analyzer lease is only
# 5 min (vs clipper's 10 min). Snapshot found 64 clip.analyze claims
# stale by exactly 7.2 min — under the 20-min cutoff but over a 5-min.
# 10 min covers both lease ranges + a small buffer.
#
# Risks of going too low :
#   * Stealing a claim from a legitimate slow worker that hasn't renewed
#     its lease yet → the work gets done twice (wasteful, but harmless
#     since the kill table writes are idempotent on (kill_id, status)).
#   * A clipper download of a 30-min VOD segment can legitimately take
#     >10 min ; those workers MUST call renew_lease() periodically.
#     If they don't, they look stuck and we re-claim.
#
# Set KCKILLS_RELEASE_STALE_AGE_MIN to override per-deploy if a real
# worker takes longer than 10 min between renew calls.
RELEASE_STALE_MAX_AGE_MINUTES: int = int(
    __import__("os").environ.get("KCKILLS_RELEASE_STALE_AGE_MIN", "5")
)


# ─── Low-level PostgREST helpers ──────────────────────────────────────

def _count_with_filter(db, params: dict) -> int:
    """Return the exact row count for a PostgREST query, using the
    Content-Range header. Returns 0 on any error / missing header.

    `params` must include 'select' (a real column name, not '*' — some
    PostgREST versions choke on count=exact + select=*) and any filter
    columns. We always set limit=1 so PostgREST doesn't actually return
    rows ; only the header is used.
    """
    try:
        client = db._get_client()
        merged = {**params, "limit": "1"}
        r = client.get(
            f"{db.base}/pipeline_jobs",
            params=merged,
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
        log.warn("queue_health_count_failed",
                 params=str(params)[:120], error=str(e)[:160])
        return 0


def _oldest_age_seconds(db, status: str, kind: str, age_column: str) -> int:
    """Pull the single oldest row of (status, kind), return its age in
    whole seconds against `age_column` (created_at for pending, claimed_at
    for claimed). Returns 0 if no row exists or any error happens.
    """
    try:
        client = db._get_client()
        r = client.get(
            f"{db.base}/pipeline_jobs",
            params={
                "select": age_column,
                "status": f"eq.{status}",
                "type": f"eq.{kind}",
                "order": f"{age_column}.asc",
                "limit": "1",
            },
        )
        r.raise_for_status()
        rows = r.json() or []
        if not rows:
            return 0
        ts_raw = rows[0].get(age_column)
        if not ts_raw:
            return 0
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except ValueError:
            return 0
        age = (datetime.now(timezone.utc) - ts).total_seconds()
        return max(0, int(age))
    except Exception as e:
        log.warn("queue_health_age_failed",
                 status=status, kind=kind, error=str(e)[:160])
        return 0


def _succeed_throughput_per_min(db, kind: str, window_minutes: int = 60) -> float:
    """Count succeeded jobs of `kind` in the last `window_minutes` minutes,
    return per-minute throughput. Returns 0.0 on any error.
    """
    try:
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
        cutoff_iso = cutoff.isoformat()
        client = db._get_client()
        r = client.get(
            f"{db.base}/pipeline_jobs",
            params={
                "select": "id",
                "status": "eq.succeeded",
                "type": f"eq.{kind}",
                "finished_at": f"gte.{cutoff_iso}",
                "limit": "1",
            },
            headers={**db.headers, "Prefer": "count=exact"},
        )
        r.raise_for_status()
        cr = r.headers.get("content-range") or ""
        n = 0
        if "/" in cr:
            tail = cr.split("/")[-1]
            if tail and tail != "*":
                try:
                    n = int(tail)
                except ValueError:
                    n = 0
        return round(float(n) / float(window_minutes), 4)
    except Exception as e:
        log.warn("queue_health_throughput_failed",
                 kind=kind, error=str(e)[:160])
        return 0.0


# ─── Stale-lock release ────────────────────────────────────────────────

def release_stale_locks(db, max_age_minutes: int = RELEASE_STALE_MAX_AGE_MINUTES) -> int:
    """Call fn_release_stale_pipeline_locks RPC. Returns the count released.

    Failure here is non-fatal : we log + return 0 so the rest of the
    cycle can still produce a snapshot.
    """
    if db is None:
        return 0
    try:
        client = db._get_client()
        r = client.post(
            f"{db.base}/rpc/fn_release_stale_pipeline_locks",
            json={"p_max_age_minutes": int(max_age_minutes)},
        )
        r.raise_for_status()
        out = r.json()
        # The RPC returns a single INT — PostgREST usually wraps as a scalar
        # or as [{ "fn_release_stale_pipeline_locks": N }] depending on
        # the function shape. Normalize.
        if isinstance(out, int):
            return out
        if isinstance(out, list) and out:
            first = out[0]
            if isinstance(first, dict):
                # PostgREST returns the function name as the column.
                for v in first.values():
                    try:
                        return int(v)
                    except (TypeError, ValueError):
                        continue
            try:
                return int(first)
            except (TypeError, ValueError):
                return 0
        if isinstance(out, dict):
            for v in out.values():
                try:
                    return int(v)
                except (TypeError, ValueError):
                    continue
        return 0
    except Exception as e:
        log.warn("queue_health_release_stale_failed", error=str(e)[:160])
        return 0


# ─── Snapshot builder ──────────────────────────────────────────────────

def build_snapshot(db, kinds: Optional[list[str]] = None) -> dict[str, Any]:
    """For each job kind, compute the snapshot dict.

    Returns shape :
        {
          "kinds": {
            "<kind>": {
                "pending": int, "claimed": int,
                "succeeded": int, "failed": int,
                "oldest_pending_age_s": int,
                "oldest_claimed_age_s": int,
                "succeed_per_min_1h": float,
            },
            ...
          },
          "totals": {
              "pending": int, "claimed": int,
              "succeeded": int, "failed": int,
          },
          "warnings": [ {"kind": str, "type": str, "value": ..., "threshold": ...}, ... ],
        }
    """
    use_kinds = kinds if kinds is not None else JOB_KINDS

    out_kinds: dict[str, dict[str, Any]] = {}
    totals = {s: 0 for s in TRACKED_STATUSES}
    warnings: list[dict] = []

    stale_claim_threshold = DEFAULT_LEASE_SECONDS * STALE_CLAIM_LEASE_MULTIPLIER

    for kind in use_kinds:
        kind_row: dict[str, Any] = {}
        for status in TRACKED_STATUSES:
            n = _count_with_filter(
                db,
                {"select": "id", "type": f"eq.{kind}", "status": f"eq.{status}"},
            )
            kind_row[status] = n
            totals[status] += n

        oldest_pending = _oldest_age_seconds(db, "pending", kind, "created_at")
        oldest_claimed = _oldest_age_seconds(db, "claimed", kind, "claimed_at")
        throughput = _succeed_throughput_per_min(db, kind)

        kind_row["oldest_pending_age_s"] = oldest_pending
        kind_row["oldest_claimed_age_s"] = oldest_claimed
        kind_row["succeed_per_min_1h"] = throughput

        if oldest_pending > THRESHOLD_PENDING_WARN_SEC:
            warnings.append({
                "kind": kind,
                "type": "stale_pending",
                "value_s": oldest_pending,
                "threshold_s": THRESHOLD_PENDING_WARN_SEC,
            })
        if oldest_claimed > stale_claim_threshold:
            warnings.append({
                "kind": kind,
                "type": "stale_claim",
                "value_s": oldest_claimed,
                "threshold_s": stale_claim_threshold,
            })

        out_kinds[kind] = kind_row

    return {
        "kinds": out_kinds,
        "totals": totals,
        "warnings": warnings,
    }


# ─── Discord ping helper ──────────────────────────────────────────────

async def _safe_discord_ping(title: str, message: str) -> None:
    """Best-effort Discord notification. NEVER raises ; logs on failure.

    Uses notify_error for warning-tier alerts too — there is no
    notify_warning helper in services/discord_webhook ; consolidating
    on notify_error keeps the surface area small. The title prefix
    encodes severity for the on-call humans.
    """
    try:
        await discord_webhook.notify_error(title, message)
    except Exception as e:
        log.warn("queue_health_discord_failed",
                 title=title, error=str(e)[:160])


# ─── Module entry-point ───────────────────────────────────────────────

@run_logged()
async def run() -> dict:
    """One supervised cycle. See module docstring for the steps."""
    db = get_db()
    if db is None:
        log.warn("queue_health_no_db")
        return {"items_scanned": 0, "items_processed": 0}

    t0 = time.monotonic()

    # Step 1 — release stale leases first so the snapshot reflects the
    # post-release state.
    released = release_stale_locks(db)
    if released > 0:
        log.info("queue_health_released_stale", count=released)

    # Step 2 — build the snapshot.
    snapshot = build_snapshot(db)
    duration_s = round(time.monotonic() - t0, 3)

    totals = snapshot["totals"]
    warnings = snapshot["warnings"]

    # Step 3 — emit warnings + Discord pings (one per warning, capped
    # to avoid Discord rate-limit storms).
    MAX_PINGS = 3
    for warn in warnings[:MAX_PINGS]:
        log.warn(
            "queue_health_warning",
            kind=warn["kind"],
            type=warn["type"],
            value_s=warn["value_s"],
            threshold_s=warn["threshold_s"],
        )
        title = f"queue_health [{warn['type']}]"
        msg = (
            f"kind={warn['kind']} "
            f"value={warn['value_s']}s "
            f"threshold={warn['threshold_s']}s"
        )
        await _safe_discord_ping(title, msg)
    extra_warns = len(warnings) - MAX_PINGS
    if extra_warns > 0:
        log.warn("queue_health_warnings_truncated", suppressed=extra_warns)

    # Step 4 — log a one-line summary + flush metadata into pipeline_runs
    # via observability.note().
    log.info(
        "queue_health_snapshot",
        pending=totals["pending"],
        claimed=totals["claimed"],
        succeeded_1h=totals["succeeded"],
        failed=totals["failed"],
        warnings=len(warnings),
        released_stale=released,
        duration_s=duration_s,
    )

    note(
        items_scanned=len(JOB_KINDS),
        items_processed=sum(totals[s] for s in TRACKED_STATUSES),
        items_failed=len(warnings),
        released_stale=released,
        snapshot=snapshot,
        duration_s=duration_s,
    )

    return {
        "items_scanned": len(JOB_KINDS),
        "items_processed": sum(totals[s] for s in TRACKED_STATUSES),
        "items_failed": len(warnings),
        "released_stale": released,
    }


__all__ = [
    "run",
    "build_snapshot",
    "release_stale_locks",
    "JOB_KINDS",
    "TRACKED_STATUSES",
    "DEFAULT_LEASE_SECONDS",
    "THRESHOLD_PENDING_WARN_SEC",
    "STALE_CLAIM_LEASE_MULTIPLIER",
    "RELEASE_STALE_MAX_AGE_MINUTES",
]
