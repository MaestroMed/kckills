"""
Batch analyze published kills missing AI description.
Uses text-only Gemini analysis (no video upload = faster + saves quota).
"""
import asyncio
import json
import os
import sys
import httpx
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from config import config
from scheduler import scheduler
from modules.analyzer import analyze_kill_row

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def fetch_kills_missing_ai():
    """Get published kills without ai_description."""
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/kills"
        "?status=eq.published&ai_description=is.null"
        "&select=id,killer_champion,victim_champion,killer_player_id,victim_player_id,"
        "is_first_blood,multi_kill,tracked_team_involvement,assistants,"
        "confidence,shutdown_bounty,game_time_seconds",
        headers=HEADERS,
    )
    r.raise_for_status()
    return r.json()


def fetch_player_names():
    """Get player IGN lookup."""
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/players?select=id,ign",
        headers=HEADERS,
    )
    r.raise_for_status()
    return {p["id"]: p["ign"] for p in r.json()}


def patch_kill(kill_id: str, patch: dict):
    """Update kill in Supabase."""
    r = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/kills?id=eq.{kill_id}",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=patch,
    )
    r.raise_for_status()


async def main():
    kills = fetch_kills_missing_ai()
    print(f"Kills missing AI description: {len(kills)}")
    if not kills:
        print("Nothing to do!")
        return

    players = fetch_player_names()
    done = 0
    errors = 0

    for i, kill in enumerate(kills):
        # Enrich with player names
        kill["_killer_name_hint"] = players.get(kill.get("killer_player_id"), "?")
        kill["_victim_name_hint"] = players.get(kill.get("victim_player_id"), "?")

        result = await analyze_kill_row(kill, clip_path=None)  # text-only
        if not result:
            errors += 1
            print(f"  [{i+1}/{len(kills)}] FAIL {kill['id'][:8]} {kill.get('killer_champion','?')}->{kill.get('victim_champion','?')}")
            continue

        patch = {}
        if result.get("highlight_score") is not None:
            patch["highlight_score"] = float(result["highlight_score"])
        if result.get("tags"):
            patch["ai_tags"] = result["tags"]
        if result.get("description_fr"):
            patch["ai_description"] = result["description_fr"]
        if result.get("kill_visible_on_screen") is not None:
            patch["kill_visible"] = bool(result["kill_visible_on_screen"])
        if result.get("caster_hype_level") is not None:
            patch["caster_hype_level"] = int(result["caster_hype_level"])

        if patch:
            patch_kill(kill["id"], patch)
            done += 1
            desc = (result.get("description_fr") or "")[:60]
            print(f"  [{i+1}/{len(kills)}] OK {kill['id'][:8]} score={result.get('highlight_score')} {desc}")

    print(f"\nDone: {done} analyzed, {errors} failed")


if __name__ == "__main__":
    asyncio.run(main())
