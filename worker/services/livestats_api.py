"""Client for feed.lolesports.com — live game stats with frame-by-frame KDA.

Wave 27.2 — uses the shared :mod:`services.http_pool` so a single
keep-alive AsyncClient serves the whole match instead of one fresh
TCP+TLS handshake per 10-second poll. Hot path : during a live match
we hit get_window every 10s ; one client per process is plenty.
"""

import structlog
from config import config
from scheduler import scheduler
from services import http_pool

log = structlog.get_logger()


def _client():
    # Pooled module singleton. Created on first call, reused across
    # the worker's lifetime, closed by main.py at shutdown.
    return http_pool.get("livestats", timeout=30)


async def get_window(game_id: str, starting_time: str | None = None) -> dict | None:
    """Get game window (frames with per-player KDA snapshots).

    Returns None on any failure (HTTP error, timeout, parse error, empty
    body). Wave 20.3 — failures now log instead of being silent. The
    livestats feed is the *primary* kill-detection source, so an outage
    here directly degrades the pipeline ; logging makes the cause
    surface in real time instead of "why aren't we detecting any kills".
    """
    await scheduler.wait_for("livestats")
    url = f"{config.LOLESPORTS_FEED_URL}/window/{game_id}"
    params = {}
    if starting_time:
        params["startingTime"] = starting_time
    try:
        r = await _client().get(url, params=params)
        if r.status_code == 200 and len(r.content) > 100:
            return r.json()
        # Non-200 or suspiciously empty body — log so the operator
        # can correlate "no kills detected" with upstream issues.
        log.warn(
            "livestats_window_unhealthy",
            game_id=game_id,
            status=r.status_code,
            content_len=len(r.content),
        )
    except Exception as e:
        log.warn(
            "livestats_window_failed",
            game_id=game_id,
            error_type=type(e).__name__,
            error=str(e)[:160],
        )
    return None


async def get_details(game_id: str, starting_time: str | None = None) -> dict | None:
    """Get detailed game stats (items, runes, extended stats).

    Same logging discipline as get_window — failures surface as
    structured warnings rather than silent None returns.
    """
    await scheduler.wait_for("livestats")
    url = f"{config.LOLESPORTS_FEED_URL}/details/{game_id}"
    params = {}
    if starting_time:
        params["startingTime"] = starting_time
    try:
        r = await _client().get(url, params=params)
        if r.status_code == 200 and len(r.content) > 100:
            return r.json()
        log.warn(
            "livestats_details_unhealthy",
            game_id=game_id,
            status=r.status_code,
            content_len=len(r.content),
        )
    except Exception as e:
        log.warn(
            "livestats_details_failed",
            game_id=game_id,
            error_type=type(e).__name__,
            error=str(e)[:160],
        )
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
