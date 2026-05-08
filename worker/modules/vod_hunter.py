"""
VOD_HUNTER — Finds YouTube VODs for completed games and calibrates offsets.

Uses getEventDetails VOD data first (priority), then yt-dlp search as fallback.

Wave 27.4 — bounds the per-cycle scan to GAMES_PER_CYCLE oldest-first
games. Previously the unbounded ``safe_select(..., state='pending')``
silently truncated at PostgREST's default 1000-row cap once the backlog
grew past that, so the oldest pending games could be permanently
hidden behind a wall of newer ones. Now we drain oldest-first with a
visible per-cycle limit ; the next scheduler tick picks up the next
slice.
"""

import structlog
from services import lolesports_api, youtube_dl
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()

# Per-cycle cap. Picked to match the LEC backlog rhythm — at peak
# there's ~30 games/day to enrich, and the daemon ticks the hunter
# multiple times an hour, so 100 covers a full day's intake even if
# the worker was down for several hours.
GAMES_PER_CYCLE = 100


async def run():
    """Find VODs for games that don't have them yet."""
    log.info("vod_hunter_start")

    # Get games without VOD. Oldest-first so we drain the backlog in
    # arrival order ; bounded so a 5000-row backlog can't lock the
    # hunter into one massive sweep.
    games = safe_select(
        "games",
        "id, external_id, vod_youtube_id, match_id, game_number",
        state="pending",
        _limit=GAMES_PER_CYCLE,
        _order="created_at.asc",
    )

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
