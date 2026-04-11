"""
fetch_real_data.py — Fetches REAL KC data from LoL Esports API.
Outputs: data/kc_matches.json

Usage:
    set PYTHONIOENCODING=utf-8
    python scripts/fetch_real_data.py
"""

import json
import time
import httpx
from pathlib import Path
from datetime import datetime, timezone, timedelta

API_URL = "https://esports-api.lolesports.com/persisted/gw"
FEED_URL = "https://feed.lolesports.com/livestats/v1"
API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"
HEADERS = {"x-api-key": API_KEY}
LEC_LEAGUE_ID = "98767991302996019"
KC_CODES = {"KC"}

OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "kc_matches.json"


def api_get(endpoint, params):
    params["hl"] = "en-US"
    r = httpx.get(f"{API_URL}/{endpoint}", headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def feed_get(path, timeout=15):
    try:
        r = httpx.get(f"{FEED_URL}/{path}", timeout=timeout)
        if r.status_code == 200 and len(r.content) > 100:
            return r.json()
    except Exception:
        pass
    return None


def is_kc(team):
    return team.get("code", "").upper() in KC_CODES


def fetch_all_kc_events():
    """Paginate through schedule and collect all completed KC matches."""
    all_kc = []
    seen = set()
    page_token = None
    page = 0

    print("Fetching LEC schedule...")
    while True:
        page += 1
        params = {"leagueId": LEC_LEAGUE_ID}
        if page_token:
            params["pageToken"] = page_token

        data = api_get("getSchedule", params)
        schedule = data.get("data", {}).get("schedule", {})
        events = schedule.get("events", [])
        pages = schedule.get("pages", {})
        older = pages.get("older")

        print(f"  Page {page}: {len(events)} events")

        for e in events:
            if e.get("type") != "match" or e.get("state") != "completed":
                continue
            match = e.get("match", {})
            teams = match.get("teams", [])
            if len(teams) < 2:
                continue
            if not any(is_kc(t) for t in teams):
                continue

            mid = match.get("id", "")
            if mid in seen:
                continue
            seen.add(mid)
            all_kc.append(e)

        if not older:
            break
        page_token = older
        time.sleep(0.3)

    print(f"Found {len(all_kc)} KC matches\n")
    return all_kc


def fetch_game_end_stats(game_id, match_start_time, game_number=1):
    """Find end-of-game stats by scanning timestamps.

    For BO3/BO5 series, game N doesn't start at match_start — each game takes
    ~15min draft + ~30-45min play = ~45-60min total. So we scan a range
    proportional to the game number to catch games 2-5 of a series.
    """
    start = datetime.fromisoformat(match_start_time.replace("Z", "+00:00"))

    # First, try the feed WITHOUT a startingTime — the livestats endpoint
    # returns the latest available frames for a game_id when no timestamp
    # is provided. This is the cheapest + most accurate path when the game
    # has ended.
    data = feed_get(f"window/{game_id}")
    if data:
        frames = data.get("frames", [])
        if frames:
            last = frames[-1]
            blue = last.get("blueTeam", {})
            red = last.get("redTeam", {})
            tk = (blue.get("totalKills", 0) or 0) + (red.get("totalKills", 0) or 0)
            tg = (blue.get("totalGold", 0) or 0) + (red.get("totalGold", 0) or 0)
            if tk > 0 or tg > 30000:
                return data, last

    # Fallback: scan a window sized for this specific game number.
    # Game 1: offset 20-100min
    # Game 2: offset 50-130min
    # Game 3: offset 90-170min
    # Game 4: offset 130-210min
    # Game 5: offset 170-250min
    scan_start_min = max(20, (game_number - 1) * 40 + 10)
    scan_end_min = scan_start_min + 90

    best_data = None
    best_last = None
    best_kills = 0

    for offset_min in range(scan_start_min, scan_end_min, 10):
        t = start + timedelta(minutes=offset_min)
        ts = t.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        data = feed_get(f"window/{game_id}?startingTime={ts}")
        if not data:
            continue

        frames = data.get("frames", [])
        if not frames:
            continue

        last = frames[-1]
        blue = last.get("blueTeam", {})
        red = last.get("redTeam", {})
        total_kills = (blue.get("totalKills", 0) or 0) + (red.get("totalKills", 0) or 0)
        total_gold = (blue.get("totalGold", 0) or 0) + (red.get("totalGold", 0) or 0)

        if total_kills > 0 or total_gold > 30000:
            # Keep the frame with the most kills (latest state of the game)
            if total_kills >= best_kills:
                best_kills = total_kills
                best_data = data
                best_last = last

        time.sleep(0.2)

    return best_data, best_last


def process_match(event):
    """Extract structured match data with real game stats."""
    match = event.get("match", {})
    teams = match.get("teams", [])
    league = event.get("league", {})
    block = event.get("blockName", "")
    match_id = match.get("id", "")
    start_time = event.get("startTime", "")

    team_a, team_b = teams[0], teams[1]
    kc_team = team_a if is_kc(team_a) else team_b
    opp_team = team_b if is_kc(team_a) else team_a
    kc_side = "blue" if is_kc(team_a) else "red"

    result = {
        "id": match_id,
        "date": start_time,
        "league": league.get("name", "LEC"),
        "stage": block,
        "kc_side": kc_side,
        "opponent": {"name": opp_team.get("name"), "code": opp_team.get("code"), "image": opp_team.get("image")},
        "kc_image": kc_team.get("image"),
        "kc_won": kc_team.get("result", {}).get("outcome") == "win",
        "kc_score": kc_team.get("result", {}).get("gameWins", 0),
        "opp_score": opp_team.get("result", {}).get("gameWins", 0),
        "best_of": match.get("strategy", {}).get("count", 1),
        "games": [],
    }

    # Get game IDs
    try:
        details_data = api_get("getEventDetails", {"id": match_id})
        detail_event = details_data.get("data", {}).get("event", {})
        detail_match = detail_event.get("match", {})
        games = detail_match.get("games", [])
    except Exception as e:
        print(f"    Could not get event details: {e}")
        return result

    for game in games:
        if game.get("state") != "completed":
            continue

        game_id = game.get("id", "")
        game_num = game.get("number", 0)
        print(f"    Game {game_num} ({game_id})...", end=" ", flush=True)

        # Get VOD info
        vods = []
        for v in game.get("vods", []):
            vods.append({
                "provider": v.get("provider"),
                "parameter": v.get("parameter"),
                "locale": v.get("locale"),
            })

        # Fetch real stats
        full_data, last_frame = fetch_game_end_stats(game_id, start_time)
        if not last_frame:
            print("no stats found")
            continue

        # Extract metadata (champions, players)
        meta = full_data.get("gameMetadata", {}) if full_data else {}
        blue_meta = meta.get("blueTeamMetadata", {})
        red_meta = meta.get("redTeamMetadata", {})

        # Build player map
        player_map = {}
        for side_meta, side_name in [(blue_meta, "blue"), (red_meta, "red")]:
            for pm in side_meta.get("participantMetadata", []):
                pid = pm.get("participantId")
                player_map[pid] = {
                    "participantId": pid,
                    "name": pm.get("summonerName", "?"),
                    "champion": pm.get("championId", "?"),
                    "role": pm.get("role", ""),
                    "side": side_name,
                }

        # Extract KDA from frame
        kc_players = []
        opp_players = []
        for side_key, side_name in [("blueTeam", "blue"), ("redTeam", "red")]:
            team_data = last_frame.get(side_key, {})
            for p in team_data.get("participants", []):
                pid = p.get("participantId")
                pm = player_map.get(pid, {})
                player_out = {
                    "name": pm.get("name", f"Player {pid}"),
                    "champion": pm.get("champion", "?"),
                    "role": pm.get("role", ""),
                    "kills": p.get("kills", 0),
                    "deaths": p.get("deaths", 0),
                    "assists": p.get("assists", 0),
                    "gold": p.get("totalGold", 0),
                    "cs": p.get("creepScore", 0),
                    "level": p.get("level", 1),
                }
                if side_name == kc_side:
                    kc_players.append(player_out)
                else:
                    opp_players.append(player_out)

        kc_total_k = sum(p["kills"] for p in kc_players)
        opp_total_k = sum(p["kills"] for p in opp_players)

        # Team stats
        kc_team_key = "blueTeam" if kc_side == "blue" else "redTeam"
        kc_team_frame = last_frame.get(kc_team_key, {})

        game_out = {
            "id": game_id,
            "number": game_num,
            "kc_players": kc_players,
            "opp_players": opp_players,
            "kc_kills": kc_total_k,
            "opp_kills": opp_total_k,
            "kc_gold": kc_team_frame.get("totalGold", 0),
            "kc_towers": kc_team_frame.get("towers", 0),
            "kc_dragons": len(kc_team_frame.get("dragons", [])),
            "kc_barons": kc_team_frame.get("barons", 0),
            "vods": vods,
        }

        print(f"KC {kc_total_k}-{opp_total_k} ({kc_team_frame.get('totalGold',0)}g)")
        result["games"].append(game_out)
        time.sleep(0.5)

    return result


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  KCKills -- Real Data Fetcher")
    print("=" * 60)

    kc_events = fetch_all_kc_events()
    if not kc_events:
        print("No KC matches found.")
        return

    print(f"Processing {len(kc_events)} matches...\n")
    matches = []

    for i, event in enumerate(kc_events):
        teams = event.get("match", {}).get("teams", [])
        codes = [t.get("code", "?") for t in teams]
        date = event.get("startTime", "")[:10]
        block = event.get("blockName", "")
        print(f"[{i+1}/{len(kc_events)}] {' vs '.join(codes)} -- {block} ({date})")

        m = process_match(event)
        matches.append(m)
        time.sleep(0.5)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "LoL Esports API",
        "team": "Karmine Corp",
        "total_matches": len(matches),
        "total_games": sum(len(m["games"]) for m in matches),
        "matches": matches,
    }

    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))

    total_k = sum(g["kc_kills"] for m in matches for g in m["games"])
    total_d = sum(g["opp_kills"] for m in matches for g in m["games"])
    wins = sum(1 for m in matches if m["kc_won"])
    games_with_data = sum(len(m["games"]) for m in matches)

    print("\n" + "=" * 60)
    print(f"  {len(matches)} matches, {games_with_data} games with stats")
    print(f"  Record: {wins}W-{len(matches)-wins}L")
    print(f"  KC Total: {total_k} kills, {total_d} deaths")
    print(f"  Output: {OUTPUT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    main()
