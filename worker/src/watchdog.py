"""
WATCHDOG — Monitors the pipeline and sends notifications via Discord webhook.

Sends notifications for:
- New KC match detected
- Kills clipped successfully
- Errors and failures
- Daily summary
"""

import httpx
from datetime import datetime, timezone
from .config import config
from .db import get_db, log


def send_discord(content: str, embed: dict | None = None):
    """Send a message to the Discord webhook."""
    if not config.DISCORD_WEBHOOK_URL:
        return

    payload: dict = {"content": content}
    if embed:
        payload["embeds"] = [embed]

    try:
        httpx.post(config.DISCORD_WEBHOOK_URL, json=payload, timeout=10)
    except Exception as e:
        log("warn", "watchdog", f"Discord notification failed: {e}")


def notify_new_match(blue_team: str, red_team: str, game_count: int, tournament: str):
    """Notify about a new KC match detected."""
    embed = {
        "title": f"Nouveau match KC detecte",
        "description": f"**{blue_team}** vs **{red_team}**\n{tournament} — {game_count} game(s)",
        "color": 0xC9A84C,  # KC gold
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    send_discord("", embed)


def notify_kills_clipped(match_info: str, kill_count: int, top_kill: str | None = None):
    """Notify about kills successfully clipped."""
    desc = f"{kill_count} kills clippes avec succes"
    if top_kill:
        desc += f"\nMeilleur clip: {top_kill}"

    embed = {
        "title": f"Clips prets — {match_info}",
        "description": desc,
        "color": 0x2ECC71,  # Green
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    send_discord("", embed)


def notify_error(module: str, message: str):
    """Notify about an error."""
    embed = {
        "title": f"Erreur — {module}",
        "description": message,
        "color": 0xE74C3C,  # Red
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    send_discord("", embed)


def notify_vod_not_found(match_info: str):
    """Notify when a VOD can't be found."""
    embed = {
        "title": "VOD introuvable",
        "description": f"Impossible de trouver le VOD pour {match_info}. Retry dans 30 min.",
        "color": 0xF39C12,  # Orange
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    send_discord("", embed)


def run():
    """Check pipeline health and send alerts."""
    db = get_db()

    # Check for stuck kills (in processing state for too long)
    stuck = db.table("kills").select("id, status, updated_at").in_(
        "status", ["clipping", "uploading", "vod_searching"]
    ).execute()

    stuck_count = 0
    for kill in stuck.data or []:
        updated = datetime.fromisoformat(kill["updated_at"].replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - updated).total_seconds() / 3600

        if age_hours > 2:
            stuck_count += 1
            # Reset to retry
            db.table("kills").update({
                "status": "pending" if kill["status"] == "vod_searching" else "vod_found",
                "processing_error": f"Reset after being stuck in {kill['status']} for {age_hours:.1f}h",
            }).eq("id", kill["id"]).execute()

    if stuck_count > 0:
        notify_error("watchdog", f"{stuck_count} kill(s) etaient bloques et ont ete relances")
        log("warn", "watchdog", f"Reset {stuck_count} stuck kills")

    # Check for failed kills that can be retried
    failed = db.table("kills").select("id").eq("status", "failed").execute()
    failed_count = len(failed.data or [])

    if failed_count > 0:
        log("info", "watchdog", f"{failed_count} kills in failed state")

    # Check for recent errors in worker_logs
    recent_errors = db.table("worker_logs").select("id").eq(
        "level", "error"
    ).order("created_at", desc=True).limit(10).execute()

    error_count = len(recent_errors.data or [])

    # Pipeline stats
    stats = {
        "pending": 0,
        "vod_searching": 0,
        "vod_found": 0,
        "clipping": 0,
        "ready": 0,
        "failed": 0,
        "no_vod": 0,
    }

    for status in stats:
        result = db.table("kills").select("id", count="exact").eq("status", status).execute()
        stats[status] = result.count or 0

    total = sum(stats.values())

    log("info", "watchdog",
        f"Pipeline: {total} kills total — "
        f"ready={stats['ready']}, pending={stats['pending']}, "
        f"processing={stats['vod_searching'] + stats['vod_found'] + stats['clipping']}, "
        f"failed={stats['failed']}, no_vod={stats['no_vod']}",
        {"stats": stats, "recent_errors": error_count})
