"""
RECALIBRATE_SHARED_VODS — recale les games qui partagent VOD + offset dans un match.

Audit du 30/09/2026 : 79 games (28 VOD, 1 346 kills publiés) avaient le même
offset que leur G1 sur une VOD qui contient toute la série : vod_offset_finder_v2
prend le premier chrono lisible de la VOD, donc celui de la G1, pour chaque game.
Leurs clips montrent la G1 au même chrono — invisible pour la porte « sans jeu »
comme pour la dérive du chrono.

Source de vérité : getEventDetails (API lolesports) donne, pour chaque game et
chaque VOD (une par langue), `startMillis` = début du segment de la game dans la
vidéo. On en tire un offset a priori :

    offset = startMillis / 1000 + draft

`draft` (draft + chargement, entre le début du segment et le 00:00 du chrono) est
mesuré sur les games « ancres » de la même VOD (offset actuel cohérent avec leur
propre startMillis, typiquement la G1), 330 s par défaut. L'a priori tombe à ±2
min du vrai départ : decryptage (backfill_au_crible --game) lit ensuite le chrono
à plusieurs points et écrit l'offset exact + le modèle de dérive (pauses).

Si la VOD actuelle de la game n'est pas listée pour elle par l'API, on prend la
VOD de la même langue que les autres games du match, sinon en-GB > en-US > fr-FR.

Usage :
    python scripts/recalibrate_shared_vods.py            # dry-run : tableau
    python scripts/recalibrate_shared_vods.py --apply    # écrit + journal
Journal : D:\\kckills_worker\\recalibrate_shared_vods_<horodatage>.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from services.lolesports_api import get_event_details  # noqa: E402
from services.vod_offset import shared_offset_game_ids, usable_offset  # noqa: E402

U = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/"
K = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}", "Content-Type": "application/json"}
LOCALE_PRIORITY = ("en-GB", "en-US", "fr-FR")
DEFAULT_DRAFT_S = 330
JOURNAL_DIR = r"D:\kckills_worker"


def _all_games() -> list[dict]:
    rows, off = [], 0
    while True:
        b = httpx.get(U + "games", headers={**H, "Range": f"{off}-{off + 999}"}, params={
            "select": "id,external_id,match_id,game_number,vod_youtube_id,vod_offset_seconds",
            "vod_youtube_id": "not.is.null"}, timeout=60).json()
        rows += b
        if len(b) < 1000:
            return rows
        off += 1000


def _match_external_id(match_id: str) -> str | None:
    r = httpx.get(U + "matches", headers=H, params={"select": "external_id", "id": f"eq.{match_id}"}, timeout=30).json()
    return (r[0] or {}).get("external_id") if r else None


def _start_s(v: dict) -> float | None:
    sm = v.get("startMillis")
    return None if sm is None else float(sm) / 1000.0


async def plan() -> list[dict]:
    games = _all_games()
    blocked = shared_offset_game_ids(games)
    by_match: dict[str, list[dict]] = {}
    for g in games:
        if g["id"] in blocked:
            by_match.setdefault(g["match_id"], []).append(g)

    out: list[dict] = []
    for match_id, gs in by_match.items():
        ext = _match_external_id(match_id)
        if not ext or not ext.isdigit():
            for g in gs:
                out.append({**g, "action": "skip", "why": "match hors API lolesports"})
            continue
        d = await get_event_details(ext)
        api_games = {str(x.get("id")): x for x in ((d or {}).get("match") or {}).get("games", [])}
        # tout le match (ancres possibles hors groupe bloqué)
        siblings = [g for g in games if g["match_id"] == match_id]

        def api_vod(g: dict, vod_id: str) -> dict | None:
            ag = api_games.get(str(g["external_id"]))
            for v in (ag or {}).get("vods", []):
                if v.get("parameter") == vod_id and _start_s(v) is not None:
                    return v
            return None

        # draft mesuré par VOD sur les ancres : offset actuel cohérent avec
        # le startMillis de la game elle-même (0 < offset - start < 20 min)
        drafts: dict[str, list[float]] = {}
        for g in siblings:
            off = usable_offset(g.get("vod_offset_seconds"))
            v = api_vod(g, g["vod_youtube_id"]) if off is not None else None
            if v is not None and 0 < off - _start_s(v) < 1200:
                drafts.setdefault(g["vod_youtube_id"], []).append(off - _start_s(v))
        locales = [v.get("locale") for g in siblings for v in
                   (api_games.get(str(g["external_id"])) or {}).get("vods", [])
                   if v.get("parameter") == g["vod_youtube_id"]]

        for g in sorted(gs, key=lambda x: x["game_number"] or 0):
            ag = api_games.get(str(g["external_id"]))
            if ag is None:
                out.append({**g, "action": "skip", "why": "game absente de l'API"})
                continue
            vod_id = g["vod_youtube_id"]
            v = api_vod(g, vod_id)
            if v is None:
                cands = [x for x in ag.get("vods", []) if _start_s(x) is not None and x.get("provider") == "youtube"]
                pref = [loc for loc in locales if loc] + list(LOCALE_PRIORITY)
                cands.sort(key=lambda x: pref.index(x.get("locale")) if x.get("locale") in pref else 99)
                if not cands:
                    out.append({**g, "action": "skip", "why": "aucune VOD YouTube positionnée"})
                    continue
                v = cands[0]
                vod_id = v["parameter"]
            draft = statistics.median(drafts[vod_id]) if drafts.get(vod_id) else DEFAULT_DRAFT_S
            proposed = int(round(_start_s(v) + draft))
            current = usable_offset(g.get("vod_offset_seconds"))
            same = vod_id == g["vod_youtube_id"] and current is not None and abs(proposed - current) < 120
            out.append({**g, "new_vod": vod_id, "new_offset": proposed, "locale": v.get("locale"),
                        "start_s": _start_s(v), "draft_s": round(draft), "anchored": bool(drafts.get(vod_id)),
                        "action": "keep" if same else "update"})
    return out


def apply(rows: list[dict]) -> str:
    journal = {"generated": datetime.now(timezone.utc).isoformat(), "rows": []}
    for r in rows:
        if r["action"] != "update":
            continue
        patch = {"vod_offset_seconds": r["new_offset"]}
        if r["new_vod"] != r["vod_youtube_id"]:
            patch["vod_youtube_id"] = r["new_vod"]
        httpx.patch(U + "games", headers=H, params={"id": f"eq.{r['id']}"}, json=patch, timeout=30).raise_for_status()
        journal["rows"].append({"game_id": r["id"], "external_id": r["external_id"],
                                "before": {"vod_youtube_id": r["vod_youtube_id"], "vod_offset_seconds": r["vod_offset_seconds"]},
                                "after": patch})
    path = os.path.join(JOURNAL_DIR, f"recalibrate_shared_vods_{datetime.now():%Y%m%d_%H%M%S}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(journal, f, ensure_ascii=False, indent=1)
    return path


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default=None, help="external_id(s) de games, séparés par des virgules")
    args = ap.parse_args()
    rows = await plan()
    if args.only:
        keep = set(args.only.split(","))
        rows = [r for r in rows if str(r["external_id"]) in keep]
    for r in rows:
        if r["action"] == "skip":
            print(f"  SKIP   {r['external_id']:>20} G{r['game_number']}  {r['why']}")
        else:
            vod = r["new_vod"] + ("" if r["new_vod"] == r["vod_youtube_id"] else f" (était {r['vod_youtube_id']})")
            print(f"  {r['action'].upper():6} {r['external_id']:>20} G{r['game_number']}  {r['vod_offset_seconds']}"
                  f" -> {r['new_offset']}  vod={vod} {r['locale']} start={r['start_s']:.0f}"
                  f" draft={r['draft_s']}{'' if r['anchored'] else ' (défaut)'}")
    n = {a: sum(1 for r in rows if r["action"] == a) for a in ("update", "keep", "skip")}
    print(f"games : {len(rows)} | à recaler {n['update']} | déjà justes {n['keep']} | ignorées {n['skip']}")
    if args.apply:
        print("journal :", apply(rows))


if __name__ == "__main__":
    asyncio.run(main())
