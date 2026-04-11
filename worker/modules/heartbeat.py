"""
HEARTBEAT — Pings Supabase every 6 hours to prevent auto-pause.
Supabase free tier pauses after 7 days of inactivity.

Also records the latest scheduler stats so the Next.js /api/worker-status
route can show a freshness indicator.
"""

from datetime import datetime, timezone

import structlog

from scheduler import scheduler
from services.supabase_client import get_db, safe_upsert
from local_cache import cache

log = structlog.get_logger()


async def run():
    """Ping Supabase to keep it alive and record health metrics."""
    db = get_db()
    if db is None:
        log.warn("heartbeat_no_db")
        return

    metrics = {
        "scheduler": scheduler.get_stats(),
        "cache_pending": cache.pending_count(),
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    # health_checks.id is a TEXT primary key; upsert on it so we only ever have
    # one row per heartbeat source.
    safe_upsert(
        "health_checks",
        {
            "id": "worker_heartbeat",
            "last_seen": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
        },
        on_conflict="id",
    )
    log.info("heartbeat_ok", cache_pending=metrics["cache_pending"])
