"""
SENTINEL — Polls LoL Esports schedule and detects completed KC matches.

For each completed KC match not yet in the DB:
1. Upsert the `matches` row (by external_id)
2. Upsert every `games` row linked to that match via match_id FK
3. Extract & store VOD metadata from getEventDetails when available

PR-loltok BB — multi-league sentinel
====================================
Pre-PR : `run()` made ONE getSchedule call against the LEC league_id
hardcoded in config.LEC_LEAGUE_ID. The pilot was LEC-only by birth.

Post-PR : `run()` reads `services.league_config.load_tracked_leagues()`
and loops over EVERY tracked league. Default env
`KCKILLS_TRACKED_LEAGUES=lec` → byte-identical behavior to today (one
schedule scan, LEC only). Set `KCKILLS_TRACKED_LEAGUES=lec,lcs,lck`
for 3 leagues, or `*` for every active league in the `leagues` table.

The match-discovery / team-resolution / game-upsert logic INSIDE the
per-event loop is unchanged ; only the outer driver is new.
"""

from __future__ import annotations

import structlog

from services import discord_webhook, league_config, lolesports_api
from services.observability import run_logged
from services.supabase_client import safe_insert, safe_select, safe_upsert

log = structlog.get_logger()


def _resolve_team_id(team: dict) -> str | None:
    """Return the teams.id (UUID) for a lolesports team payload.

    Lookup priority:
      1. By teams.external_id (the lolesports team UUID — stable).
      2. By teams.code (e.g. "KC", "SK") — fallback for legacy rows
         whose external_id is a placeholder like "team_kc".

    If neither match, INSERT a new teams row from the API payload so
    every future sentinel pass resolves cleanly.
    Returns None only if the API payload is too thin to insert (no code).
    """
    ext_id = (team.get("id") or "").strip()
    code = (team.get("code") or "").strip().upper()
    name = (team.get("name") or code or "").strip()

    if ext_id:
        rows = safe_select("teams", "id", external_id=ext_id)
        if rows:
            return rows[0]["id"]
    if code:
        rows = safe_select("teams", "id", code=code)
        if rows:
            return rows[0]["id"]

    if not code:
        return None

    payload = {
        "external_id": ext_id or f"team_{code.lower()}",
        "code": code,
        "name": name or code,
        "slug": code.lower(),
        "logo_url": team.get("image"),
        "is_tracked": code in {"KC"},
    }
    inserted = safe_insert("teams", payload)
    if inserted and inserted.get("id"):
        return inserted["id"]
    rows = safe_select("teams", "id", code=code)
    return rows[0]["id"] if rows else None


async def _scan_league_schedule(league: league_config.TrackedLeague) -> int:
    """Scan ONE league's schedule. Returns the count of new matches.

    Extracted from `run()` so the multi-league outer loop can call it
    once per tracked league. The body is the same per-event processing
    that pre-PR ran inline ; only the league_id parameter is now
    explicit instead of falling through to config.LEC_LEAGUE_ID.

    Skips silently when the league has no `lolesports_league_id` (e.g.
    a Leaguepedia-only league) — the scraping pipeline owned by Agent
    BD handles those leagues via a different code path.
    """
    if not league.lolesports_league_id:
        log.info(
            "sentinel_skip_no_lolesports_id",
            league=str(league),
        )
        return 0

    log.info(
        "sentinel_scan_league",
        league=str(league),
        lolesports_id=league.lolesports_league_id,
    )

    events, _next = await lolesports_api.get_schedule(
        league_id=league.lolesports_league_id,
    )
    new_matches = 0

    # PR23.12 — pre-insert upcoming/inProgress matches AND completed.
    # Previously the sentinel ignored any match not in state='completed'
    # which meant every live match started its lifecycle ~1h late : the
    # match row only landed AFTER the broadcast ended, so the harvester
    # couldn't extract kills in real time and the clipper played catch-up.
    #
    # New flow per event state :
    #   'completed'  → full processing (insert games, kick downstream)
    #   'inProgress' → insert match + games (state='live') so harvester
    #                  can start polling live stats feed immediately
    #   'unstarted'  → insert match shell (state='upcoming') so the
    #                  /matches page shows it ahead of time. Games
    #                  (and the harvester run) wait until kickoff.
    for event in events:
        if event.get("type") != "match":
            continue
        ev_state = event.get("state", "")
        if ev_state not in ("completed", "inProgress", "unstarted"):
            continue
        is_completed = (ev_state == "completed")

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

        # For unstarted matches, getEventDetails often has no game info yet,
        # but we DO want to insert the match shell so the /matches page
        # shows the upcoming fixture. Fall back to a minimal details dict.
        details = await lolesports_api.get_event_details(match_ext_id)
        if not details and is_completed:
            log.warn("sentinel_no_details", match_id=match_ext_id)
            continue
        if not details:
            details = {}

        team_a, team_b = teams[0], teams[1]
        kc_team = team_a if lolesports_api.is_kc(team_a) else team_b
        opp_team = team_b if lolesports_api.is_kc(team_a) else team_a

        # Resolve team UUIDs BEFORE the match upsert so team_blue_id /
        # team_red_id are never NULL. If the team isn't yet in the DB
        # we insert it from the lolesports payload (id, code, name,
        # image). Without this guarantee the matches table accumulates
        # rows the frontend can't render (see SK match 115548668059589320).
        blue_id = _resolve_team_id(team_a)
        red_id = _resolve_team_id(team_b)
        if not blue_id or not red_id:
            log.warn(
                "match_team_unresolved",
                match_id=match_ext_id,
                blue_code=team_a.get("code"),
                red_code=team_b.get("code"),
                resolved_blue=bool(blue_id),
                resolved_red=bool(red_id),
            )

        strategy = match.get("strategy", {}) or {}
        bo_count = strategy.get("count", 1)

        # Map lolesports state → DB state
        # completed   → 'completed' (final scores in)
        # inProgress  → 'live'      (broadcast running, harvester should poll)
        # unstarted   → 'upcoming'  (scheduled, awaiting kickoff)
        db_state = (
            "completed" if ev_state == "completed"
            else "live" if ev_state == "inProgress"
            else "upcoming"
        )

        match_row = safe_upsert(
            "matches",
            {
                "external_id": match_ext_id,
                "team_blue_id": blue_id,
                "team_red_id": red_id,
                "format": f"bo{bo_count}",
                "stage": event.get("blockName", "") or "",
                "scheduled_at": event.get("startTime"),
                "state": db_state,
            },
            on_conflict="external_id",
        )
        match_db_id = (match_row or {}).get("id") if match_row else None
        if not match_db_id and existing:
            match_db_id = existing[0]["id"]

        # Insert / upsert each game with proper match_id FK
        # PR23.12 — also accept inProgress games so the harvester can
        # start polling live stats DURING the broadcast, not just after.
        detail_match = details.get("match", {}) or {}
        for game in detail_match.get("games", []):
            game_state = game.get("state", "")
            if game_state not in ("completed", "inProgress", "unstarted"):
                continue

            game_ext_id = game.get("id", "")
            if not game_ext_id:
                continue

            vod_youtube_id: str | None = None
            vod_offset: int | None = None

            # Prefer en-US locale (clean English cast), fall back to any YouTube VOD
            # CRITICAL : vod.offset is the seconds-into-VOD where the game
            # begins. If the lolesports API doesn't return it (common — many
            # match feeds omit the offset), we MUST store NULL not 0. A
            # zero offset poisons the clipper into pulling content from the
            # very start of the YouTube video — which on a full LEC broadcast
            # is the panel + champion select + intro, NOT the gameplay. Clips
            # produced this way show drafts/interviews instead of kills.
            # The vod_offset_finder module (PR7-A2) handles NULL offsets via
            # Live Stats epoch alignment.
            def _parse_offset(raw):
                if raw is None or raw == "":
                    return None
                try:
                    val = int(raw)
                    return val if val > 0 else None  # 0 is treated as missing
                except (TypeError, ValueError):
                    return None

            vods = game.get("vods", []) or []
            for vod in vods:
                if vod.get("provider") == "youtube" and str(vod.get("locale", "")).startswith("en"):
                    vod_youtube_id = vod.get("parameter")
                    vod_offset = _parse_offset(vod.get("offset"))
                    break
            if not vod_youtube_id:
                for vod in vods:
                    if vod.get("provider") == "youtube":
                        vod_youtube_id = vod.get("parameter")
                        vod_offset = _parse_offset(vod.get("offset"))
                        break

            # State mapping :
            # completed + has VOD → 'vod_found' (clipper-ready)
            # completed + no VOD  → 'pending'
            # inProgress          → 'live' (harvester picks up via live stats)
            # unstarted           → 'pending'
            if game_state == "completed":
                game_db_state = "vod_found" if vod_youtube_id else "pending"
            elif game_state == "inProgress":
                game_db_state = "live"
            else:
                game_db_state = "pending"

            game_payload = {
                "external_id": game_ext_id,
                "match_id": match_db_id,
                "game_number": game.get("number", 1),
                "vod_youtube_id": vod_youtube_id,
                "vod_offset_seconds": vod_offset,
                "state": game_db_state,
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
                    tournament=event.get("league", {}).get("name", league.short_name),
                )
            except Exception:
                pass

    log.info(
        "sentinel_scan_league_done",
        league=str(league),
        new_matches=new_matches,
    )
    return new_matches


@run_logged()
async def run() -> int:
    """Scan EVERY tracked league for new completed matches.

    Returns the total count of newly-processed matches across all
    leagues. Default `KCKILLS_TRACKED_LEAGUES=lec` → byte-identical to
    the pre-PR pilot (one schedule scan, LEC only).
    """
    log.info("sentinel_scan_start")
    leagues = league_config.load_tracked_leagues()
    log.info(
        "sentinel_tracked_leagues",
        count=len(leagues),
        slugs=[t.slug for t in leagues],
    )

    total_new = 0
    for league in leagues:
        try:
            total_new += await _scan_league_schedule(league)
        except Exception as e:
            # NEVER let one league's failure abort the others. The
            # observability decorator captures the run-level error
            # summary ; the per-league error is logged here.
            log.warn(
                "sentinel_league_scan_failed",
                league=str(league),
                error=str(e)[:200],
            )

    log.info(
        "sentinel_scan_done",
        leagues_scanned=len(leagues),
        new_matches=total_new,
    )
    return total_new
