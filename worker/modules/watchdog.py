"""
WATCHDOG — Monitors pipeline health, resets stuck tasks, sends daily report.
"""

import structlog
from datetime import datetime, timezone
from services.supabase_client import safe_select, safe_update
from services import discord_webhook
from scheduler import scheduler
from local_cache import cache

log = structlog.get_logger()


async def run():
    """Check pipeline health, reset stuck kills, flush cache."""

    # Flush local cache if pending
    pending = cache.pending_count()
    if pending > 0:
        from services.supabase_client import flush_cache
        flushed = await flush_cache()
        log.info("cache_flush", pending=pending, flushed=flushed)

    # Check for stuck kills
    stuck_statuses = ["clipping", "vod_found"]
    for status in stuck_statuses:
        stuck = safe_select("kills", "id, status, updated_at", status=status)
        for kill in stuck:
            updated = kill.get("updated_at", "")
            if not updated:
                continue
            try:
                updated_dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                age_hours = (datetime.now(timezone.utc) - updated_dt).total_seconds() / 3600
                if age_hours > 2:
                    safe_update("kills", {"status": "raw", "retry_count": 0}, "id", kill["id"])
                    log.warn("stuck_kill_reset", kill_id=kill["id"], status=status, hours=age_hours)
            except Exception:
                pass

    # Scheduler stats
    stats = scheduler.get_stats()
    log.info("watchdog_stats",
             gemini_remaining=stats["daily_remaining"].get("gemini", "?"),
             youtube_remaining=stats["daily_remaining"].get("youtube_search", "?"),
             cache_pending=cache.pending_count())


async def send_daily_report():
    """Send daily stats to Discord."""
    stats = scheduler.get_stats()
    await discord_webhook.daily_report({
        "gemini_calls": stats["daily_counts"].get("gemini", 0),
        "youtube_calls": stats["daily_counts"].get("youtube_search", 0),
        "cache_pending": cache.pending_count(),
    })
