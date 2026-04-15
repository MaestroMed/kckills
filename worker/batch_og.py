"""
Batch generate OG images for published kills missing og_image_url.
"""
import asyncio
import os
import sys
import httpx
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from config import config
from modules.og_generator import generate_og_image
from services.r2_client import upload_og

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


def fetch_kills_missing_og():
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/kills"
        "?status=eq.published&og_image_url=is.null"
        "&select=id,killer_champion,victim_champion,killer_player_id,victim_player_id,"
        "ai_description,avg_rating,rating_count,multi_kill",
        headers=HEADERS,
    )
    r.raise_for_status()
    return r.json()


def fetch_player_names():
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/players?select=id,ign",
        headers=HEADERS,
    )
    r.raise_for_status()
    return {p["id"]: p["ign"] for p in r.json()}


def patch_kill(kill_id: str, patch: dict):
    r = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/kills?id=eq.{kill_id}",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=patch,
    )
    r.raise_for_status()


async def main():
    kills = fetch_kills_missing_og()
    print(f"Kills missing OG image: {len(kills)}")
    if not kills:
        print("Nothing to do!")
        return

    players = fetch_player_names()
    done = 0
    errors = 0

    for i, kill in enumerate(kills):
        killer_name = players.get(kill.get("killer_player_id"), "KC")
        victim_name = players.get(kill.get("victim_player_id"), "Opponent")

        local_path = generate_og_image(
            kill_id=kill["id"],
            killer_name=killer_name,
            killer_champion=kill.get("killer_champion") or "?",
            victim_name=victim_name,
            victim_champion=kill.get("victim_champion") or "?",
            description=kill.get("ai_description") or "",
            rating=float(kill.get("avg_rating") or 0),
            rating_count=int(kill.get("rating_count") or 0),
            multi_kill=kill.get("multi_kill"),
        )
        if not local_path:
            errors += 1
            print(f"  [{i+1}/{len(kills)}] FAIL {kill['id'][:8]}")
            continue

        og_url = await upload_og(kill["id"], local_path)
        if og_url:
            patch_kill(kill["id"], {"og_image_url": og_url})
            done += 1
            print(f"  [{i+1}/{len(kills)}] OK {kill['id'][:8]} {killer_name} -> {victim_name}")
        else:
            errors += 1
            print(f"  [{i+1}/{len(kills)}] UPLOAD_FAIL {kill['id'][:8]}")

        try:
            os.remove(local_path)
        except Exception:
            pass

    print(f"\nDone: {done} generated, {errors} failed")


if __name__ == "__main__":
    asyncio.run(main())
