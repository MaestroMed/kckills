"""
SENTINEL — Polls LoL Esports schedule and detects completed KC matches.
"""

import structlog
from services import lolesports_api
from services.supabase_client import safe_insert, safe_select

log = structlog.get_logger()


async def run():
    """Scan for new completed KC matches."""
    log.info("sentinel_scan_start")

    events, _ = await lolesports_api.get_schedule()
    new_matches = 0

    for event in events:
        if event.get("type") != "match" or event.get("state") != "completed":
            continue

        match = event.get("match", {})
        teams = match.get("teams", [])
        if len(teams) < 2:
            continue

        if not any(lolesports_api.is_kc(t) for t in teams):
            continue

        match_id = match.get("id", "")
        if not match_id:
            continue

        # Check if already processed
        existing = safe_select("matches", "id", external_id=match_id)
        if existing:
            continue

        # Get game details
        details = await lolesports_api.get_event_details(match_id)
        if not details:
            continue

        # Determine teams
        team_a, team_b = teams[0], teams[1]
        kc_team = team_a if lolesports_api.is_kc(team_a) else team_b
        opp_team = team_b if lolesports_api.is_kc(team_a) else team_a

        # Insert match
        safe_insert("matches", {
            "external_id": match_id,
            "format": f"bo{match.get('strategy', {}).get('count', 1)}",
            "stage": event.get("blockName", ""),
            "scheduled_at": event.get("startTime"),
            "state": "completed",
        })

        # Insert games
        detail_match = details.get("match", {})
        for game in detail_match.get("games", []):
            if game.get("state") != "completed":
                continue

            game_id = game.get("id", "")
            vod_youtube_id = None
            vod_offset = None

            # Extract VOD info if available
            for vod in game.get("vods", []):
                if vod.get("provider") == "youtube" and vod.get("locale", "").startswith("en"):
                    vod_youtube_id = vod.get("parameter")
                    vod_offset = vod.get("offset", 0)
                    break
            # Fallback: any youtube VOD
            if not vod_youtube_id:
                for vod in game.get("vods", []):
                    if vod.get("provider") == "youtube":
                        vod_youtube_id = vod.get("parameter")
                        vod_offset = vod.get("offset", 0)
                        break

            safe_insert("games", {
                "external_id": game_id,
                "game_number": game.get("number", 1),
                "vod_youtube_id": vod_youtube_id,
                "vod_offset_seconds": vod_offset,
                "state": "pending",
            })

        new_matches += 1
        log.info("match_detected", match_id=match_id,
                 teams=f"{team_a.get('code')} vs {team_b.get('code')}")

    log.info("sentinel_scan_done", new_matches=new_matches)
    return new_matches
