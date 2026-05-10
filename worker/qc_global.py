"""qc_global — Wave 27.27

Run a Gemini-based deep QC pass on EVERY published KC kill clip.
Writes back to DB :
  * BAD verdict     -> needs_reclip = TRUE  (so the next clipper run
                       can re-source from KC Replay, or admin reviews)
  * kill_visible    -> updated to Gemini's actual visibility check
                       (catches clips where the legacy analyzer's
                       Wave 27.1-regression false-passed the gate)
  * Audit JSON       -> deep_qc/qc_global_results_<ts>.json with the
                       full Gemini response for each clip

Usage :
    python qc_global.py            # all published KC-killer clips
    python qc_global.py --limit 50 # truncate for smoke testing
    python qc_global.py --kc-only  # only KC-killer (default)
    python qc_global.py --all      # also QC the team_victim clips
    python qc_global.py --resume   # skip clips that already have a
                                     QC entry in the latest results JSON

Cost : ~$0.012/call x 1194 clips = ~$14.30 (Gemini Flash-Lite 3.1).
Runtime : ~30-50 min with 4 parallel workers + 4s scheduler delay.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import httpx

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

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

QC_DIR = Path(__file__).parent / "deep_qc"
QC_DIR.mkdir(exist_ok=True)
RESULTS_FILE = QC_DIR / f"qc_global_results_{int(time.time())}.json"
PROGRESS_FILE = QC_DIR / "qc_global_in_progress.json"


# ─── Gemini call ──────────────────────────────────────────────────────

async def qc_one_clip(clip_url: str, kill_info: dict) -> dict:
    """Download + Gemini QC one clip. Returns {verdict, issues, ...} or {error}."""
    kid = kill_info["id"]
    short = kid[:8]
    local_path = QC_DIR / f"qc_{short}.mp4"

    # Download
    try:
        with httpx.stream("GET", clip_url, follow_redirects=True, timeout=30) as r:
            r.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    except Exception as e:
        return {"id": kid, "error": f"download_failed: {str(e)[:80]}"}

    # Gemini
    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        if local_path.exists(): local_path.unlink()
        return {"id": kid, "error": "gemini_quota"}

    try:
        from services.gemini_client import get_client, _wait_for_file_active
        from google.genai import types
        client = get_client()
        if client is None:
            return {"id": kid, "error": "gemini_sdk_missing"}

        # Wave 27.14 fix path
        video_file = await asyncio.to_thread(
            client.files.upload,
            file=str(local_path),
            config=types.UploadFileConfig(mime_type="video/mp4"),
        )
        if not await _wait_for_file_active(client, video_file, timeout=60):
            return {"id": kid, "error": "gemini_file_not_active"}

        killer = kill_info.get("killer_champion") or "?"
        victim = kill_info.get("victim_champion") or "?"
        gt = kill_info.get("game_time_seconds") or 0
        team_inv = kill_info.get("tracked_team_involvement") or "?"

        prompt = f"""Analyse ce clip d'un match pro League of Legends.
Contexte BDD : {killer} (KC = {team_inv == 'team_killer'}) tue {victim} vers le game time {gt//60}:{gt%60:02d}.

Reponds UNIQUEMENT en JSON valide :
{{
  "is_gameplay": true/false,
  "kill_visible": true/false,
  "kill_moment_timing": "too_early|good|too_late|not_visible",
  "what_is_shown": "<description courte de ce qu'on voit reellement>",
  "clip_quality": 1-10,
  "audio_present": true/false,
  "issues": ["<liste des problemes>"],
  "verdict": "GOOD|ACCEPTABLE|BAD"
}}

Criteres :
- is_gameplay : gameplay LoL en jeu (pas analyst desk, pas champion select, pas scoreboard)
- kill_visible : voit-on REELLEMENT le champion {killer} tuer {victim} a l'ecran ?
- kill_moment_timing : le moment du kill est-il bien centre dans le clip ?
  * "good" = kill entre 30% et 70% du clip
  * "too_early" = dans les premieres secondes
  * "too_late" = dans les dernieres secondes
  * "not_visible" = pas de kill identifiable
- clip_quality : 1=inutilisable, 5=passable, 8=bon, 10=parfait highlight
- audio_present : il y a du son (commentateur, jeu) ?
- issues : problemes specifiques (camera mauvaise zone, kill hors-champ, replay au lieu de live, son coupe, encoding glitch, etc.)
- verdict :
  * GOOD = publishable tel quel (clean kill bien cadre)
  * ACCEPTABLE = visible mais sous-optimal (timing decale, qualite passable)
  * BAD = a re-clipper ou retirer (kill invisible, mauvaise scene, replay menu, etc.)
"""

        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-3.1-flash-lite",
            contents=[prompt, video_file],
        )
        text = (response.text or "").strip()
        # Strip fences
        if text.startswith("```"):
            parts = text.split("```")
            if len(parts) >= 2:
                inner = parts[1]
                if inner.startswith("json"):
                    inner = inner[4:]
                text = inner.strip()

        result = json.loads(text)
        result["id"] = kid
        result["killer"] = killer
        result["victim"] = victim
        result["game_time_s"] = gt
        result["legacy_kill_visible"] = kill_info.get("kill_visible")
        return result

    except json.JSONDecodeError:
        return {"id": kid, "error": f"invalid_json: {text[:80]}"}
    except Exception as e:
        return {"id": kid, "error": str(e)[:120]}
    finally:
        if local_path.exists():
            try:
                local_path.unlink()
            except Exception:
                pass


# ─── Persistence ──────────────────────────────────────────────────────

def write_back_to_db(result: dict) -> bool:
    """Apply QC result to DB. Returns True if any update happened."""
    if "error" in result:
        return False

    kid = result["id"]
    patch = {}

    # Update kill_visible if Gemini's view differs from current DB
    new_visible = result.get("kill_visible")
    if isinstance(new_visible, bool) and new_visible != result.get("legacy_kill_visible"):
        patch["kill_visible"] = new_visible

    # Flag BAD clips for re-clipping from KC Replay (when source available)
    if result.get("verdict") == "BAD":
        patch["needs_reclip"] = True

    if not patch:
        return False

    safe_update("kills", patch, "id", kid)
    return True


# ─── Main ─────────────────────────────────────────────────────────────

def fetch_published_kills(kc_only: bool = True, limit: int | None = None) -> list[dict]:
    """Pull all published kills with a clip URL."""
    params: dict = {
        "status": "eq.published",
        "select": "id,killer_champion,victim_champion,clip_url_vertical,"
                  "game_time_seconds,highlight_score,multi_kill,is_first_blood,"
                  "tracked_team_involvement,kill_visible,needs_reclip",
        "clip_url_vertical": "not.is.null",
        "order": "highlight_score.desc.nullslast",
    }
    if kc_only:
        params["tracked_team_involvement"] = "eq.team_killer"
    if limit:
        params["limit"] = str(limit)
    r = httpx.get(SUPABASE_URL + "/rest/v1/kills", params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json() or []


def load_resume_set() -> set[str]:
    """Load already-processed kill IDs from any prior qc_global_results_*.json."""
    done = set()
    for f in QC_DIR.glob("qc_global_results_*.json"):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                for entry in json.load(fh):
                    if "error" not in entry and entry.get("id"):
                        done.add(entry["id"])
        except Exception:
            continue
    return done


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Cap clips processed")
    parser.add_argument("--all", action="store_true", help="Include team_victim clips too")
    parser.add_argument("--resume", action="store_true", help="Skip already-QC'd clips")
    parser.add_argument("--no-write", action="store_true", help="Don't update DB, just write JSON")
    args = parser.parse_args()

    kills = fetch_published_kills(kc_only=not args.all, limit=args.limit)
    if args.resume:
        done = load_resume_set()
        before = len(kills)
        kills = [k for k in kills if k["id"] not in done]
        print(f"Resume mode : skipping {before - len(kills)} already-QC'd clips")

    print(f"=== QC Global ===")
    print(f"  Clips to process : {len(kills)}")
    print(f"  KC-killer only   : {not args.all}")
    print(f"  Output           : {RESULTS_FILE}")
    print(f"  Write to DB      : {not args.no_write}")
    print()

    if not kills:
        print("Nothing to do.")
        return

    results: list[dict] = []
    db_updates = 0
    counts = {"GOOD": 0, "ACCEPTABLE": 0, "BAD": 0, "ERROR": 0}
    started = time.time()

    for i, k in enumerate(kills):
        result = await qc_one_clip(k["clip_url_vertical"], k)
        results.append(result)
        if "error" in result:
            counts["ERROR"] += 1
            tag = "ERR "
            extra = result["error"][:60]
        else:
            v = result.get("verdict", "?")
            counts[v] = counts.get(v, 0) + 1
            tag = {"GOOD": "OK  ", "ACCEPTABLE": "MEH ", "BAD": "BAD "}.get(v, "??? ")
            extra = f"vis={result.get('kill_visible')} q={result.get('clip_quality')}"

        # Write back
        if not args.no_write:
            if write_back_to_db(result):
                db_updates += 1

        # Progress
        elapsed = time.time() - started
        rate = (i + 1) / elapsed if elapsed > 0 else 0
        eta = (len(kills) - (i + 1)) / rate if rate > 0 else 0
        if (i + 1) % 10 == 0 or (i + 1) == len(kills):
            print(f"  [{i+1:4}/{len(kills)}] {tag} {result['id'][:8]} {(k.get('killer_champion') or '?'):>10} -> {(k.get('victim_champion') or '?'):>10} | {extra} | rate={rate:.1f}/s eta={eta/60:.0f}min")

        # Snapshot intermediate progress every 50 clips
        if (i + 1) % 50 == 0:
            with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, ensure_ascii=False)

    # Final save
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()

    print(f"\n{'='*60}")
    print("QC GLOBAL SUMMARY")
    print(f"{'='*60}")
    print(f"  Total processed : {len(results)}")
    print(f"  GOOD            : {counts['GOOD']:4}  ({100*counts['GOOD']/max(1,len(results)):.1f}%)")
    print(f"  ACCEPTABLE      : {counts['ACCEPTABLE']:4}  ({100*counts['ACCEPTABLE']/max(1,len(results)):.1f}%)")
    print(f"  BAD             : {counts['BAD']:4}  ({100*counts['BAD']/max(1,len(results)):.1f}%)")
    print(f"  Errors          : {counts['ERROR']:4}")
    print(f"  DB updates      : {db_updates}")
    elapsed_min = (time.time() - started) / 60
    print(f"  Runtime         : {elapsed_min:.1f} min")
    print(f"  Results saved   : {RESULTS_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
