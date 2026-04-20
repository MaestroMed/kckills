"""Add games to all matches that have 0 games."""
import os, sys, time, httpx
from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from services.supabase_client import safe_select, safe_insert

API = "https://esports-api.lolesports.com/persisted/gw"
KEY = os.environ.get("LOL_ESPORTS_API_KEY", "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z")
HEADERS = {"x-api-key": KEY}

# Get all matches
matches = safe_select("matches", "id,external_id,scheduled_at") or []
print(f"Total matches in DB: {len(matches)}")

# Get all games (to skip duplicates)
existing_games = safe_select("games", "external_id,match_id") or []
games_by_match = {}
for g in existing_games:
    games_by_match.setdefault(g["match_id"], set()).add(g["external_id"])

matches_with_games = sum(1 for m in matches if m["id"] in games_by_match)
print(f"Matches with games: {matches_with_games}")
print(f"Matches WITHOUT games: {len(matches) - matches_with_games}\n")

added_total = 0
no_data = 0
for m in matches:
    mid_db = m["id"]
    ext_id = m["external_id"]
    existing = games_by_match.get(mid_db, set())

    try:
        r = httpx.get(f"{API}/getEventDetails", params={"hl": "fr-FR", "id": ext_id},
                      headers=HEADERS, timeout=15)
        data = r.json()
    except Exception as e:
        no_data += 1
        continue

    event = data.get("data", {}).get("event")
    if not event:
        no_data += 1
        continue

    games = event.get("match", {}).get("games", [])
    if not games:
        no_data += 1
        continue

    inserted = 0
    for g in games:
        gid = g.get("id")
        if not gid or gid in existing:
            continue

        # VOD info
        vods = g.get("vods", [])
        vod_youtube_id = None
        vod_offset = 0
        fr_vod = next((v for v in vods if v.get("locale") == "fr-FR"), None)
        en_vod = next((v for v in vods if v.get("locale") == "en-US"), None)
        chosen = fr_vod or en_vod or (vods[0] if vods else None)
        if chosen and chosen.get("provider") == "youtube":
            vod_youtube_id = chosen.get("parameter")
            vod_offset = chosen.get("offset") or 0

        try:
            safe_insert("games", {
                "external_id": gid,
                "match_id": mid_db,
                "game_number": g.get("number", 1),
                "vod_youtube_id": vod_youtube_id,
                "vod_offset_seconds": vod_offset,
                "kills_extracted": False,
                "state": "completed",
            })
            inserted += 1
        except Exception:
            pass

    if inserted > 0:
        added_total += inserted
        date = (m.get("scheduled_at") or "?")[:10]
        print(f"  + {date} match {ext_id}: {inserted} games (vod={vod_youtube_id or 'none'})")
    time.sleep(0.3)

print(f"\nTOTAL added: {added_total} games")
print(f"Matches without API data: {no_data}")
