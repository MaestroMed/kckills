"""Check why specific games are failing — look at their VOD data.

Usage:  python check_games.py
"""

from __future__ import annotations

import json
import os
import urllib.request
from collections import Counter

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def get_json(url: str) -> list[dict]:
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main() -> None:
    # Get all clip_error kills with game info
    url = (
        f"{SUPABASE_URL}/rest/v1/kills"
        "?select=game_id,retry_count"
        "&status=eq.clip_error"
        "&order=updated_at.desc"
        "&limit=200"
    )
    err_kills = get_json(url)
    print(f"\n=== {len(err_kills)} clip_error kills ===\n")

    # Count unique games
    game_counter: Counter[str] = Counter()
    for k in err_kills:
        game_counter[k["game_id"]] += 1
    print(f"Across {len(game_counter)} distinct games\n")

    # Get VOD info for top error games
    top_games = [g for g, _ in game_counter.most_common(10)]
    if top_games:
        ids = ",".join(top_games)
        url = (
            f"{SUPABASE_URL}/rest/v1/games"
            "?select=id,external_id,vod_youtube_id,vod_offset_seconds,alt_vod_youtube_id,patch,kills_extracted"
            f"&id=in.({ids})"
        )
        games = get_json(url)
        print("Top 10 games with errors:\n")
        for g in games:
            err_count = game_counter.get(g["id"], 0)
            vod = g.get("vod_youtube_id") or "NULL"
            offset = g.get("vod_offset_seconds")
            alt = g.get("alt_vod_youtube_id")
            print(
                f"  {g['id'][:8]}  {err_count:>2} errors  "
                f"ext={(g.get('external_id') or '?')[:30]:<30}  "
                f"vod={vod:<15}  offset={offset}  "
                f"{'(has_alt)' if alt else ''}"
            )

    # Summary: how many games lack a vod entirely?
    no_vod_games = [g for g in games if not g.get("vod_youtube_id")]
    if no_vod_games:
        print(f"\n⚠ {len(no_vod_games)}/{len(games)} games have NULL vod_youtube_id")
        print("  → these should be marked status='no_vod', not 'clip_error'")


if __name__ == "__main__":
    main()
