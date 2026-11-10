"""QC v3 — passage d'une game en écriture : re-timing, re-clip, contrôle, publication.

    python -m qc3.apply --game <uuid> --video <VOD complète locale> [--kills quarantine|kc]
                        [--profile ewc26] [--hud ewc26] [--limit N] [--apply]

Sans --apply : rien n'est écrit, ni en base ni sur R2 (rapport seulement).
Avec --apply, dans cet ordre, journalisé avant/après :
  1. kills.event_epoch / game_time_seconds recalés sur la frame du feed
     (écart > 0,5 s) pour TOUS les kills appariés de la game ;
  2. pour chaque kill retenu : clipper.clip_kill (fichier local, upload R2
     versionné), puis E3 sur le clip produit ;
  3. verdict pass / pass_timer : URLs + titre des données + QC passée,
     clip_ledger (offset_method 'qc3'), republication du kill masqué par les
     portes game_events (même ordre que scripts/republish_reclipped.py) ;
     off_air / mistimed / broken : le clip servi n'est pas touché, le kill
     reste hors ligne, needs_reclip=false avec la raison : verdict définitif,
     aucun module ne le reprendra en boucle.
Journal : <données>/qc3/apply_<game>_<horodatage>.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections import Counter
from datetime import datetime, timezone

import structlog

from engine_v2.chrono import ChronoReader
from engine_v2.score import ScoreReader
from qc3 import sync as S
from qc3 import titles as T
from qc3.calibrate import learn as learn_score
from qc3.pilot import AFTER_S, MAX_BEFORE_S, MIN_BEFORE_S, SCREEN_LEAD_S, expected_scores, match_db_kills
from qc3.timeline import CACHE_DIR, KillMoment, load_timeline
from qc3.verify import verify_clip

log = structlog.get_logger()
JOURNAL_DIR = os.path.dirname(CACHE_DIR)
RETIME_MIN_MS = 500
PASSING = ("pass", "pass_timer")
KILL_COLS = ("id,event_epoch,game_time_seconds,killer_champion,victim_champion,status,publication_status,"
             "needs_reclip,reclip_reason,tracked_team_involvement,multi_kill,clip_url_vertical")


def window(k: KillMoment) -> tuple[int, int]:
    before = MIN_BEFORE_S
    if k.fight_start_ms:
        before = min(MAX_BEFORE_S, max(before, (k.epoch_ms - k.fight_start_ms) / 1000.0 + 2.0))
    return int(round(SCREEN_LEAD_S + before)), int(round(AFTER_S))


def _republish(kill_id: str) -> str:
    """Portes game_events puis kill publié (ordre de republish_reclipped)."""
    from services.supabase_client import get_db
    db = get_db()
    c = db._get_client()
    ev = c.get(f"{db.base}/game_events", headers=db.headers, params={
        "select": "id,qc_clip_produced,qc_typed,qc_described,qc_human_approved", "kill_id": f"eq.{kill_id}"}).json()
    if not ev:
        return "pas de game_event"
    ev = ev[0]
    if ev.get("qc_human_approved") is False:
        return "refusé à la main"
    patch = {"qc_clip_validated": True, "qc_visible": True, "publish_blocked_reason": None,
             "qc_clip_produced": True, "qc_described": True}
    c.patch(f"{db.base}/game_events", headers=db.headers, params={"id": f"eq.{ev['id']}"}, json=patch).raise_for_status()
    after = c.get(f"{db.base}/game_events", headers=db.headers,
                  params={"select": "is_publishable", "id": f"eq.{ev['id']}"}).json()
    if not (after and after[0].get("is_publishable")):
        return "event non publiable"
    c.patch(f"{db.base}/kills", headers=db.headers, params={"id": f"eq.{kill_id}"},
            json={"status": "published", "publication_status": "published"}).raise_for_status()
    return "republié"


async def run(game_id: str, video: str, kills_filter: str, profile: str, hud_profile: str,
              limit: int | None, apply: bool, prior_offset: float | None = None) -> dict:
    from modules import clipper
    from services.supabase_client import safe_select, safe_update

    game = safe_select("games", "id,external_id,vod_youtube_id,vod_offset_seconds", id=game_id)[0]
    tl = await load_timeline(game["external_id"])
    db = [k for k in safe_select("kills", KILL_COLS, game_id=game_id, _limit=500) or [] if k["status"] != "duplicate"]
    pairs = match_db_kills(tl, db)

    base = prior_offset if prior_offset is not None else game.get("vod_offset_seconds")
    src = S.LocalVideo(video)
    chrono = ChronoReader(profile)
    vs = S.measure(tl, src, chrono, prior_pos=lambda e: (base or 0) + tl.chrono_at(e))
    score = ScoreReader(hud_profile)
    calib = learn_score(tl, vs, src, chrono, score) if vs.status == "ok" else None
    src.close()

    journal = {"game": game_id, "apply": apply, "sync": vs.to_json(), "score_calibration": calib,
               "retime": [], "clips": [], "at": datetime.now(timezone.utc).isoformat()}
    if vs.status != "ok":
        journal["stopped"] = f"synchro {vs.status}"
        return _finish(game_id, journal)

    # 1. re-timing
    for d, k in pairs:
        if not k:
            continue
        new = {"event_epoch": k.epoch_ms, "game_time_seconds": int(k.chrono_s)}
        if abs(int(d["event_epoch"]) - k.epoch_ms) > RETIME_MIN_MS or d.get("game_time_seconds") != new["game_time_seconds"]:
            journal["retime"].append({"kill_id": d["id"], "before": {x: d.get(x) for x in new}, "after": new})
            if apply:
                safe_update("kills", new, "id", d["id"])

    # 2-3. clips
    targets = [(d, k) for d, k in pairs if k]
    if kills_filter == "quarantine":
        targets = [(d, k) for d, k in targets if d["status"] == "needs_review"]
    elif kills_filter == "kc":
        targets = [(d, k) for d, k in targets if d.get("tracked_team_involvement")]
    if limit:
        targets = targets[:limit]
    for d, k in targets:
        before, after = window(k)
        gt = int(k.chrono_s)
        kill_pos = vs.pos(k.epoch_ms)
        row = {"kill_id": d["id"], "chrono": T.mmss(k.chrono_s), "title": T.title(tl, k),
               "status_before": d["status"], "pub_before": d.get("publication_status")}
        if not apply:
            journal["clips"].append({**row, "action": "à re-clipper"})
            continue
        res = await clipper.clip_kill(
            kill_id=d["id"], youtube_id=game["vod_youtube_id"], vod_offset_seconds=int(round(kill_pos - gt)),
            game_time_seconds=gt, multi_kill=k.multi_kill, killer_champion=k.killer_champion,
            victim_champion=k.victim_champion, local_vod_path=video, game_id=game_id,
            window_override={"before": before, "after": after})
        h = (res or {}).get("_local_h_path")
        if not h:
            row["verdict"] = "clip_failed"
            journal["clips"].append(row)
            continue
        v = verify_clip(h, float(before), k.chrono_s, chrono, score_reader=score,
                        expected_score_at=expected_scores(tl, k), killer_side=k.killer_side)
        row.update({"verdict": v.verdict, "detail": v.detail, "timer_hits": v.timer_hits})
        ledger = {"resolved_vod_time": round(kill_pos, 2), "offset_method": "qc3",
                  "offset_confidence": 0.99, "qc_verdict": "pass" if v.verdict in PASSING else "needs_review",
                  "qc_checks": [{"name": "qc3", "verdict": v.verdict, "detail": v.detail,
                                 "timer_hits": v.timer_hits}]}
        if v.verdict in PASSING:
            patch = {x: res[x] for x in ("clip_url_horizontal", "clip_url_vertical", "clip_url_vertical_low",
                                         "thumbnail_url") if res.get(x)}
            patch.update({"ai_description": row["title"], "ai_description_fr": row["title"], "kill_visible": True,
                          "qc_status": "passed", "needs_reclip": False, "reclip_reason": None})
            safe_update("kills", patch, "id", d["id"])
            safe_update("clip_ledger", {**ledger, "asset_check": {"needs_reclip": False, "reclip_done": True,
                                                                  "urls_synced": True}}, "kill_id", d["id"])
            if d["status"] == "needs_review" and d.get("publication_status") in ("hidden", None):
                row["publication"] = _republish(d["id"])
        else:
            safe_update("kills", {"needs_reclip": False, "reclip_reason": f"qc3:{v.verdict}"}, "id", d["id"])
            safe_update("clip_ledger", {**ledger, "asset_check": {"needs_reclip": False, "qc3_final": v.verdict}},
                        "kill_id", d["id"])
        journal["clips"].append(row)
    journal["verdicts"] = dict(Counter(c.get("verdict", c.get("action")) for c in journal["clips"]))
    return _finish(game_id, journal)


def _finish(game_id: str, journal: dict) -> dict:
    os.makedirs(JOURNAL_DIR, exist_ok=True)
    path = os.path.join(JOURNAL_DIR, f"apply_{game_id[:8]}_{datetime.now():%Y%m%d_%H%M%S}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(journal, f, ensure_ascii=False, indent=1)
    journal["journal"] = path
    return journal


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--kills", choices=["quarantine", "kc", "all"], default="quarantine")
    ap.add_argument("--profile", default="worlds26_row")
    ap.add_argument("--hud", default="worlds26")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--prior-offset", type=float, default=None,
                    help="position ≈ prior + chrono (défaut : games.vod_offset_seconds)")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    j = asyncio.run(run(a.game, a.video, a.kills, a.profile, a.hud, a.limit, a.apply, a.prior_offset))
    print(json.dumps({k: v for k, v in j.items() if k not in ("clips", "retime")}, ensure_ascii=False, indent=1))
    print(f"re-timing : {len(j['retime'])} kill(s)")
    for c in j["clips"]:
        print(f"  {c['chrono']:>6} {c.get('verdict', c.get('action')):12} {c.get('publication', '')}  {c['title']}")
