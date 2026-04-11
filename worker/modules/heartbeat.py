"""
HEARTBEAT — Pings Supabase every 6 hours to prevent auto-pause.
Supabase free tier pauses after 7 days of inactivity.
"""

import structlog
from services.supabase_client import get_db

log = structlog.get_logger()


async def run():
    """Ping Supabase to keep it alive."""
    db = get_db()
    if not db:
        log.warn("heartbeat_no_db")
        return

    try:
        db.table("health_checks").upsert({
            "id": "worker_heartbeat",
            "last_seen": "now()",
            "metrics": {},
        }).execute()
        log.info("heartbeat_ok")
    except Exception as e:
        log.error("heartbeat_failed", error=str(e))
