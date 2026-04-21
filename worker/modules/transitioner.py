"""
TRANSITIONER — Bridges status='raw' kills to 'vod_found' when their game
has a VOD ID. Without this, the daemon harvester inserts kills as 'raw'
and they sit forever because the clipper only picks up 'vod_found'.

Runs every 5 min in the daemon. Cheap query.
"""
from __future__ import annotations

import structlog
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


async def run() -> int:
    """Transition raw kills to vod_found when their game has a VOD."""
    log.info("transitioner_start")

    # Get all raw kills
    raw_kills = safe_select("kills", "id, game_id", status="raw") or []
    if not raw_kills:
        return 0

    # Get all games (just id + vod_youtube_id) — small table, fine to fetch
    games = safe_select("games", "id, vod_youtube_id, vod_offset_seconds") or []
    games_with_vod = {
        g["id"]: g for g in games if g.get("vod_youtube_id")
    }

    transitioned = 0
    for kill in raw_kills:
        gid = kill.get("game_id")
        if gid in games_with_vod:
            safe_update("kills", {"status": "vod_found"}, "id", kill["id"])
            transitioned += 1

    log.info("transitioner_done", transitioned=transitioned, raw_remaining=len(raw_kills) - transitioned)
    return transitioned
