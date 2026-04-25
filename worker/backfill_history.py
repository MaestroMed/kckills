"""
BACKFILL HISTORIQUE — Import all KC LEC matches since 2024.

For each match:
  1. Fetch from LolEsports API (matches + games)
  2. Fetch detailed game metadata (rosters, KDA, champions)
  3. Insert into Supabase (matches, games, game_participants)
  4. Skip kill harvesting (livestats expired for old matches)

This enriches /matches, /player/[slug], /alumni without trying to
clip old games (impossible without live livestats data).
"""
import asyncio
import json
import os
import sys
import time
import httpx
from datetime import datetime
from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from services.supabase_client import safe_select, safe_insert, safe_update
from services.league_config import get_league_lolesports_id

API = "https://esports-api.lolesports.com/persisted/gw"
KEY = os.environ.get("LOL_ESPORTS_API_KEY", "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z")
HEADERS = {"x-api-key": KEY}

# PR-loltok DH : pulled from the `leagues` table via league_config
# instead of a hardcoded constant. Same value at runtime, but the
# script auto-adapts to any new league seeded into the table — no
# edit needed when LoLTok adds LCS / LCK / LPL backfills. Resolved
# once at module load (cheap, deterministic).
LEC_LEAGUE_ID = get_league_lolesports_id("lec") or "98767991302996019"

# All LEC tournaments since 2024
TOURNAMENTS = [
    ("lec_winter_2024", "111560983131400452"),
    ("lec_spring_2024", "111997906550466231"),
    ("lec_summer_2024", "112352881163915249"),
    ("lec_season_finals_2024", "112869331703771902"),
    ("lec_winter_2025", "113475994398658012"),
    ("lec_spring_2025", "113487400974323999"),
    ("lec_summer_2025", "113487526512660769"),
    ("lec_split_1_2026", "115548424304940735"),  # Versus
    ("lec_split_2_2026", "115548668058343983"),  # Spring
]


def fetch_tournament_matches(tournament_id: str) -> list[dict]:
    """Fetch all KC matches in a tournament via getSchedule pagination."""
    matches = []
    page_token = None
    seen_ids = set()
    for _ in range(50):
        params = {"hl": "fr-FR", "tournamentId": tournament_id}
        if page_token:
            params["pageToken"] = page_token
        try:
            r = httpx.get(f"{API}/getSchedule", params=params, headers=HEADERS, timeout=15)
            sched = r.json().get("data", {}).get("schedule", {})
        except Exception as e:
            print(f"    fetch error: {e}")
            break
        events = sched.get("events", [])
        if not events:
            break
        for ev in events:
            mid = ev.get("match", {}).get("id")
            if not mid or mid in seen_ids:
                continue
            seen_ids.add(mid)
            teams = ev.get("match", {}).get("teams", [])
            # Only KC main, not KCB
            codes = [t.get("code") for t in teams]
            if "KC" not in codes:
                continue
            if ev.get("state") != "completed":
                continue
            matches.append({
                "id": mid,
                "date": ev.get("startTime", "")[:10],
                "scheduled_at": ev.get("startTime"),
                "teams": teams,
                "block": ev.get("blockName", ""),
                "state": ev.get("state"),
                "strategy": ev.get("match", {}).get("strategy", {}),
            })
        page_token = sched.get("pages", {}).get("older")
        if not page_token:
            break
        time.sleep(0.4)
    return matches


def fetch_event_details(match_id: str) -> dict | None:
    """Get full event details with games + VOD info."""
    try:
        r = httpx.get(f"{API}/getEventDetails", params={"hl": "fr-FR", "id": match_id},
                      headers=HEADERS, timeout=15)
        return r.json().get("data", {}).get("event", {})
    except Exception as e:
        print(f"    event details error: {e}")
        return None


def get_or_create_team(code: str, name: str) -> str | None:
    """Find or create team in DB. Returns team UUID."""
    rows = safe_select("teams", "id,external_id", code=code)
    if rows:
        return rows[0]["id"]
    # Create
    safe_insert("teams", {
        "external_id": f"team_{code.lower()}",
        "name": name or code,
        "slug": code.lower(),
        "code": code,
        "is_tracked": code == "KC",
    })
    rows = safe_select("teams", "id", code=code)
    return rows[0]["id"] if rows else None


def get_or_create_tournament(slug: str, year: int, split: str) -> str | None:
    """Find or create tournament."""
    rows = safe_select("tournaments", "id", slug=slug)
    if rows:
        return rows[0]["id"]
    safe_insert("tournaments", {
        "external_id": slug,
        "name": slug.replace("_", " ").upper(),
        "slug": slug,
        "league_id": LEC_LEAGUE_ID,
        "year": year,
        "split": split,
    })
    rows = safe_select("tournaments", "id", slug=slug)
    return rows[0]["id"] if rows else None


def upsert_match(match_data: dict, tournament_uuid: str) -> str | None:
    """Insert or update match row."""
    ext_id = match_data["id"]
    rows = safe_select("matches", "id", external_id=ext_id)
    if rows:
        return rows[0]["id"]

    teams = match_data["teams"]
    if len(teams) < 2:
        return None

    team_blue = get_or_create_team(teams[0].get("code"), teams[0].get("name", ""))
    team_red = get_or_create_team(teams[1].get("code"), teams[1].get("name", ""))
    if not team_blue or not team_red:
        return None

    # Winner
    winner_id = None
    for t in teams:
        if t.get("result", {}).get("outcome") == "win":
            winner_id = get_or_create_team(t.get("code"), t.get("name", ""))
            break

    fmt = match_data.get("strategy", {})
    fmt_str = f"bo{fmt.get('count', 1)}" if fmt.get("type") == "bestOf" else "bo1"

    safe_insert("matches", {
        "external_id": ext_id,
        "tournament_id": tournament_uuid,
        "team_blue_id": team_blue,
        "team_red_id": team_red,
        "winner_team_id": winner_id,
        "format": fmt_str,
        "stage": match_data.get("block", ""),
        "scheduled_at": match_data.get("scheduled_at"),
        "state": "completed",
    })
    rows = safe_select("matches", "id", external_id=ext_id)
    return rows[0]["id"] if rows else None


def insert_games(match_uuid: str, match_external_id: str):
    """Pull games from getEventDetails and insert."""
    event = fetch_event_details(match_external_id)
    if not event:
        return 0
    games = event.get("match", {}).get("games", [])

    inserted = 0
    for g in games:
        gid = g.get("id")
        if not gid:
            continue
        rows = safe_select("games", "id", external_id=gid)
        if rows:
            continue

        # VOD info
        vods = g.get("vods", [])
        vod_youtube_id = None
        vod_offset = 0
        # Prefer fr-FR
        fr_vod = next((v for v in vods if v.get("locale") == "fr-FR"), None)
        en_vod = next((v for v in vods if v.get("locale") == "en-US"), None)
        chosen = fr_vod or en_vod or (vods[0] if vods else None)
        if chosen and chosen.get("provider") == "youtube":
            vod_youtube_id = chosen.get("parameter")
            vod_offset = chosen.get("offset") or 0

        safe_insert("games", {
            "external_id": gid,
            "match_id": match_uuid,
            "game_number": g.get("number", 1),
            "vod_youtube_id": vod_youtube_id,
            "vod_offset_seconds": vod_offset,
            "kills_extracted": False,
            "state": "completed",
        })
        inserted += 1
    return inserted


def main():
    print("=== BACKFILL KC LEC HISTORY (2024-2026) ===\n")

    total_matches = 0
    total_new_matches = 0
    total_games = 0

    # Get existing match external_ids
    existing = safe_select("matches", "external_id") or []
    existing_ids = {m["external_id"] for m in existing}
    print(f"Existing matches in DB: {len(existing_ids)}\n")

    for slug, tid in TOURNAMENTS:
        # Parse year + split from slug
        if "2024" in slug:
            year = 2024
        elif "2025" in slug:
            year = 2025
        elif "2026" in slug:
            year = 2026
        else:
            year = 2024
        split = slug.split("_")[1] if "_" in slug else "spring"

        print(f"  {slug} (id={tid})")
        matches = fetch_tournament_matches(tid)
        print(f"    KC matches found: {len(matches)}")

        if not matches:
            continue

        tournament_uuid = get_or_create_tournament(slug, year, split)
        if not tournament_uuid:
            print(f"    SKIP: failed to create tournament")
            continue

        new_in_tour = 0
        for m in matches:
            total_matches += 1
            if m["id"] in existing_ids:
                continue
            match_uuid = upsert_match(m, tournament_uuid)
            if not match_uuid:
                continue
            new_in_tour += 1
            total_new_matches += 1
            n_games = insert_games(match_uuid, m["id"])
            total_games += n_games
            print(f"    + {m['date']} {' vs '.join(t.get('code','?') for t in m['teams'])}: {n_games} games")
            time.sleep(0.3)

        if new_in_tour == 0:
            print(f"    (all already in DB)")

    print(f"\n{'='*60}")
    print(f"SCANNED: {total_matches} KC matches across all tournaments")
    print(f"NEW: {total_new_matches} matches added to DB")
    print(f"GAMES: {total_games} games inserted")


if __name__ == "__main__":
    main()
