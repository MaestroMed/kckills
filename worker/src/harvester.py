"""
HARVESTER — Fetches kill events from completed games and inserts them into the DB.

For each game in status 'pending' in the kills pipeline:
1. Fetch the game timeline from LoL Esports live feed
2. Extract all CHAMPION_KILL events
3. Filter: killer is KC OR victim is KC OR assist is KC
4. Insert kills into the database with 'pending' clip status
"""

import httpx
from .config import config
from .db import get_db, log


HEADERS = {
    "x-api-key": config.LOLESPORTS_API_KEY,
}


def fetch_game_data(game_id: str) -> dict | None:
    """Fetch game window data from the live stats feed.
    This contains detailed frame-by-frame data including kills.
    """
    url = f"{config.LOLESPORTS_FEED_URL}/window/{game_id}"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log("warn", "harvester", f"Failed to fetch game data for {game_id}: {e}")
        return None


def fetch_game_details(game_id: str) -> dict | None:
    """Fetch game details from the LoL Esports event details API."""
    url = f"{config.LOLESPORTS_FEED_URL}/details/{game_id}"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log("warn", "harvester", f"Failed to fetch game details for {game_id}: {e}")
        return None


def get_kc_player_ids(db, game_id: str) -> set[str]:
    """Get player IDs for KC players in this game."""
    # Get KC team ID
    kc_team = db.table("teams").select("id").eq("short_name", "KC").single().execute()
    if not kc_team.data:
        return set()

    kc_team_id = kc_team.data["id"]
    players = db.table("players").select("id, riot_puuid").eq("team_id", kc_team_id).execute()
    return {p["id"] for p in (players.data or [])}


def resolve_player(db, participant_data: dict, team_code: str) -> str | None:
    """Find or create a player from game participant data."""
    summoner_name = participant_data.get("summonerName", "Unknown")
    role = participant_data.get("role", "").lower()

    # Map role names
    role_map = {"top": "top", "jungle": "jungle", "mid": "mid", "bottom": "adc", "support": "support"}
    db_role = role_map.get(role, role)

    # Try to find existing player by name
    slug = summoner_name.lower().replace(" ", "-")
    existing = db.table("players").select("id").eq("slug", slug).execute()
    if existing.data:
        return existing.data[0]["id"]

    # Find team
    team = db.table("teams").select("id").eq("short_name", team_code).execute()
    team_id = team.data[0]["id"] if team.data else None

    # Create player
    result = db.table("players").insert({
        "summoner_name": summoner_name,
        "slug": slug,
        "role": db_role if db_role in ("top", "jungle", "mid", "adc", "support") else None,
        "team_id": team_id,
    }).execute()

    return result.data[0]["id"] if result.data else None


def process_game(game_id: str, db_game_id: str):
    """Process a single game: extract kills and insert into DB."""
    db = get_db()

    # Check if kills already extracted for this game
    existing_kills = db.table("kills").select("id").eq("game_id", db_game_id).limit(1).execute()
    if existing_kills.data:
        log("info", "harvester", f"Game {game_id} already has kills, skipping")
        return

    # Fetch game data
    game_data = fetch_game_data(game_id)
    if not game_data:
        log("error", "harvester", f"Could not fetch data for game {game_id}")
        return

    # Extract frames and participants
    frames = game_data.get("frames", [])
    if not frames:
        log("warn", "harvester", f"No frames for game {game_id}")
        return

    # Get participants from first frame
    game_metadata = game_data.get("gameMetadata", {})
    blue_team = game_metadata.get("blueTeamMetadata", {})
    red_team = game_metadata.get("redTeamMetadata", {})

    blue_code = blue_team.get("esportsTeamId", "")
    red_code = red_team.get("esportsTeamId", "")

    # Build participant map: participantId -> {player info}
    participants = {}
    for team_data, side in [(blue_team, "blue"), (red_team, "red")]:
        for p in team_data.get("participantMetadata", []):
            pid = p.get("participantId", "")
            participants[pid] = {
                "summoner_name": p.get("summonerName", "Unknown"),
                "champion": p.get("championId", "Unknown"),
                "role": p.get("role", ""),
                "side": side,
                "team_code": team_data.get("esportsTeamId", ""),
            }

    # Get KC team info
    kc_team = db.table("teams").select("id").eq("short_name", "KC").single().execute()
    kc_team_id = kc_team.data["id"] if kc_team.data else None

    # Resolve all participants to DB player IDs
    player_map: dict[str, str] = {}  # participantId -> db player id
    for pid, pdata in participants.items():
        db_player_id = resolve_player(db, pdata, pdata.get("team_code", ""))
        if db_player_id:
            player_map[pid] = db_player_id

    # Now parse kill events from the details endpoint
    details = fetch_game_details(game_id)
    if not details:
        log("warn", "harvester", f"No details for game {game_id}, trying frame-based extraction")
        # Fallback: extract from frames
        _extract_kills_from_frames(db, db_game_id, frames, participants, player_map, kc_team_id)
        return

    # Parse events from details
    detail_frames = details.get("frames", [])
    kills_inserted = 0

    for frame in detail_frames:
        for event in frame.get("events", []):
            if event.get("type") != "CHAMPION_KILL":
                continue

            killer_pid = str(event.get("killerId", ""))
            victim_pid = str(event.get("victimId", ""))
            assisting_pids = [str(a) for a in event.get("assistingParticipantIds", [])]
            timestamp_ms = event.get("timestamp", 0)
            position = event.get("position", {})

            killer_info = participants.get(killer_pid, {})
            victim_info = participants.get(victim_pid, {})

            killer_db_id = player_map.get(killer_pid)
            victim_db_id = player_map.get(victim_pid)

            if not killer_db_id or not victim_db_id:
                continue

            # Check if KC is involved
            kc_is_killer = _is_kc_player(db, killer_db_id, kc_team_id)
            kc_is_victim = _is_kc_player(db, victim_db_id, kc_team_id)
            kc_assist = any(
                _is_kc_player(db, player_map.get(a, ""), kc_team_id)
                for a in assisting_pids
                if a in player_map
            )

            if not (kc_is_killer or kc_is_victim or kc_assist):
                continue

            # Determine kill type
            kill_type = _classify_kill(event)

            # Insert kill
            kill_result = db.table("kills").insert({
                "game_id": db_game_id,
                "game_timestamp_ms": timestamp_ms,
                "position_x": position.get("x"),
                "position_y": position.get("y"),
                "killer_id": killer_db_id,
                "killer_champion": killer_info.get("champion", "Unknown"),
                "victim_id": victim_db_id,
                "victim_champion": victim_info.get("champion", "Unknown"),
                "kill_type": kill_type,
                "is_first_blood": event.get("killType") == "KILL_FIRST_BLOOD",
                "shutdown_bounty": event.get("shutdownBounty", 0),
                "multi_kill_length": event.get("multiKillLength", 1),
                "kc_is_killer": kc_is_killer,
                "kc_is_victim": kc_is_victim,
                "status": "pending",
            }).execute()

            kill_id = kill_result.data[0]["id"]

            # Insert assists
            for assist_pid in assisting_pids:
                assist_db_id = player_map.get(assist_pid)
                if assist_db_id:
                    assist_info = participants.get(assist_pid, {})
                    db.table("kill_assists").insert({
                        "kill_id": kill_id,
                        "player_id": assist_db_id,
                        "champion": assist_info.get("champion", "Unknown"),
                        "is_kc_player": _is_kc_player(db, assist_db_id, kc_team_id),
                    }).execute()

            # Auto-tag
            tags = _auto_tags(kill_type, event)
            for tag in tags:
                db.table("kill_tags").insert({
                    "kill_id": kill_id,
                    "tag": tag,
                    "is_auto": True,
                }).execute()

            kills_inserted += 1

    log("info", "harvester",
        f"Extracted {kills_inserted} KC-related kills from game {game_id}",
        {"game_id": game_id, "db_game_id": db_game_id})


def _is_kc_player(db, player_id: str, kc_team_id: str | None) -> bool:
    if not kc_team_id or not player_id:
        return False
    result = db.table("players").select("team_id").eq("id", player_id).single().execute()
    return result.data and result.data.get("team_id") == kc_team_id


def _classify_kill(event: dict) -> str:
    multi = event.get("multiKillLength", 1)
    if event.get("killType") == "KILL_FIRST_BLOOD":
        return "first_blood"
    if event.get("shutdownBounty", 0) >= 700:
        return "shutdown"
    if multi == 2:
        return "double_kill"
    if multi == 3:
        return "triple_kill"
    if multi == 4:
        return "quadra_kill"
    if multi >= 5:
        return "penta_kill"
    # Solo kill: no assists
    if not event.get("assistingParticipantIds"):
        return "solo_kill"
    return "regular"


def _auto_tags(kill_type: str, event: dict) -> list[str]:
    tags = []
    if kill_type != "regular":
        tags.append(kill_type.replace("_", " "))
    if not event.get("assistingParticipantIds"):
        tags.append("1v1")
    if event.get("shutdownBounty", 0) >= 1000:
        tags.append("big shutdown")
    return tags


def _extract_kills_from_frames(db, db_game_id: str, frames: list, participants: dict,
                                player_map: dict, kc_team_id: str | None):
    """Fallback: extract kill info from frame snapshots (less detailed)."""
    log("info", "harvester", f"Using frame-based kill extraction for game {db_game_id}")
    # This is a simplified fallback — real implementation would diff consecutive frames
    # to detect kills from KDA changes between frames
    pass


def run():
    """Process all games that need kill extraction."""
    db = get_db()

    # Find games without any kills yet
    games = db.table("games").select("id, riot_game_id, match_id").execute()

    for game in games.data or []:
        riot_game_id = game.get("riot_game_id")
        if not riot_game_id:
            continue

        existing_kills = db.table("kills").select("id").eq("game_id", game["id"]).limit(1).execute()
        if existing_kills.data:
            continue

        log("info", "harvester", f"Processing game {riot_game_id}")
        process_game(riot_game_id, game["id"])
