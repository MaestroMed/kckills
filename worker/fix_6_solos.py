"""Fix 6 descriptions that wrongly say solo kill / 1v1."""
import asyncio, sys, os, httpx
sys.path.insert(0, os.path.dirname(__file__))
from scheduler import scheduler
scheduler.DELAYS["gemini"] = 4.0
from config import config

WRONG = ["6c2ec3d0", "648c9659"]

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

async def main():
    with open(os.path.join(os.path.dirname(__file__), ".env")) as f:
        env = dict(l.strip().split("=", 1) for l in f if "=" in l and not l.startswith("#"))
    url, key = env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    hp = {**h, "Content-Type": "application/json", "Prefer": "return=minimal"}

    r = httpx.get(url + "/rest/v1/kills", params={
        "status": "eq.published", "tracked_team_involvement": "eq.team_killer",
        "select": "id,killer_champion,victim_champion,fight_type,game_time_seconds,killer_player_id,victim_player_id"
    }, headers=h)
    all_kills = r.json()

    r2 = httpx.get(url + "/rest/v1/players?select=id,ign", headers=h)
    players = {p["id"]: p["ign"] for p in r2.json()}

    targets = [k for k in all_kills if any(k["id"].startswith(p) for p in WRONG)]
    print(f"Fixing {len(targets)} descriptions...")

    # Wave 13f migration — moved off `google.generativeai`
    # (deprecated) onto `google.genai`.
    from services.gemini_client import get_client
    client = get_client()
    if client is None:
        print("ERROR: google-genai not installed or GEMINI_API_KEY missing")
        return

    for k in targets:
        ft = k.get("fight_type", "?")
        killer = k.get("killer_champion", "?")
        victim = k.get("victim_champion", "?")
        kn = players.get(k.get("killer_player_id", ""), "KC")
        vn = players.get(k.get("victim_player_id", ""), "Opponent")
        gt = k.get("game_time_seconds", 0) or 0

        prompt = (
            f"Decris ce kill pro LoL en 1 phrase (80-120 chars, commentateur hype FR).\n"
            f"Killer: {killer} ({kn}) tue {victim} ({vn}) a T={gt//60}:{gt%60:02d}.\n"
            f"Type: {ft}.\n"
            f"INTERDIT: ne dis PAS solo kill, 1v1, ou zero assist. C'est un {ft}."
        )

        await scheduler.wait_for("gemini")
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
        )
        new_desc = (resp.text or "").strip().strip('"')

        httpx.patch(url + f"/rest/v1/kills?id=eq.{k['id']}", headers=hp, json={"ai_description": new_desc})
        print(f"  {k['id'][:8]} {ft:>15} | {new_desc[:80]}")

    print("Done.")

asyncio.run(main())
