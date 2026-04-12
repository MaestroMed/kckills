"""Discord webhook notifications."""

import httpx
from datetime import datetime, timezone
from config import config
from scheduler import scheduler


async def send(content: str = "", embed: dict | None = None):
    """Send a message to the Discord webhook."""
    if not config.DISCORD_WEBHOOK_URL:
        return
    await scheduler.wait_for("discord")
    payload: dict = {}
    if content:
        payload["content"] = content
    if embed:
        payload["embeds"] = [embed]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(config.DISCORD_WEBHOOK_URL, json=payload)
    except Exception:
        pass


async def notify_match(blue: str, red: str, games: int, tournament: str):
    await send(embed={
        "title": "Nouveau match KC detecte",
        "description": f"**{blue}** vs **{red}**\n{tournament} — {games} game(s)",
        "color": 0xC8AA6E,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


async def notify_kills_processed(match_info: str, count: int):
    await send(embed={
        "title": f"Kills detectes — {match_info}",
        "description": f"{count} kills KC extraits",
        "color": 0x00C853,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


async def notify_kill_published(
    killer_champion: str,
    victim_champion: str,
    description: str,
    highlight_score: float | None,
    thumbnail_url: str | None,
    kill_id: str,
    match_info: str = "",
):
    """Post a new kill clip to the #kc-kills channel with rich embed."""
    is_kc_kill = True  # only called for published kills which are KC-involved
    embed: dict = {
        "title": f"{killer_champion} \u2192 {victim_champion}",
        "description": description[:200] if description else "Nouveau kill KC",
        "color": 0xC8AA6E if is_kc_kill else 0xE84057,
        "url": f"https://kckills.com/kill/{kill_id}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "footer": {"text": match_info or "KCKILLS"},
    }
    if highlight_score is not None:
        embed["fields"] = [{"name": "Score", "value": f"{highlight_score:.1f}/10", "inline": True}]
    if thumbnail_url:
        embed["thumbnail"] = {"url": thumbnail_url}
    await send(embed=embed)


async def notify_error(module: str, message: str):
    await send(embed={
        "title": f"Erreur — {module}",
        "description": message[:2000],
        "color": 0xE84057,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


async def daily_report(stats: dict):
    lines = [
        f"**Kills today**: {stats.get('kills_today', 0)}",
        f"**Clips today**: {stats.get('clips_today', 0)}",
        f"**Gemini calls**: {stats.get('gemini_calls', 0)} / 950",
        f"**Errors**: {stats.get('errors', 0)}",
        f"**Uptime**: {stats.get('uptime_hours', 0):.1f}h",
    ]
    await send(embed={
        "title": "LoLTok — Rapport quotidien",
        "description": "\n".join(lines),
        "color": 0x0057FF,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
