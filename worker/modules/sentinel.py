"""
SENTINEL — Polls LoL Esports schedule and detects completed KC matches.

For each completed KC match not yet in the DB:
1. Upsert the `matches` row (by external_id)
2. Upsert every `games` row linked to that match via match_id FK
3. Extract & store VOD metadata from getEventDetails when available
"""

import structlog

from services import lolesports_api, discord_webhook
from services.supabase_client import safe_select, safe_upsert

log = structlog.get_logger()


async def run() -> int:
    """Scan the LEC schedule for new completed KC matches. Returns the count of newly-processed matches."""
    log.info("sentinel_scan_start")

    events, _next = await lolesports_api.get_schedule()
    new_matches = 0

    for event in events:
        if event.get("type") != "match":
            continue
        if event.get("state") != "completed":
            continue

        match = event.get("match", {})
        teams = match.get("teams", [])
        if len(teams) < 2:
            continue
        if not any(lolesports_api.is_kc(t) for t in teams):
            continue

        match_ext_id = match.get("id", "")
        if not match_ext_id:
            continue

        # Skip if already fully processed (kills_extracted=true on every game)
        existing = safe_select("matches", "id", external_id=match_ext_id)
        already_seen = bool(existing)

        details = await lolesports_api.get_event_details(match_ext_id)
        if not details:
            log.warn("sentinel_no_details", match_id=match_ext_id)
            continue

        team_a, team_b = teams[0], teams[1]
        kc_team = team_a if lolesports_api.is_kc(team_a) else team_b
        opp_team = team_b if lolesports_api.is_kc(team_a) else team_a

        strategy = match.get("strategy", {}) or {}
        bo_count = strategy.get("count", 1)

        match_row = safe_upsert(
            "matches",
            {
                "external_id": match_ext_id,
                "format": f"bo{bo_count}",
                "stage": event.get("blockName", "") or "",
                "scheduled_at": event.get("startTime"),
                "state": "completed",
            },
            on_conflict="external_id",
        )
        match_db_id = (match_row or {}).get("id") if match_row else None
        if not match_db_id and existing:
            match_db_id = existing[0]["id"]

        # Insert / upsert each game with proper match_id FK
        detail_match = details.get("match", {}) or {}
        for game in detail_match.get("games", []):
            if game.get("state") != "completed":
                continue

            game_ext_id = game.get("id", "")
            if not game_ext_id:
                continue

            vod_youtube_id: str | None = None
            vod_offset: int | None = None

            # Prefer en-US locale (clean English cast), fall back to any YouTube VOD
            vods = game.get("vods", []) or []
            for vod in vods:
                if vod.get("provider") == "youtube" and str(vod.get("locale", "")).startswith("en"):
                    vod_youtube_id = vod.get("parameter")
                    vod_offset = int(vod.get("offset") or 0)
                    break
            if not vod_youtube_id:
                for vod in vods:
                    if vod.get("provider") == "youtube":
                        vod_youtube_id = vod.get("parameter")
                        vod_offset = int(vod.get("offset") or 0)
                        break

            game_payload = {
                "external_id": game_ext_id,
                "match_id": match_db_id,
                "game_number": game.get("number", 1),
                "vod_youtube_id": vod_youtube_id,
                "vod_offset_seconds": vod_offset,
                "state": "vod_found" if vod_youtube_id else "pending",
            }
            # Strip keys with None so we don't overwrite existing good data
            game_payload = {k: v for k, v in game_payload.items() if v is not None}
            safe_upsert("games", game_payload, on_conflict="external_id")

        if not already_seen:
            new_matches += 1
            log.info(
                "match_detected",
                match_id=match_ext_id,
                teams=f"{team_a.get('code')} vs {team_b.get('code')}",
                stage=event.get("blockName", ""),
            )
            # Fire-and-forget Discord notification
            try:
                await discord_webhook.notify_match(
                    blue=team_a.get("code", "?"),
                    red=team_b.get("code", "?"),
                    games=len(detail_match.get("games", []) or []),
                    tournament=event.get("league", {}).get("name", "LEC"),
                )
            except Exception:
                pass

    log.info("sentinel_scan_done", new_matches=new_matches)
    return new_matches
