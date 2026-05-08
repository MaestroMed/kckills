"""Client for esports-api.lolesports.com — schedule, matches, teams, events.

Wave 27.2 — uses :mod:`services.http_pool` for a process-wide keep-alive
client. The sentinel polls getSchedule + getEventDetails frequently
during the live window ; pooling cuts handshake overhead to zero after
the first call.
"""

from __future__ import annotations

import time

import structlog

from config import config
from scheduler import scheduler
from services import http_pool

log = structlog.get_logger()

HEADERS = {"x-api-key": config.LOLESPORTS_API_KEY}


def _client():
    # Pre-set the headers on the pooled client so we don't pass them
    # on every request. The api-key is stable for the worker lifetime.
    return http_pool.get("lolesports", timeout=30, headers=HEADERS)


async def api_get(endpoint: str, params: dict) -> dict | None:
    """GET request to LoL Esports API with rate limiting."""
    await scheduler.wait_for("lolesports_idle")
    params["hl"] = "en-US"
    try:
        r = await _client().get(
            f"{config.LOLESPORTS_API_URL}/{endpoint}",
            params=params,
        )
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


async def get_schedule(
    league_id: str | None = None,
    page_token: str | None = None,
) -> tuple[list, str | None]:
    """Fetch one page of the schedule for a single league.

    `league_id` is the numeric `leagueId` lolesports param. When not
    provided we default to LEC for backwards compatibility with the KC
    pilot — the new multi-league sentinel ALWAYS passes an explicit id
    via league_config.load_tracked_leagues().
    """
    effective_id = (league_id or config.LEC_LEAGUE_ID).strip()
    params: dict = {"leagueId": effective_id}
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


# ─── getLeagues — full catalog (cached) ───────────────────────────
#
# Used by worker/scripts/seed_leagues.py to discover the canonical
# numeric league_id for every Riot pro circuit. The endpoint returns
# ~80 entries (regional ERLs + worlds + msi + first stand) ; we cache
# for 6 hours because Riot does not add a new league more than once
# a year.
_LEAGUES_CACHE: dict[str, object] = {"data": None, "fetched_at": 0.0}
_LEAGUES_TTL_SECONDS = 6 * 3600


async def get_leagues_index(force_refresh: bool = False) -> list[dict]:
    """Fetch the full leagues catalog from getLeagues.

    Returns the list of league dicts as returned by the API
    (each has { id, slug, name, region, image, priority, displayPriority }).
    Cached for _LEAGUES_TTL_SECONDS to avoid pounding the endpoint
    when seed_leagues.py is rerun on demand.
    """
    now = time.time()
    cached = _LEAGUES_CACHE.get("data")
    fetched_at = float(_LEAGUES_CACHE.get("fetched_at") or 0)
    if (
        not force_refresh
        and cached is not None
        and (now - fetched_at) < _LEAGUES_TTL_SECONDS
    ):
        return list(cached)  # defensive copy

    data = await api_get("getLeagues", {})
    if not data:
        log.warn("lolesports_get_leagues_empty")
        return list(cached) if cached else []
    leagues = (data.get("data") or {}).get("leagues") or []
    _LEAGUES_CACHE["data"] = leagues
    _LEAGUES_CACHE["fetched_at"] = now
    log.info("lolesports_get_leagues_loaded", count=len(leagues))
    return list(leagues)


def is_kc(team: dict) -> bool:
    return team.get("code", "").upper() in config.KC_CODES
