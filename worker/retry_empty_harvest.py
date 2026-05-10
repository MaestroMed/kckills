"""retry_empty_harvest — Wave 27.29

Reset `kills_extracted = FALSE` on games that are marked extracted but
have ZERO kills attached. The next harvester cycle will pick them up
and re-fetch the live stats feed.

Heuristic for picking targets :
  * kills_extracted = TRUE  (harvester DID run)
  * 0 kills attached to game_id
  * state IN ('vod_found', 'clipping', 'analyzed', 'published')
    — we keep 'raw' games out because those are still in early
    pipeline stages and the harvester will visit them naturally.

Probe phase (always run, dry-run by default) :
  for each empty game, GET feed.lolesports.com/livestats/v1/window/{gid}
  and report whether livestats returns 200 with frames. Games where
  livestats is unreachable get flagged 'no_data' so the operator knows
  re-extraction won't help.

Usage :
    python retry_empty_harvest.py            # dry-run probe
    python retry_empty_harvest.py --apply    # reset the flag (after
                                              # confirming livestats has data)
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

LIVESTATS_BASE = "https://feed.lolesports.com/livestats/v1"


def find_empty_games() -> list[dict[str, Any]]:
    """Games with kills_extracted=TRUE but 0 kills attached."""
    r = httpx.get(SUPABASE_URL + "/rest/v1/games", params={
        "select": "id,external_id,vod_youtube_id,alt_vod_youtube_id,state,match_id",
        "kills_extracted": "eq.true",
        "state": "in.(vod_found,clipping,analyzed,published)",
        "limit": "500",
    }, headers=HEADERS, timeout=30)
    r.raise_for_status()
    games = r.json() or []
    empty = []
    for g in games:
        rk = httpx.get(SUPABASE_URL + "/rest/v1/kills", params={
            "select": "id",
            "game_id": f"eq.{g['id']}",
            "limit": "1",
        }, headers={**HEADERS, "Prefer": "count=exact"}, timeout=15)
        cnt = int(rk.headers.get("content-range", "0/0").split("/")[-1])
        if cnt == 0:
            empty.append(g)
    return empty


def probe_livestats(esports_game_id: str) -> dict[str, Any]:
    """Quick probe : does Riot's livestats feed return data for this game ?"""
    url = f"{LIVESTATS_BASE}/window/{esports_game_id}"
    try:
        r = httpx.get(url, timeout=15, follow_redirects=True)
    except httpx.RequestError as e:
        return {"ok": False, "reason": f"request_error: {str(e)[:60]}"}
    if r.status_code != 200:
        return {"ok": False, "reason": f"http_{r.status_code}"}
    try:
        data = r.json()
    except Exception:
        return {"ok": False, "reason": "invalid_json"}
    if not isinstance(data, dict):
        return {"ok": False, "reason": "not_a_dict"}
    frames = data.get("frames") or []
    if not frames:
        return {"ok": False, "reason": "no_frames"}
    blue = (frames[-1].get("blueTeam") or {}).get("participants") or []
    red = (frames[-1].get("redTeam") or {}).get("participants") or []
    total_kills_blue = sum((p.get("kills") or 0) for p in blue)
    total_kills_red = sum((p.get("kills") or 0) for p in red)
    return {
        "ok": True,
        "frames": len(frames),
        "kills_in_window": total_kills_blue + total_kills_red,
    }


def reset_extracted(game_id: str) -> bool:
    r = httpx.patch(
        SUPABASE_URL + f"/rest/v1/games?id=eq.{game_id}",
        json={"kills_extracted": False},
        headers=HEADERS,
        timeout=15,
    )
    return r.status_code in (200, 204)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    print("Scanning for 'empty' games (extracted=TRUE + 0 kills)...")
    games = find_empty_games()
    print(f"  Found {len(games)} empty games\n")

    if not games:
        return

    # Probe livestats for each
    print(f"{'EXT_ID':<25}  STATE          LIVESTATS")
    print("-" * 80)
    resettable = []
    for g in games:
        probe = probe_livestats(g["external_id"])
        if probe["ok"]:
            tag = f"OK frames={probe['frames']} kills={probe['kills_in_window']}"
            resettable.append(g)
        else:
            tag = f"NO  ({probe['reason']})"
        print(f"  {g['external_id'][:25]:<25}  {g['state']:<14} {tag}")

    print()
    print(f"  Livestats has data : {len(resettable)} / {len(games)} games")

    if not args.apply:
        print("\n(dry-run; pass --apply to reset kills_extracted on the resettable games)")
        return

    print(f"\nResetting kills_extracted=FALSE on {len(resettable)} games...")
    ok = fail = 0
    for g in resettable:
        if reset_extracted(g["id"]):
            ok += 1
        else:
            fail += 1
    print(f"  OK={ok} FAIL={fail}")
    print()
    print("Next harvester cycle (default 600 s) will pick these up.")
    print("To run harvester immediately :")
    print("  .venv/Scripts/python.exe -m modules.harvester")


if __name__ == "__main__":
    main()
