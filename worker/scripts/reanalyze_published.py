# -*- coding: utf-8 -*-
"""
REANALYZE_PUBLISHED — vraie analyse Gemini pour les clips publiés qui n'en
ont jamais eu (ou dont le français a perdu ses accents).

Constat du 23/09/2026 : 2 149 clips publiés (un quart du catalogue)
affichaient « X elimine Y — analyse IA en attente, clip disponible. » : le
repli « degrade-publish » de l'analyzer pendant les pannes de quota d'avril
et de juillet. Ni score, ni tags, ni contrôle « kill visible », et le texte
provisoire jusque dans l'image de partage (OG). 242 autres descriptions
réelles étaient écrites sans accents (prompt v3 lui-même sans accents).

Pour chaque kill ciblé :
  1. clip R2 (horizontal) -> analyzer.analyze_kill_row (prompt v4 accentué,
     montée de gamme auto pour multi-kills / first bloods) ;
  2. mêmes champs que le pipeline (_build_analysis_patch : score, tags,
     descriptions FR/EN/KO/ES, vignette, kill_visible, qc_status…), sans
     needs_reclip (dérive peu fiable sans horloge du feed sur ces games) ;
  3. mêmes portes que event_mapper : visible + décrit -> reste publié ;
     kill invisible -> needs_review / hidden (le clip ne montre pas le kill) ;
     analyse vide -> kill laissé tel quel ;
  4. portes du game_event alignées ; image OG régénérée avec la description.

Budget : quota partagé du scheduler (950 appels, 10 $ / jour) + --max-usd.
Idempotent : un kill traité n'est plus ciblé.

Usage :
  python scripts/reanalyze_published.py --limit 5                 # essai
  python scripts/reanalyze_published.py --targets placeholders,unaccented --max-usd 6
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
import structlog  # noqa: E402

structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(colors=False),
])
log = structlog.get_logger()

from modules import analyzer, og_generator  # noqa: E402
from services import r2_client  # noqa: E402
from services.ai_pricing import compute_gemini_cost  # noqa: E402
from services.supabase_client import get_db, safe_update  # noqa: E402

PLACEHOLDER = "analyse IA en attente"
ACCENTED = re.compile(r"[éèêëàâäîïôöùûüçœÉÈÊÀÂÎÔÛÇ’']")
ASCII_FR = re.compile(r"\b(elimine|legendaire|equipe|deja|apres|tres|degats|ecrase|reussit|sacre|detruit|"
                      r"prepare|a la|l [a-z]|s [a-z]|d [a-z]|qu [a-z]|n [a-z]|c est)\b")
COLS = ("id,game_id,event_epoch,game_time_seconds,killer_champion,victim_champion,killer_player_id,"
        "victim_player_id,is_first_blood,multi_kill,tracked_team_involvement,fight_type,matchup_lane,"
        "lane_phase,kill_visible,assistants,shutdown_bounty,highlight_score,ai_description,"
        "clip_url_horizontal,clip_url_vertical,avg_rating,rating_count,created_at")
MIN_DESC = 50
REPORT = Path(r"D:\kckills_worker\reanalyze_published")


def fetch_targets(db, kinds: set[str]) -> list[dict]:
    client, rows, off = db._get_client(), [], 0
    while True:
        r = client.get(f"{db.base}/kills", params={"select": COLS, "publication_status": "eq.published",
                                                   "status": "eq.published", "limit": "1000",
                                                   "offset": str(off), "order": "id.asc"})
        r.raise_for_status()
        page = r.json() or []
        rows += page
        if len(page) < 1000:
            break
        off += 1000
    out = []
    for k in rows:
        d = k.get("ai_description") or ""
        if "placeholders" in kinds and PLACEHOLDER in d:
            out.append(k)
        elif "unaccented" in kinds and d and not ACCENTED.search(d) and ASCII_FR.search(d.lower()):
            out.append(k)
    # le plus précieux d'abord : séries, puis kills KC, puis les plus récents
    tier = {"penta": 5, "quadra": 4, "triple": 3, "double": 2}
    out.sort(key=lambda k: (-tier.get(k.get("multi_kill") or "", 0),
                            k.get("tracked_team_involvement") != "team_killer",
                            -(k.get("event_epoch") or 0)))
    return out


_IGN: dict[str, str] | None = None


def igns(db) -> dict[str, str]:
    global _IGN
    if _IGN is None:
        r = db._get_client().get(f"{db.base}/players", params={"select": "id,ign", "limit": "10000"})
        _IGN = {p["id"]: p["ign"] for p in (r.json() or []) if p.get("id") and p.get("ign")}
    return _IGN


async def download(url: str, dest: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as c:
            r = await c.get(url)
            if r.status_code != 200 or len(r.content) < 50_000:
                return False
            Path(dest).write_bytes(r.content)
            return True
    except Exception:
        return False


async def process(db, k: dict, tmp: str) -> tuple[str, float]:
    url = k.get("clip_url_horizontal") or k.get("clip_url_vertical")
    if not url:
        return "no_clip", 0.0
    path = os.path.join(tmp, f"{k['id']}.mp4")
    if not await download(url, path):
        return "download_failed", 0.0
    try:
        ign = igns(db)
        row = {**k, "kill_visible": None,     # verdict jamais rendu : ne pas le souffler à Gemini
               "_killer_name_hint": ign.get(k.get("killer_player_id") or ""),
               "_victim_name_hint": ign.get(k.get("victim_player_id") or "")}
        result = await analyzer.analyze_kill_row(row, clip_path=path)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if not isinstance(result, dict) or not result.get("description_fr"):
        return "no_result", 0.0
    usage = result.get("_usage") or {}
    cost = compute_gemini_cost(result.get("_model"), usage.get("prompt_tokens"), usage.get("candidates_tokens")) or 0.0
    patch = analyzer._build_analysis_patch(result, k)
    patch.pop("needs_reclip", None)          # dérive peu fiable sans horloge du feed
    visible = patch.get("kill_visible") is not False
    described = len(str(patch.get("ai_description") or "")) >= MIN_DESC
    publish = visible and described
    patch["status"] = "published" if publish else "needs_review"
    patch["publication_status"] = "published" if publish else "hidden"
    og_local = og_generator.generate_og_image(
        kill_id=k["id"],
        killer_name=row["_killer_name_hint"] or ("KC" if k.get("tracked_team_involvement") == "team_killer" else "Opponent"),
        killer_champion=k.get("killer_champion") or "?",
        victim_name=row["_victim_name_hint"] or ("Opponent" if k.get("tracked_team_involvement") == "team_killer" else "KC"),
        victim_champion=k.get("victim_champion") or "?",
        description=patch.get("ai_description") or "",
        rating=float(k.get("avg_rating") or 0), rating_count=int(k.get("rating_count") or 0),
        multi_kill=k.get("multi_kill"),
    )
    og_url = await r2_client.upload_og(k["id"], og_local) if og_local else None
    if og_url:
        patch["og_image_url"] = og_url
    safe_update("kills", {kk: v for kk, v in patch.items() if v is not None or kk == "kill_visible"}, "id", k["id"])
    safe_update("game_events", {"qc_described": described, "qc_visible": patch.get("kill_visible")}, "kill_id", k["id"])
    return ("published" if publish else "hidden_invisible" if not visible else "hidden_undescribed"), cost


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--targets", default="placeholders,unaccented")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-usd", type=float, default=6.0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ids", default="", help="kills précis (ids séparés par des virgules), quelle que soit la cible")
    args = ap.parse_args()
    db = get_db()
    if args.ids:
        ids = [i.strip() for i in args.ids.split(",") if i.strip()]
        r = db._get_client().get(f"{db.base}/kills", params={"select": COLS, "id": f"in.({','.join(ids)})"})
        r.raise_for_status()
        targets = r.json() or []
    else:
        targets = fetch_targets(db, set(args.targets.split(",")))
    if args.limit:
        targets = targets[:args.limit]
    print(f"{len(targets)} kills à réanalyser", flush=True)
    if args.dry_run:
        for k in targets[:10]:
            print(" ", k["id"][:8], k.get("multi_kill"), (k.get("ai_description") or "")[:90])
        return
    REPORT.mkdir(parents=True, exist_ok=True)
    report_path = REPORT / f"run_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    spent, counts, misses = 0.0, {}, 0
    with tempfile.TemporaryDirectory(prefix="kc_reanalyze_") as tmp, open(report_path, "a", encoding="utf-8") as rep:
        for i, k in enumerate(targets, 1):
            if spent >= args.max_usd:
                print(f"budget atteint ({spent:.2f} $)", flush=True)
                break
            before = k.get("ai_description")
            try:
                res, cost = await process(db, k, tmp)
            except Exception as e:
                res, cost = f"exception:{str(e)[:80]}", 0.0
            spent += cost
            counts[res] = counts.get(res, 0) + 1
            misses = misses + 1 if res == "no_result" else 0
            rep.write(json.dumps({"id": k["id"], "result": res, "cost": round(cost, 5), "before": before},
                                 ensure_ascii=False) + "\n")
            rep.flush()
            if i % 10 == 0 or res.startswith("exception"):
                print(f"  {i}/{len(targets)} {counts} {spent:.3f} $", flush=True)
            if misses >= 5:
                print("5 analyses vides d'affilée (quota du jour atteint ?) : arrêt, relancer après 07:00 UTC", flush=True)
                break
    print(f"fin : {counts} | {spent:.3f} $ | rapport {report_path}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
