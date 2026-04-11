"""
SENTINEL — Polls the LoL Esports API to detect completed KC matches.

Every POLL_INTERVAL seconds:
1. Fetch the LoL Esports schedule for the current league
2. Check for completed matches involving KC
3. Create match/game entries in the database
4. Enqueue games for the HARVESTER
"""

import httpx
from datetime import datetime, timezone
from .config import config
from .db import get_db, log, get_state, set_state


HEADERS = {
    "x-api-key": config.LOLESPORTS_API_KEY,
}


def fetch_schedule(league_id: str = "98767991302996019") -> list[dict]:
    """Fetch schedule from LoL Esports API.
    Default league_id is LEC.
    """
    url = f"{config.LOLESPORTS_API_URL}/getSchedule"
    params = {"hl": "en-US", "leagueId": league_id}

    try:
        resp = httpx.get(url, headers=HEADERS, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        schedule = data.get("data", {}).get("schedule", {})
        return schedule.get("events", [])
    except Exception as e:
        log("error", "sentinel", f"Failed to fetch schedule: {e}")
        return []


def fetch_event_details(match_id: str) -> dict | None:
    """Fetch detailed match data including games."""
    url = f"{config.LOLESPORTS_API_URL}/getEventDetails"
    params = {"hl": "en-US", "id": match_id}

    try:
        resp = httpx.get(url, headers=HEADERS, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", {}).get("event", {})
    except Exception as e:
        log("error", "sentinel", f"Failed to fetch event details for {match_id}: {e}")
        return None


def is_kc_match(event: dict) -> bool:
    """Check if the event involves Karmine Corp."""
    match = event.get("match", {})
    teams = match.get("teams", [])
    return any(
        config.KC_TEAM_NAME.lower() in (t.get("name", "").lower())
        or t.get("code", "").upper() == "KC"
        for t in teams
    )


def process_completed_match(event: dict) -> int:
    """Process a completed KC match. Returns number of kills enqueued."""
    db = get_db()
    match_data = event.get("match", {})
    match_id = event.get("id", "")

    # Check if already processed
    existing = db.table("matches").select("id").eq("riot_match_id", match_id).execute()
    if existing.data:
        return 0

    teams = match_data.get("teams", [])
    if len(teams) < 2:
        return 0

    # Find or create teams
    team_ids = {}
    for team in teams:
        team_code = team.get("code", "")
        team_name = team.get("name", "")
        team_slug = team_name.lower().replace(" ", "-")

        existing_team = db.table("teams").select("id").eq("short_name", team_code).execute()
        if existing_team.data:
            team_ids[team_code] = existing_team.data[0]["id"]
        else:
            result = db.table("teams").insert({
                "name": team_name,
                "slug": team_slug,
                "short_name": team_code,
                "is_tracked": team_code.upper() == "KC",
            }).execute()
            team_ids[team_code] = result.data[0]["id"]

    # Determine tournament
    league = event.get("league", {})
    tournament_name = f"{league.get('name', 'LEC')} {datetime.now().year}"
    tournament_slug = tournament_name.lower().replace(" ", "-")

    existing_tournament = db.table("tournaments").select("id").eq("slug", tournament_slug).execute()
    if existing_tournament.data:
        tournament_id = existing_tournament.data[0]["id"]
    else:
        result = db.table("tournaments").insert({
            "name": tournament_name,
            "slug": tournament_slug,
            "region": league.get("name", "LEC"),
            "year": datetime.now().year,
        }).execute()
        tournament_id = result.data[0]["id"]

    # Determine winner
    winner_code = None
    for team in teams:
        outcome = team.get("result", {}).get("outcome", "")
        if outcome == "win":
            winner_code = team.get("code", "")
            break

    team_codes = [t.get("code", "") for t in teams]
    blue_code = team_codes[0] if team_codes else ""
    red_code = team_codes[1] if len(team_codes) > 1 else ""

    # Create match
    match_slug = f"{blue_code.lower()}-vs-{red_code.lower()}-{tournament_slug}"
    match_date = event.get("startTime", datetime.now(timezone.utc).isoformat())
    best_of = match_data.get("strategy", {}).get("count", 1)

    match_result = db.table("matches").insert({
        "riot_match_id": match_id,
        "tournament_id": tournament_id,
        "team_blue_id": team_ids.get(blue_code),
        "team_red_id": team_ids.get(red_code),
        "winner_id": team_ids.get(winner_code) if winner_code else None,
        "match_date": match_date,
        "best_of": best_of,
        "stage": event.get("blockName", ""),
        "slug": match_slug,
    }).execute()

    db_match_id = match_result.data[0]["id"]

    # Fetch detailed event data to get game IDs
    details = fetch_event_details(match_id)
    games = []
    if details:
        match_detail = details.get("match", {})
        games = match_detail.get("games", [])

    games_created = 0
    for i, game in enumerate(games):
        game_id = game.get("id", f"unknown-{i}")
        game_state = game.get("state", "")

        if game_state != "completed":
            continue

        game_result = db.table("games").insert({
            "riot_game_id": game_id,
            "match_id": db_match_id,
            "game_number": game.get("number", i + 1),
            "vod_offset_calibrated": False,
        }).execute()

        games_created += 1
        log("info", "sentinel", f"Created game {game_id} (Game {i + 1})")

    log("info", "sentinel",
        f"New KC match: {blue_code} vs {red_code} — {games_created} games created",
        {"match_id": match_id, "db_match_id": db_match_id})

    return games_created


def run():
    """Main sentinel loop iteration."""
    log("info", "sentinel", "Scanning for completed KC matches...")

    events = fetch_schedule()
    total_games = 0

    for event in events:
        event_type = event.get("type", "")
        state = event.get("state", "")

        if event_type != "match" or state != "completed":
            continue

        if not is_kc_match(event):
            continue

        games = process_completed_match(event)
        total_games += games

    if total_games > 0:
        log("info", "sentinel", f"Enqueued {total_games} new games for processing")

    # Update last scan time
    set_state("sentinel_last_scan", datetime.now(timezone.utc).isoformat())
