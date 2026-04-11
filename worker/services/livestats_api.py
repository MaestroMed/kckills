"""Client for feed.lolesports.com — live game stats with frame-by-frame KDA."""

import httpx
from config import config
from scheduler import scheduler


async def get_window(game_id: str, starting_time: str | None = None) -> dict | None:
    """Get game window (frames with per-player KDA snapshots)."""
    await scheduler.wait_for("livestats")
    url = f"{config.LOLESPORTS_FEED_URL}/window/{game_id}"
    params = {}
    if starting_time:
        params["startingTime"] = starting_time
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, params=params)
            if r.status_code == 200 and len(r.content) > 100:
                return r.json()
    except Exception:
        pass
    return None


async def get_details(game_id: str, starting_time: str | None = None) -> dict | None:
    """Get detailed game stats (items, runes, extended stats)."""
    await scheduler.wait_for("livestats")
    url = f"{config.LOLESPORTS_FEED_URL}/details/{game_id}"
    params = {}
    if starting_time:
        params["startingTime"] = starting_time
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, params=params)
            if r.status_code == 200 and len(r.content) > 100:
                return r.json()
    except Exception:
        pass
    return None


def extract_participants(game_data: dict) -> dict[str, dict]:
    """Extract participant map from game metadata."""
    meta = game_data.get("gameMetadata", {})
    participants = {}
    for side_key, side in [("blueTeamMetadata", "blue"), ("redTeamMetadata", "red")]:
        team_meta = meta.get(side_key, {})
        for p in team_meta.get("participantMetadata", []):
            pid = str(p.get("participantId", ""))
            participants[pid] = {
                "name": p.get("summonerName", "Unknown"),
                "champion": p.get("championId", "Unknown"),
                "role": p.get("role", ""),
                "side": side,
            }
    return participants


def extract_kda(frame: dict) -> dict[str, dict]:
    """Extract per-participant KDA from a frame."""
    kda = {}
    for side_key in ["blueTeam", "redTeam"]:
        team = frame.get(side_key, {})
        for p in team.get("participants", []):
            pid = str(p.get("participantId", ""))
            kda[pid] = {
                "kills": p.get("kills", 0),
                "deaths": p.get("deaths", 0),
                "assists": p.get("assists", 0),
                "gold": p.get("totalGold", 0),
                "cs": p.get("creepScore", 0),
                "level": p.get("level", 1),
            }
    return kda
