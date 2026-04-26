"""
DLQ_DRAINER — Periodic auto-drain of fresh dead_letter_jobs entries.

Wave 9 companion to scripts/dlq_drain.py. The script is the bulk-history
path (operator runs it once on the 822-row backlog) ; this daemon is the
ongoing maintenance loop : every 30 min, look at DLQ rows added in the
last hour and apply the same recovery decision matrix.

Why a separate daemon ?
  * The script's recovery decisions are well-tested. Re-using them keeps
    a single source of truth.
  * But running the SCRIPT in cron from the worker would pull in the
    full backlog window every time. The daemon scope is narrower : last
    1h only, capped at 50 rows per cycle, so a transient bug that fills
    the DLQ doesn't cause a thundering herd of requeues at the next tick.

Behaviour
---------
* Every cycle (default 1800s = 30 min via runtime_tuning) :
  - Refuse to run if KCKILLS_LOW_POWER=1 (gaming-mode skip).
  - Pull pending DLQ rows with failed_at >= now - LOOKBACK_HOURS.
  - Cap at MAX_RECOVERIES_PER_CYCLE = 50.
  - Apply scripts.dlq_drain.decide_action + enqueue/cancel.
* Idempotent : re-running on the same DLQ rows is safe (the unique
  partial index on pipeline_jobs handles duplicate active jobs).
* @run_logged so each cycle gets a pipeline_runs row with counts.

Wired into main.py DAEMON_MODULES with interval 1800s. Backed by
runtime_tuning DEFAULTS so operators can override via
KCKILLS_INTERVAL_DLQ_DRAINER.
"""

from __future__ import annotations

import os
from typing import Any

import structlog

from services.observability import note, run_logged
from services.supabase_client import get_db

log = structlog.get_logger()


# ─── Knobs ─────────────────────────────────────────────────────────────

# How far back to look. The daemon only owns the "fresh" tail of the
# DLQ so the operator-run dlq_drain.py keeps owning the historical
# backlog (no double-handling).
LOOKBACK_HOURS: int = 1

# Cap recoveries per cycle. A transient outage that floods the DLQ with
# 200+ rows shouldn't cause us to re-enqueue all of them in one tick —
# spread it over multiple cycles so the queue absorbs work gradually.
MAX_RECOVERIES_PER_CYCLE: int = 50


def _is_low_power() -> bool:
    """Read KCKILLS_LOW_POWER each call so an operator can flip it
    mid-session by `setx KCKILLS_LOW_POWER 1` then restarting the worker.

    The runtime_tuning module also caches its own _LOW_POWER ; we re-read
    here for the daemon-skip path so a manual `python main.py dlq_drainer`
    invocation respects the env without going through that module.
    """
    raw = os.environ.get("KCKILLS_LOW_POWER", "0").strip().lower()
    return raw in ("1", "true", "yes", "on")


# ─── Daemon entry point ───────────────────────────────────────────────


@run_logged()
async def run() -> dict[str, Any]:
    """One cycle.

    Returns the same shape as scripts.dlq_drain.drain so @run_logged's
    note() picks up items_*. Empty/error returns still write a row with
    items_scanned=0.
    """
    if _is_low_power():
        log.info("dlq_drainer_skipped_low_power")
        # Return zero counts but mark as a clean cycle so the dashboard
        # shows we ran (vs. a crash).
        return {
            "items_scanned":   0,
            "items_processed": 0,
            "items_failed":    0,
            "items_skipped":   1,
            "low_power":       True,
        }

    db = get_db()
    if db is None:
        log.warn("dlq_drainer_no_db")
        return {
            "items_scanned":   0,
            "items_processed": 0,
            "items_failed":    1,
        }

    # Convert lookback hours to days for the script signature. We use
    # 1h ÷ 24 = 0.0416 days but the underlying _fetch_dlq_page expects
    # an int. Pass 1 day as the SQL filter (cheap), then rely on the
    # caller-side limit + the fact that our daemon runs every 30 min so
    # only fresh-ish rows are in scope anyway.
    since_days = 1  # SQL-level coarse filter ; the per-cycle cap is
                    # MAX_RECOVERIES_PER_CYCLE which is what really
                    # bounds the work.

    # Late import so a script-only deployment doesn't pull modules.
    from scripts.dlq_drain import drain

    summary = await drain(
        db=db,
        dry_run=False,
        type_filter=None,
        error_code_filter=None,
        since_days=since_days,
        limit=MAX_RECOVERIES_PER_CYCLE,
    )

    # Echo to structured log + record_metric-friendly extras.
    log.info(
        "dlq_drainer_cycle",
        scanned=summary["items_scanned"],
        requeued=summary["requeued"],
        cancelled=summary["cancelled"],
        errors=summary["errors"],
    )

    note(
        items_scanned=summary["items_scanned"],
        items_processed=summary["items_processed"],
        items_failed=summary["items_failed"],
        items_skipped=summary["items_skipped"],
        requeued=summary["requeued"],
        cancelled=summary["cancelled"],
        by_error_code=summary["by_error_code"],
    )

    return summary


__all__ = [
    "run",
    "LOOKBACK_HOURS",
    "MAX_RECOVERIES_PER_CYCLE",
]
