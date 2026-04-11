"""Client for esports-api.lolesports.com — schedule, matches, teams, events."""

import httpx
from config import config
from scheduler import scheduler

HEADERS = {"x-api-key": config.LOLESPORTS_API_KEY}


async def api_get(endpoint: str, params: dict) -> dict | None:
    """GET request to LoL Esports API with rate limiting."""
    await scheduler.wait_for("lolesports_idle")
    params["hl"] = "en-US"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{config.LOLESPORTS_API_URL}/{endpoint}", headers=HEADERS, params=params)
            r.raise_for_status()
            return r.json()
    except Exception:
        return None


async def get_schedule(league_id: str = config.LEC_LEAGUE_ID, page_token: str | None = None) -> tuple[list, str | None]:
    """Fetch one page of the schedule."""
    params: dict = {"leagueId": league_id}
    if page_token:
        params["pageToken"] = page_token
    data = await api_get("getSchedule", params)
    if not data:
        return [], None
    schedule = data.get("data", {}).get("schedule", {})
    events = schedule.get("events", [])
    older = schedule.get("pages", {}).get("older")
    return events, older


async def get_event_details(match_id: str) -> dict | None:
    """Get game-level details for a match."""
    data = await api_get("getEventDetails", {"id": match_id})
    if not data:
        return None
    return data.get("data", {}).get("event", {})


async def get_live() -> dict | None:
    """Check if any matches are currently live."""
    data = await api_get("getLive", {})
    if not data:
        return None
    return data.get("data", {})


def is_kc(team: dict) -> bool:
    return team.get("code", "").upper() in config.KC_CODES
