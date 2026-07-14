# -*- coding: utf-8 -*-
"""
RECLIP_FROM_LEDGER — Exécute les re-clips détectés par backfill_au_crible.

Source de vérité : clip_ledger.asset_check.needs_reclip = true
(raisons : drift_offset, no_audio, no_video, missing_16_9, no_assets).

Par VOD (téléchargé UNE fois) :
  1. offset synthétique par kill = resolved_vod_time - game_time
     (le modèle de drift par segment, pas l'offset unique de la game) ;
  2. clipper.clip_kill (fast path VOD local, triple format + R2 +
     kill_assets versionnés) ;
  3. QC v2 OBLIGATOIRE sur le clip produit (audio, durée, timer, départ) —
     « bon départ, bon clip » ;
  4. QC pass  → PATCH kills des URLs SEULEMENT (jamais content_hash —
                piège 23505) ; le status ne change pas (un published
                re-cuté reste published, l'analyse reste valide).
     QC fail  → kills.status='needs_review' + ledger qc_verdict, le clip
                fautif n'écrase PAS les URLs servies.
  5. ledger mis à jour : qc_checks détaillés, needs_reclip levé si succès.

Usage :
    python scripts/reclip_from_ledger.py                # dry-run : liste
    python scripts/reclip_from_ledger.py --apply --limit 20
    python scripts/reclip_from_ledger.py --apply --reasons no_audio,no_video
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import structlog  # noqa: E402

structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

from config import config  # noqa: E402
from services.supabase_client import get_db, safe_update  # noqa: E402
from modules import clipper  # noqa: E402
from modules.clip_qc_v2 import run_qc  # noqa: E402
from modules.decryptage import ProbeBudget  # noqa: E402

URL_KEYS = ("clip_url_horizontal", "clip_url_vertical",
            "clip_url_vertical_low", "thumbnail_url")


def fetch_all(db, table, params):
    rows, offset = [], 0
    client = db._get_client()
    while True:
        p = {**params, "limit": "1000", "offset": str(offset)}
        r = client.get(f"{db.base}/{table}", params=p)
        r.raise_for_status()
        batch = r.json() or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


async def reclip_one(db, entry: dict, kill: dict, game: dict,
                     local_vod: str, args) -> str:
    """→ 'ok' | 'qc_fail' | 'clip_fail'"""
    gt = kill.get("game_time_seconds") or 0
    resolved_vt = entry.get("resolved_vod_time")
    if resolved_vt is not None:
        synthetic_offset = int(float(resolved_vt) - gt)
    else:
        synthetic_offset = game.get("vod_offset_seconds") or 0

    result = await clipper.clip_kill(
        kill_id=kill["id"],
        youtube_id=game["vod_youtube_id"],
        vod_offset_seconds=synthetic_offset,
        game_time_seconds=gt,
        multi_kill=kill.get("multi_kill"),
        killer_champion=kill.get("killer_champion"),
        victim_champion=kill.get("victim_champion"),
        local_vod_path=local_vod,
        game_id=game["id"],
    )
    if not result or not result.get("_local_h_path"):
        return "clip_fail"

    # QC v2 — la frame à t=15 d'un clip paddé -30 s montre gt-15 ;
    # une 2e lecture à t=32 (gt+2) vote avec la première.
    before = config.CLIP_TIMING.get(kill.get("multi_kill") or "default",
                                    {"before": 30})["before"]
    qc = await run_qc(
        result["_local_h_path"],
        expected_timer_at={15: gt - before + 15, 32: gt - before + 32},
        killer_champion=kill.get("killer_champion"),
        victim_champion=kill.get("victim_champion"),
        budget=ProbeBudget(args.gemini_per_clip),
        allow_degraded=(entry.get("offset_confidence") or 0) >= 0.75,
    )

    asset_check = dict(entry.get("asset_check") or {})
    if qc.verdict == "pass":
        url_patch = {k: result[k] for k in URL_KEYS if result.get(k)}
        if url_patch:
            safe_update("kills", url_patch, "id", kill["id"])
        asset_check.update({
            "needs_reclip": False, "reclip_done": True,
            "audio_ok": True, "urls_synced": True,
        })
        safe_update("clip_ledger", {
            "qc_checks": qc.to_json()["checks"],
            "qc_verdict": "pass",
            "qc_pass_count": qc.pass_count,
            "asset_check": asset_check,
        }, "kill_id", kill["id"])
        return "ok"

    # QC fail : ne pas écraser les URLs servies ; marquer pour revue
    safe_update("kills", {"status": "needs_review"}, "id", kill["id"])
    asset_check["reclip_qc_failed"] = True
    safe_update("clip_ledger", {
        "qc_checks": qc.to_json()["checks"],
        "qc_verdict": "needs_review",
        "qc_pass_count": qc.pass_count,
        "asset_check": asset_check,
    }, "kill_id", kill["id"])
    return "qc_fail"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--reasons", type=str, default=None,
                    help="filtre : no_audio,no_video,drift_offset,…")
    ap.add_argument("--gemini-per-clip", type=int, default=2)
    args = ap.parse_args()

    db = get_db()
    if db is None:
        print("Supabase indisponible")
        return 1

    entries = fetch_all(db, "clip_ledger", {
        "select": "kill_id,game_id,game_time_seconds,resolved_vod_time,"
                  "offset_confidence,asset_check",
        "asset_check->>needs_reclip": "eq.true",
    })
    if args.reasons:
        wanted = set(args.reasons.split(","))
        entries = [e for e in entries
                   if wanted & {r.split(":")[0] for r in
                                (e.get("asset_check") or {}).get("reclip_reasons", [])}]
    entries = entries[:args.limit]
    print(f"{len(entries)} re-clip(s) à exécuter "
          f"({'APPLY' if args.apply else 'DRY-RUN'})")

    if not entries:
        return 0

    kill_ids = [e["kill_id"] for e in entries]
    kills = {}
    for i in range(0, len(kill_ids), 60):
        for k in fetch_all(db, "kills", {
            "select": "id,game_id,game_time_seconds,multi_kill,"
                      "killer_champion,victim_champion,status",
            "id": f"in.({','.join(kill_ids[i:i + 60])})",
        }):
            kills[k["id"]] = k

    game_ids = sorted({e["game_id"] for e in entries})
    games = {g["id"]: g for g in fetch_all(db, "games", {
        "select": "id,vod_youtube_id,vod_offset_seconds",
        "id": f"in.({','.join(game_ids)})",
    })}

    by_vod: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        g = games.get(e["game_id"])
        if g and g.get("vod_youtube_id"):
            by_vod[g["vod_youtube_id"]].append(e)

    if not args.apply:
        for yt, ents in by_vod.items():
            print(f"  VOD {yt}: {len(ents)} clips — raisons: "
                  f"{ {r for e in ents for r in (e.get('asset_check') or {}).get('reclip_reasons', [])} }")
        return 0

    stats = {"ok": 0, "qc_fail": 0, "clip_fail": 0}
    for yt, ents in by_vod.items():
        local_vod = await clipper.download_full_vod(yt)
        if not local_vod:
            print(f"  SKIP VOD {yt} (téléchargement impossible)")
            stats["clip_fail"] += len(ents)
            continue
        for e in ents:
            kill = kills.get(e["kill_id"])
            game = games.get(e["game_id"])
            if not kill or not game:
                continue
            try:
                outcome = await reclip_one(db, e, kill, game, local_vod, args)
            except Exception as ex:
                log.error("reclip_error", kill=e["kill_id"][:8],
                          error=str(ex)[:160])
                outcome = "clip_fail"
            stats[outcome] += 1
            print(f"  {e['kill_id'][:8]} → {outcome}")

    print(f"\nRÉSULTAT : {stats}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    raise SystemExit(asyncio.run(main()))
