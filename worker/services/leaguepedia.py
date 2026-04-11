"""
Leaguepedia Cargo API fallback — match data from the wiki.
J+1 availability. Good for picks/bans and KDA.
"""

import httpx
import structlog

log = structlog.get_logger()

CARGO_URL = "https://lol.fandom.com/wiki/Special:CargoExport"


async def get_kc_matches(year: int = 2026) -> list[dict]:
    """Fetch KC matches from Leaguepedia Cargo API."""
    query = {
        "tables": "ScoreboardGames=SG",
        "fields": "SG.Tournament, SG.DateTime_UTC, SG.Team1, SG.Team2, SG.Winner, SG.Patch, SG.Gamelength",
        "where": f'(SG.Team1="Karmine Corp" OR SG.Team2="Karmine Corp") AND SG.DateTime_UTC >= "{year}-01-01"',
        "order_by": "SG.DateTime_UTC DESC",
        "limit": "100",
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(CARGO_URL, params=query)
            r.raise_for_status()
            data = r.json()
            log.info("leaguepedia_fetched", count=len(data))
            return data
    except Exception as e:
        log.warn("leaguepedia_error", error=str(e))
        return []


async def get_game_scoreboard(tournament: str, team1: str, team2: str) -> list[dict]:
    """Fetch player-level scoreboard for a specific game."""
    query = {
        "tables": "ScoreboardPlayers=SP",
        "fields": "SP.Name, SP.Champion, SP.Kills, SP.Deaths, SP.Assists, SP.Role, SP.Team, SP.Side",
        "where": f'SP.Tournament="{tournament}" AND ((SP.Team="{team1}") OR (SP.Team="{team2}"))',
        "limit": "20",
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(CARGO_URL, params=query)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        log.warn("leaguepedia_scoreboard_error", error=str(e))
        return []
