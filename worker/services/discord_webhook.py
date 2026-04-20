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
    multi_kill: str | None = None,
    is_first_blood: bool = False,
    fight_type: str | None = None,
):
    """Post a new kill clip to Discord with rich embed.

    Exceptional clips (score >= 9, multi-kills, first bloods) get a
    @everyone ping and a HYPE prefix to grab attention.
    """
    is_exceptional = (
        (highlight_score is not None and highlight_score >= 9.0)
        or multi_kill in ("triple", "quadra", "penta")
    )

    # Title with emphasis for exceptional clips
    title_prefix = ""
    color = 0xC8AA6E
    content = ""
    if multi_kill == "penta":
        title_prefix = "🔥 PENTAKILL 🔥 "
        color = 0xFF1744
        content = "@everyone PENTAKILL KC ! 🔥"
    elif multi_kill == "quadra":
        title_prefix = "⚡ QUADRA KILL ⚡ "
        color = 0xFF5722
    elif multi_kill == "triple":
        title_prefix = "💥 TRIPLE KILL "
        color = 0xFF9800
    elif is_first_blood:
        title_prefix = "🩸 FIRST BLOOD "
        color = 0xE84057
    elif highlight_score and highlight_score >= 9:
        title_prefix = "🌟 HIGHLIGHT "
        color = 0xFFD700

    embed: dict = {
        "title": f"{title_prefix}{killer_champion} → {victim_champion}",
        "description": description[:200] if description else "Nouveau kill KC",
        "color": color,
        "url": f"https://kckills.com/kill/{kill_id}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "footer": {"text": match_info or "KCKILLS · kckills.com/scroll"},
    }

    fields = []
    if highlight_score is not None:
        score_label = "🔥" * min(5, max(1, int(highlight_score / 2)))
        fields.append({"name": "Score", "value": f"{highlight_score:.1f}/10 {score_label}", "inline": True})
    if fight_type:
        ft_label = {
            "solo_kill": "Solo Kill",
            "pick": "Pick",
            "gank": "Gank",
            "skirmish_2v2": "Skirmish 2v2",
            "skirmish_3v3": "Skirmish 3v3",
            "teamfight_4v4": "Teamfight 4v4",
            "teamfight_5v5": "Teamfight 5v5",
        }.get(fight_type, fight_type)
        fields.append({"name": "Type", "value": ft_label, "inline": True})

    if fields:
        embed["fields"] = fields
    if thumbnail_url:
        embed["thumbnail"] = {"url": thumbnail_url}

    await send(content=content, embed=embed)


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
