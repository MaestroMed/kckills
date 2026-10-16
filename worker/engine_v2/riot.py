"""Événements officiels d'une série (lolesports + live stats), sans base.

find_match(...) retrouve un match d'une ligue par date et équipes ;
game_kills(...) rend les kills d'une game (FrameKillMatcher du harvester :
qui, sur qui, epoch, chrono affiché) — rien n'est écrit en base.
"""
from __future__ import annotations

from dataclasses import asdict

from modules.harvester import extract_kills_from_game
from services import lolesports_api


async def league_id(slug: str) -> str | None:
    for lg in await lolesports_api.get_leagues_index():
        if lg.get("slug") == slug:
            return lg.get("id")
    return None


async def find_match(slug: str, day: str, codes: set[str], pages: int = 4) -> dict | None:
    """Événement de la ligue `slug` le jour `day` (AAAA-MM-JJ) entre les équipes `codes`."""
    lid = await league_id(slug)
    if not lid:
        return None
    token = None
    for _ in range(pages):
        events, older = await lolesports_api.get_schedule(lid, token)
        for ev in events:
            m = ev.get("match") or {}
            teams = {(t.get("code") or "").upper() for t in m.get("teams") or []}
            if (ev.get("startTime") or "").startswith(day) and codes <= teams:
                return ev
        if not older:
            break
        token = older
    return None


async def games_of(match_id: str) -> list[dict]:
    ev = await lolesports_api.get_event_details(match_id) or {}
    games = (ev.get("match") or {}).get("games") or []
    return [
        {
            "id": g.get("id"),
            "number": g.get("number"),
            "state": g.get("state"),
            "vods": [{"provider": v.get("provider"), "parameter": v.get("parameter"), "locale": v.get("locale"), "offset": v.get("offset")} for v in g.get("vods") or []],
        }
        for g in games
    ]


async def game_kills(external_game_id: str) -> list[dict]:
    kills = await extract_kills_from_game(external_game_id, db_game_id="pilot-e0")
    return [asdict(k) for k in kills]
