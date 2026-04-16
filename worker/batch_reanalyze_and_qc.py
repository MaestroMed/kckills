"""
BATCH RE-ANALYZE + QC

For each published kill:
1. Determine if it's really a solo kill from DATA (confidence + cluster analysis)
2. Re-generate AI description with correct context (no more fake "solo kill")
3. Download the clip and QC with Gemini: is the kill visible?
4. Update kill_visible in DB

One Gemini call per kill: video + corrected context → description + QC in one shot.
"""
import asyncio
import json
import os
import re
import sys
import httpx
from collections import defaultdict

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(__file__))

from scheduler import scheduler
scheduler.DELAYS["gemini"] = 4.0

from config import config
from services.supabase_client import safe_update

import structlog
structlog.configure(processors=[
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

QC_DIR = os.path.join(os.path.dirname(__file__), "qc_clips")


def load_env():
    with open(os.path.join(os.path.dirname(__file__), ".env")) as f:
        return dict(l.strip().split("=", 1) for l in f if "=" in l and not l.startswith("#"))


def fetch_all_kills(env):
    url, key = env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    r = httpx.get(url + "/rest/v1/kills", params={
        "status": "eq.published",
        "select": "id,game_id,game_time_seconds,killer_champion,victim_champion,"
                  "killer_player_id,victim_player_id,confidence,assistants,"
                  "multi_kill,is_first_blood,tracked_team_involvement,shutdown_bounty,"
                  "clip_url_vertical,highlight_score,ai_description,kill_visible",
    }, headers=h)
    return r.json()


def fetch_players(env):
    url, key = env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    r = httpx.get(url + "/rest/v1/players?select=id,ign", headers=h)
    return {p["id"]: p["ign"] for p in r.json()}


def classify_kill_type(kill, all_kills):
    """Determine kill type from DATA, not guessing."""
    gt = kill.get("game_time_seconds", 0) or 0
    gid = kill["game_id"]
    conf = kill.get("confidence", "high")

    # Find kills at same game_time in same game (= teamfight cluster)
    cluster = [k for k in all_kills
               if k["game_id"] == gid
               and abs((k.get("game_time_seconds", 0) or 0) - gt) <= 10
               and k["id"] != kill["id"]]

    if len(cluster) >= 3:
        return "teamfight", len(cluster) + 1
    elif len(cluster) >= 1:
        return "skirmish", len(cluster) + 1
    elif conf == "medium":
        return "skirmish", 1  # medium conf = harvester detected multiple changes
    else:
        return "solo_kill", 1


async def analyze_and_qc(kill: dict, kill_type: str, cluster_size: int,
                          killer_name: str, victim_name: str) -> dict | None:
    """One Gemini call: re-describe + QC kill visibility from clip."""
    clip_url = kill.get("clip_url_vertical")
    if not clip_url:
        return None

    os.makedirs(QC_DIR, exist_ok=True)
    kid = kill["id"][:8]
    local_path = os.path.join(QC_DIR, f"{kid}.mp4")

    # Download clip
    try:
        with httpx.stream("GET", clip_url, follow_redirects=True, timeout=30) as r:
            r.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    except Exception as e:
        return {"error": f"download: {e}"}

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        return {"error": "gemini_quota"}

    try:
        import google.generativeai as genai
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash-lite")

        video_file = genai.upload_file(local_path)
        from services.gemini_client import _wait_for_file_active
        _wait_for_file_active(genai, video_file, timeout=60)

        killer = kill.get("killer_champion", "?")
        victim = kill.get("victim_champion", "?")
        gt = kill.get("game_time_seconds", 0) or 0
        multi = kill.get("multi_kill")
        fb = kill.get("is_first_blood", False)

        # Build FACTUAL context
        context_parts = []
        if fb:
            context_parts.append("FIRST BLOOD")
        if multi:
            context_parts.append(f"{multi.upper()} KILL")
        if kill_type == "solo_kill":
            context_parts.append("Vrai solo kill 1v1 (aucun autre kill dans les 10 secondes)")
        elif kill_type == "skirmish":
            context_parts.append(f"Skirmish/fight ({cluster_size} kills proches)")
        elif kill_type == "teamfight":
            context_parts.append(f"TEAMFIGHT ({cluster_size} kills dans les 10 secondes)")

        involvement = kill.get("tracked_team_involvement", "")
        if involvement == "team_killer":
            context_parts.append(f"{killer_name} (KC) tue {victim_name}")
        elif involvement == "team_victim":
            context_parts.append(f"{killer_name} tue {victim_name} (KC)")

        context = ". ".join(context_parts)

        prompt = f"""Analyse ce clip de match pro League of Legends.
Kill: {killer} ({killer_name}) tue {victim} ({victim_name}) vers T={gt//60}:{gt%60:02d}.
Contexte factuel: {context}

Reponds UNIQUEMENT en JSON valide:
{{
    "highlight_score": <float 1.0-10.0>,
    "tags": [<max 5 parmi: "outplay","teamfight","solo_kill","tower_dive",
              "baron_fight","dragon_fight","flash_predict","1v2","1v3",
              "clutch","clean","mechanical","shutdown","comeback",
              "engage","peel","snipe","steal","skirmish">],
    "description_fr": "<max 120 chars, style commentateur hype>",
    "kill_visible": <bool - voit-on REELLEMENT le kill a l'ecran?>,
    "caster_hype_level": <int 1-5>,
    "clip_verdict": "GOOD|ACCEPTABLE|BAD"
}}

REGLES CRITIQUES:
- NE DIS PAS "solo kill" ou "1v1" si le contexte dit "teamfight" ou "skirmish"
- kill_visible = true SEULEMENT si on voit clairement {killer} eliminer {victim}
- Si la camera montre une autre zone de la map pendant le kill: kill_visible = false
- clip_verdict: GOOD = kill visible et bien cadre, ACCEPTABLE = gameplay visible mais kill pas clair, BAD = kill pas visible du tout
- description_fr: base-toi sur CE QUE TU VOIS dans le clip, pas sur le contexte
- JSON VALIDE uniquement
"""

        response = model.generate_content([prompt, video_file])
        text = (response.text or "").strip()

        if text.startswith("```"):
            parts = text.split("```")
            if len(parts) >= 2:
                inner = parts[1]
                if inner.startswith("json"):
                    inner = inner[4:]
                text = inner.strip()

        return json.loads(text)

    except json.JSONDecodeError:
        return {"error": f"bad_json: {text[:80]}"}
    except Exception as e:
        return {"error": str(e)[:80]}
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


async def main():
    env = load_env()
    all_kills = fetch_all_kills(env)
    players = fetch_players(env)

    # Only KC kills
    kc_kills = [k for k in all_kills if k.get("tracked_team_involvement") == "team_killer"]
    print(f"Total KC kills to re-analyze + QC: {len(kc_kills)}")

    done = 0
    good = 0
    acceptable = 0
    bad = 0
    errors = 0

    for i, kill in enumerate(kc_kills):
        kill_type, cluster_size = classify_kill_type(kill, all_kills)
        killer_name = players.get(kill.get("killer_player_id"), "KC")
        victim_name = players.get(kill.get("victim_player_id"), "Opponent")

        result = await analyze_and_qc(kill, kill_type, cluster_size, killer_name, victim_name)

        if not result or "error" in result:
            errors += 1
            err = result.get("error", "unknown") if result else "none"
            print(f"  [{i+1}/{len(kc_kills)}] ERR {kill['id'][:8]} {err}")
            if "quota" in str(err):
                print("  QUOTA HIT - stopping")
                break
            continue

        # Update DB
        patch = {}
        if result.get("highlight_score") is not None:
            patch["highlight_score"] = float(result["highlight_score"])
        if result.get("tags"):
            patch["ai_tags"] = result["tags"]
        if result.get("description_fr"):
            patch["ai_description"] = result["description_fr"]
        if result.get("kill_visible") is not None:
            patch["kill_visible"] = bool(result["kill_visible"])
        if result.get("caster_hype_level") is not None:
            patch["caster_hype_level"] = int(result["caster_hype_level"])

        if patch:
            safe_update("kills", patch, "id", kill["id"])

        verdict = result.get("clip_verdict", "?")
        visible = result.get("kill_visible", False)
        desc = (result.get("description_fr") or "")[:60]

        if verdict == "GOOD":
            good += 1
        elif verdict == "ACCEPTABLE":
            acceptable += 1
        else:
            bad += 1
        done += 1

        tag = "[OK]" if verdict == "GOOD" else "[MEH]" if verdict == "ACCEPTABLE" else "[BAD]"
        vis = "VIS" if visible else "---"
        print(f"  [{i+1}/{len(kc_kills)}] {tag} {vis} {kill['id'][:8]} {kill_type:>10} {desc}")

    print(f"\n{'='*60}")
    print(f"DONE: {done} analyzed, {errors} errors")
    print(f"GOOD: {good} | ACCEPTABLE: {acceptable} | BAD: {bad}")
    print(f"Kill visible: {good + acceptable}/{done} ({(good+acceptable)*100//max(1,done)}%)")


if __name__ == "__main__":
    asyncio.run(main())
