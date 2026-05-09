"""
Deep QC: download 10 clips, send to Gemini for editorial quality check.
Not just "is it gameplay" but: is the kill visible? is the timing right? is it a good clip?
"""
import asyncio
import json
import os
import random
import sys
import httpx

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

from scheduler import scheduler
scheduler.DELAYS["gemini"] = 4.0
from config import config

import structlog
structlog.configure(processors=[
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
QC_DIR = os.path.join(os.path.dirname(__file__), "deep_qc")


async def deep_qc_clip(clip_url: str, kill_info: dict) -> dict:
    """Download clip, send to Gemini for deep editorial QC."""
    os.makedirs(QC_DIR, exist_ok=True)
    kid = kill_info["id"][:8]
    local_path = os.path.join(QC_DIR, f"{kid}.mp4")

    # Download clip
    try:
        with httpx.stream("GET", clip_url, follow_redirects=True, timeout=30) as r:
            r.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    except Exception as e:
        return {"id": kid, "error": f"download_failed: {e}"}

    # Send to Gemini
    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        return {"id": kid, "error": "gemini_quota"}

    try:
        # Wave 13f migration — moved off `google.generativeai`
        # (deprecated) onto `google.genai`.
        from services.gemini_client import get_client, _wait_for_file_active
        from google.genai import types
        client = get_client()
        if client is None:
            return {"id": kid, "error": "gemini_sdk_missing"}

        # Wave 27.14 — Wave 27.1 regression fix.
        video_file = await asyncio.to_thread(
            client.files.upload,
            file=local_path,
            config=types.UploadFileConfig(mime_type="video/mp4"),
        )
        if not await _wait_for_file_active(client, video_file, timeout=60):
            return {"id": kid, "error": "gemini_file_not_active"}

        killer = kill_info.get("killer_champion", "?")
        victim = kill_info.get("victim_champion", "?")
        gt = kill_info.get("game_time_seconds", 0) or 0

        prompt = f"""Analyse ce clip d'un match pro League of Legends.
Ce clip est censé montrer un kill: {killer} tue {victim} vers le game time {gt//60}:{gt%60:02d}.

Réponds UNIQUEMENT en JSON valide:
{{
  "is_gameplay": true/false,
  "kill_visible": true/false,
  "kill_moment_timing": "too_early|good|too_late|not_visible",
  "what_is_shown": "<description courte de ce qu'on voit réellement>",
  "clip_quality": 1-10,
  "issues": ["<liste des problemes>"],
  "verdict": "GOOD|ACCEPTABLE|BAD"
}}

Critères:
- is_gameplay: est-ce du gameplay LoL en jeu (pas analyst desk, pas champion select, pas scoreboard)
- kill_visible: voit-on RÉELLEMENT le champion {killer} tuer {victim} à l'écran?
- kill_moment_timing: le moment du kill est-il bien centré dans le clip?
  - "good" = le kill arrive entre 30% et 70% du clip
  - "too_early" = le kill arrive dans les premières secondes
  - "too_late" = le kill arrive dans les dernières secondes ou après la fin
  - "not_visible" = on ne voit pas le kill
- clip_quality: 1=inutilisable, 5=passable, 8=bon, 10=parfait highlight
- issues: problèmes spécifiques (ex: "camera shows wrong area", "kill happens off-screen", "replay not live gameplay")
- verdict: GOOD (publishable as-is), ACCEPTABLE (watchable but not ideal), BAD (needs fix or removal)
"""

        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=[prompt, video_file],
        )
        text = (response.text or "").strip()

        # Strip code fences
        if text.startswith("```"):
            parts = text.split("```")
            if len(parts) >= 2:
                inner = parts[1]
                if inner.startswith("json"):
                    inner = inner[4:]
                text = inner.strip()

        result = json.loads(text)
        result["id"] = kid
        result["kill"] = f"{killer} -> {victim}"
        result["game_time"] = f"{gt//60}:{gt%60:02d}"
        return result

    except json.JSONDecodeError:
        return {"id": kid, "error": f"invalid_json: {text[:100]}"}
    except Exception as e:
        return {"id": kid, "error": str(e)[:100]}
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


async def main():
    # Get calibrated KC kills
    with open("vod_time_maps.json") as f:
        maps = json.load(f)
    calibrated_game_ids = list(maps.keys())

    r = httpx.get(SUPABASE_URL + "/rest/v1/kills", params={
        "status": "eq.published",
        "tracked_team_involvement": "eq.team_killer",
        "select": "id,killer_champion,victim_champion,clip_url_vertical,game_time_seconds,highlight_score,multi_kill,is_first_blood,game_id"
    }, headers=HEADERS)
    kills = r.json()
    calibrated = [k for k in kills if k["game_id"] in calibrated_game_ids]

    print(f"Calibrated KC kills: {len(calibrated)}")
    sample = random.sample(calibrated, min(10, len(calibrated)))

    results = []
    for i, k in enumerate(sample):
        print(f"\n[{i+1}/10] {k['killer_champion']} -> {k['victim_champion']} (T={k.get('game_time_seconds',0)//60}:{k.get('game_time_seconds',0)%60:02d})")
        result = await deep_qc_clip(k["clip_url_vertical"], k)
        results.append(result)

        if "error" in result:
            print(f"  ERROR: {result['error']}")
        else:
            v = result.get("verdict", "?")
            tag = "[OK]" if v == "GOOD" else "[MEH]" if v == "ACCEPTABLE" else "[BAD]"
            print(f"  {tag} {v} | kill_visible={result.get('kill_visible')} | timing={result.get('kill_moment_timing')} | quality={result.get('clip_quality')}/10")
            print(f"  What's shown: {result.get('what_is_shown', '?')}")
            if result.get("issues"):
                print(f"  Issues: {', '.join(result['issues'])}")

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    good = sum(1 for r in results if r.get("verdict") == "GOOD")
    acceptable = sum(1 for r in results if r.get("verdict") == "ACCEPTABLE")
    bad = sum(1 for r in results if r.get("verdict") == "BAD")
    errors = sum(1 for r in results if "error" in r)
    visible = sum(1 for r in results if r.get("kill_visible") == True)
    print(f"GOOD: {good} | ACCEPTABLE: {acceptable} | BAD: {bad} | ERRORS: {errors}")
    print(f"Kill visible: {visible}/{len(results) - errors}")
    avg_quality = sum(r.get("clip_quality", 0) for r in results if "error" not in r) / max(1, len(results) - errors)
    print(f"Avg quality: {avg_quality:.1f}/10")

    # Save results
    with open(os.path.join(QC_DIR, "deep_qc_results.json"), "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nResults saved to {QC_DIR}/deep_qc_results.json")


if __name__ == "__main__":
    asyncio.run(main())
