"""
VOD_HUNTER — Finds YouTube VODs for completed games and calibrates offsets.

Uses getEventDetails VOD data first (priority), then yt-dlp search as fallback.
"""

import structlog
from services import lolesports_api, youtube_dl
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


async def run():
    """Find VODs for games that don't have them yet."""
    log.info("vod_hunter_start")

    # Get games without VOD
    games = safe_select("games", "id, external_id, vod_youtube_id, match_id, game_number", state="pending")

    found = 0
    for game in games:
        if game.get("vod_youtube_id"):
            continue

        # Try getEventDetails first (has VOD data from Riot)
        match_id = game.get("match_id")
        if match_id:
            matches = safe_select("matches", "external_id", id=match_id)
            if matches:
                details = await lolesports_api.get_event_details(matches[0]["external_id"])
                if details:
                    detail_match = details.get("match", {})
                    for g in detail_match.get("games", []):
                        if g.get("id") == game.get("external_id"):
                            for vod in g.get("vods", []):
                                if vod.get("provider") == "youtube":
                                    yt_id = vod.get("parameter")
                                    offset = vod.get("offset", 0)
                                    safe_update("games", {
                                        "vod_youtube_id": yt_id,
                                        "vod_offset_seconds": offset,
                                        "state": "vod_found",
                                    }, "id", game["id"])
                                    log.info("vod_found_from_api", game_id=game["external_id"], youtube_id=yt_id)
                                    found += 1
                                    break

        # If still no VOD, try yt-dlp search
        if not game.get("vod_youtube_id"):
            # Get match info for search query
            if matches:
                match_ext_id = matches[0]["external_id"]
                # Build search query from match context
                results = await youtube_dl.search(f"KC LEC 2026 game {game.get('game_number', '')}", max_results=3)
                if results:
                    yt_id = results[0]["id"]
                    safe_update("games", {
                        "vod_youtube_id": yt_id,
                        "state": "vod_found",
                    }, "id", game["id"])
                    log.info("vod_found_from_search", game_id=game.get("external_id"), youtube_id=yt_id)
                    found += 1

    log.info("vod_hunter_done", found=found)
    return found
