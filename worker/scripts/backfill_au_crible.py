# -*- coding: utf-8 -*-
"""
BACKFILL_AU_CRIBLE — Rejoue TOUS les kills existants dans le pipeline
décryptage : dédup → offset multi-points → ledger → détection re-clips.

Spec : docs/BACKFILL_DECRYPTAGE_SPEC_FOR_FABLE.md §9.5
Prérequis : migrations 088 (clip_ledger) et 089 (dédup SQL) appliquées.

Phases PAR GAME (résumable, idempotent) :
  1. DEDUP   — modules/dedup.build_dedup_plan : doublons exacts (dont
               epoch=0 gol.gg que la 089 ne couvre pas) + collapse
               multi-kill. Neutralisation status='duplicate', jamais delete.
  2. DECRYPT — modules/decryptage.decrypt_game : timer multi-points
               (OCR gratuit d'abord, Gemini budgété), modèle de drift
               par source persisté dans game_vod_sources.
  3. LEDGER  — upsert clip_ledger (on_conflict=kill_id) : identité,
               hiérarchie, offset résolu par kill, état des assets.
  4. AUDIT   — détection des clips à refaire : drift entre l'offset
               utilisé au cut (kill_assets.source_offset_seconds) et
               l'offset résolu ; audio manquant ; formats manquants.
               → asset_check.needs_reclip + raisons dans le ledger.

Usage :
    python scripts/backfill_au_crible.py                    # dry-run 3 games
    python scripts/backfill_au_crible.py --games 50 --apply
    python scripts/backfill_au_crible.py --game <uuid> --apply
    python scripts/backfill_au_crible.py --apply --all      # tout
    ... --skip-decrypt        (pas de vision : dédup + ledger seulement)
    ... --probe-assets        (ffprobe R2 : audio/durée réels par clip)
    ... --gemini-budget N     (défaut 8 lectures Gemini par game)

Le re-clip effectif n'est PAS déclenché ici (validation Mehdi d'abord) :
le ledger contient la liste exacte, scripts/reclip_from_ledger.py
l'exécute ensuite.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import structlog  # noqa: E402

structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

from services.supabase_client import get_db, safe_update  # noqa: E402
from modules.dedup import build_dedup_plan, DedupPlan  # noqa: E402
from modules import decryptage  # noqa: E402
from modules.decryptage import (  # noqa: E402
    resolve_vod_time, DRIFT_TOLERANCE,
    derive_stream_anchor, samples_from_epoch_anchor, fit_drift_model,
)

STATE_FILE = Path(__file__).resolve().parent.parent / "backfill_au_crible_state.json"

KILL_COLS = (
    "id,game_id,event_epoch,game_time_seconds,killer_player_id,"
    "killer_champion,victim_champion,multi_kill,is_first_blood,status,"
    "tracked_team_involvement,clip_url_horizontal,clip_url_vertical,"
    "clip_url_vertical_low,thumbnail_url,og_image_url,highlight_score,"
    "created_at,content_hash"
)


# ─── infra ────────────────────────────────────────────────────────────

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


def patch_in(db, table, ids: list[str], body: dict) -> bool:
    """PATCH id=in.(...) — ⚠️ body sans AUCUNE colonne UNIQUE (piège 23505)."""
    if not ids:
        return True
    client = db._get_client()
    ok = True
    for i in range(0, len(ids), 80):
        chunk = ids[i:i + 80]
        r = client.patch(
            f"{db.base}/{table}",
            params={"id": f"in.({','.join(chunk)})"},
            json=body,
            headers={**db.headers, "Prefer": "return=minimal"},
        )
        if r.status_code >= 400:
            log.error("patch_in_failed", table=table, status=r.status_code,
                      body=r.text[:200])
            ok = False
    return ok


def upsert_ledger(db, rows: list[dict]) -> int:
    if not rows:
        return 0
    client = db._get_client()
    n = 0
    for i in range(0, len(rows), 50):
        chunk = rows[i:i + 50]
        r = client.post(
            f"{db.base}/clip_ledger",
            params={"on_conflict": "kill_id"},
            json=chunk,
            headers={**db.headers,
                     "Prefer": "return=minimal,resolution=merge-duplicates"},
        )
        if r.status_code < 400:
            n += len(chunk)
        else:
            log.error("ledger_upsert_failed", status=r.status_code,
                      body=r.text[:200])
    return n


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"done_games": [], "started_at": None}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


# ─── phase 1 : appliquer le plan de dédup ─────────────────────────────

def apply_dedup(db, plan: DedupPlan, kills_by_id: dict, *, apply: bool) -> dict:
    stats = {"duplicates": 0, "label_fixes": 0, "ge_blocked": 0}

    # groupes par keeper → un PATCH in-clause par groupe
    by_keeper: dict[str, list[str]] = defaultdict(list)
    for a in plan.duplicates:
        by_keeper[a.duplicate_of].append(a.kill_id)
    for keeper, dup_ids in by_keeper.items():
        stats["duplicates"] += len(dup_ids)
        if apply:
            patch_in(db, "kills", dup_ids, {
                "status": "duplicate",
                "is_duplicate_of": keeper,
                "publication_status": "retracted",
            })
            patch_in_ge(db, dup_ids)
            stats["ge_blocked"] += len(dup_ids)

    # corrections de label multi_kill sur les canoniques
    for seq in plan.sequences:
        if seq.inferred_label:
            k = kills_by_id.get(seq.canonical_kill_id, {})
            if k.get("multi_kill") != seq.inferred_label:
                stats["label_fixes"] += 1
                if apply:
                    safe_update("kills", {"multi_kill": seq.inferred_label},
                                "id", seq.canonical_kill_id)
    return stats


def patch_in_ge(db, kill_ids: list[str]):
    """Bloque la publication des game_events des kills neutralisés."""
    client = db._get_client()
    for i in range(0, len(kill_ids), 80):
        chunk = kill_ids[i:i + 80]
        client.patch(
            f"{db.base}/game_events",
            params={"kill_id": f"in.({','.join(chunk)})"},
            json={"qc_human_approved": False,
                  "publish_blocked_reason": "duplicate_kill_au_crible"},
            headers={**db.headers, "Prefer": "return=minimal"},
        )


# ─── phase 3/4 : ledger + audit assets ────────────────────────────────

async def probe_media(url: str) -> dict:
    """ffprobe distant (R2, egress gratuit) : audio/vidéo/durée."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries",
            "stream=codec_type:format=duration", "-of", "json", url,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=40)
        info = json.loads(out or b"{}")
        streams = info.get("streams", [])
        return {
            "audio_ok": any(s.get("codec_type") == "audio" for s in streams),
            "video_ok": any(s.get("codec_type") == "video" for s in streams),
            "duration_s": float(info.get("format", {}).get("duration") or 0),
        }
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
        return {"audio_ok": None, "video_ok": None, "duration_s": None}


def build_ledger_rows(
    game: dict,
    kills: list[dict],
    plan: DedupPlan,
    drift_model: dict | None,
    source_row_id: str | None,
    sync_method: str,
    assets_by_kill: dict[str, list[dict]],
    probes: dict[str, dict],
) -> tuple[list[dict], list[dict]]:
    """→ (rows ledger, liste des re-clips détectés)"""
    dup_of = {a.kill_id: a.duplicate_of for a in plan.duplicates}
    seq_by_canonical = {s.canonical_kill_id: s for s in plan.sequences}
    reclips: list[dict] = []
    rows: list[dict] = []

    for k in kills:
        if k.get("status") == "duplicate" and k["id"] not in dup_of:
            continue  # neutralisé lors d'un run précédent : déjà au ledger
        is_dup = k["id"] in dup_of
        seq = seq_by_canonical.get(k["id"])

        resolved = (resolve_vod_time(drift_model, k.get("game_time_seconds") or 0)
                    if drift_model and k.get("game_time_seconds") is not None
                    else None)

        currents = {a["type"]: a for a in assets_by_kill.get(k["id"], [])
                    if a.get("is_current")}
        probe = probes.get(k["id"], {})
        asset_check = {
            "horizontal": "horizontal" in currents,
            "vertical": "vertical" in currents,
            "vertical_low": "vertical_low" in currents,
            "thumbnail": "thumbnail" in currents,
            "og_image": "og_image" in currents,
            "urls_synced": bool(k.get("clip_url_vertical")),
            **{f"probe_{key}": val for key, val in probe.items()},
        }

        # détection re-clip (uniquement les canoniques publiables)
        reasons = []
        if not is_dup and k.get("tracked_team_involvement") == "team_killer":
            used = (currents.get("horizontal") or {}).get("source_offset_seconds")
            if (resolved is not None and used is not None
                    and abs(float(used) - resolved.offset) > DRIFT_TOLERANCE):
                reasons.append(
                    f"drift_offset:{float(used) - resolved.offset:+.0f}s")
            if probe.get("audio_ok") is False:
                reasons.append("no_audio")
            if probe.get("video_ok") is False:
                reasons.append("no_video")
            if currents and "horizontal" not in currents:
                reasons.append("missing_16_9")
            if k.get("status") in ("published", "analyzed", "clipped") and not currents:
                reasons.append("no_assets")
        if reasons:
            asset_check["needs_reclip"] = True
            asset_check["reclip_reasons"] = reasons
            reclips.append({"kill_id": k["id"], "game_id": game["id"],
                            "reasons": reasons})

        rows.append({
            "kill_id": k["id"],
            "game_id": game["id"],
            "event_epoch": k.get("event_epoch") or 0,
            "game_time_seconds": k.get("game_time_seconds"),
            "killer_champion": k.get("killer_champion"),
            "victim_champion": k.get("victim_champion"),
            "multi_kill": (seq.inferred_label if seq and seq.inferred_label
                           else k.get("multi_kill")),
            "multi_kill_tier": seq.tier if seq else None,
            "absorbed_kill_ids": seq.absorbed_kill_ids if seq else [],
            "sequence_start_epoch": seq.sequence_start_epoch if seq else None,
            "sequence_end_epoch": seq.sequence_end_epoch if seq else None,
            "vod_source_id": source_row_id,
            "resolved_offset_seconds": resolved.offset if resolved else None,
            "resolved_vod_time": resolved.vod_time if resolved else None,
            "offset_confidence": resolved.confidence if resolved else None,
            "offset_method": sync_method if resolved else None,
            "content_hash": k.get("content_hash"),
            "asset_check": asset_check,
            "status": "duplicate" if is_dup else k.get("status"),
            "notes": (f"dup_of:{dup_of[k['id']]}" if is_dup else None),
        })
    return rows, reclips


# ─── boucle principale ────────────────────────────────────────────────

async def process_game(
    db, game: dict, kills: list[dict], args,
    vod_anchor: tuple[float, float] | None = None,
) -> tuple[dict, tuple[float, float] | None]:
    """→ (stats, ancre_epoch_du_VOD ou None).

    `vod_anchor` = (stream_start_epoch_s, confiance) dérivée d'une game
    SŒUR déjà décryptée sur la même VOD : cette game se place alors par
    arithmétique d'epoch, ZÉRO vision (vague 2 — 42 % des games
    partagent leur VOD)."""
    gid = game["id"]
    kills_by_id = {k["id"]: k for k in kills}
    stats: dict = {"game_id": gid[:8], "kills": len(kills)}

    # 1. dédup
    plan = build_dedup_plan(kills)
    stats.update(apply_dedup(db, plan, kills_by_id, apply=args.apply))
    # complétude cross-source : les gol.gg sans jumeau livestats sont des
    # morts que livestats a ratées (ou l'inverse : game jamais moissonnée)
    stats["cross_source_merged"] = plan.cross_source_merged
    stats["golgg_only"] = len(plan.golgg_only_kill_ids)

    # 2. décryptage
    drift_model, source_row_id, sync_method, confidence = None, None, "none", 0.0
    if not args.skip_decrypt and game.get("vod_youtube_id"):
        kill_gts = sorted({k["game_time_seconds"] for k in kills
                           if k.get("game_time_seconds")
                           and k.get("tracked_team_involvement") == "team_killer"})
        result = await decryptage.decrypt_game(
            gid,
            gemini_budget=args.gemini_budget,
            kill_game_times=kill_gts[:4],   # les 4 premiers kills en probes bonus
        ) if args.apply else None
        if result:
            drift_model = result["model"]
            source_row_id = result["source_row_id"]
            sync_method = result["sync_method"]
            confidence = result["confidence"]
    elif game.get("vod_youtube_id"):
        # sans vision : reprendre le modèle déjà persisté s'il existe.
        # 400 → migration 088 pas encore appliquée (colonnes absentes) :
        # on continue sans modèle, dédup + ledger dry-run restent utiles.
        try:
            srows = fetch_all(db, "game_vod_sources", {
                "select": "id,drift_model,sync_method,offset_confidence",
                "game_id": f"eq.{gid}", "source_type": "eq.official_lec",
            })
        except Exception as e:
            log.warn("drift_model_unavailable_apply_088", error=str(e)[:80])
            srows = []
        if srows and srows[0].get("drift_model"):
            drift_model = srows[0]["drift_model"]
            source_row_id = srows[0]["id"]
            sync_method = srows[0].get("sync_method") or "unknown"
            confidence = srows[0].get("offset_confidence") or 0.0

    # 2bis. Vague 2 — propagation d'ancre : pas de modèle propre mais une
    # game sœur de la MÊME VOD est décryptée → cette game se place par
    # epoch (vod_time = epoch - anchor), zéro vision.
    if drift_model is None and vod_anchor is not None:
        anchor_epoch, anchor_conf = vod_anchor
        synth = samples_from_epoch_anchor(anchor_epoch, kills, anchor_conf)
        if len(synth) >= 2:
            model_obj, fit_conf = fit_drift_model(synth)
            if model_obj is not None:
                drift_model = model_obj.to_json()
                confidence = round(min(anchor_conf, fit_conf), 3)
                sync_method = "epoch_anchor"
                if args.apply:
                    src = decryptage._ensure_official_source_row(game)
                    if src:
                        source_row_id = src["id"]
                        ok = decryptage.persist_decryptage(
                            game=game, source_row=src, model=model_obj,
                            confidence=confidence, samples=synth,
                            sync_method="epoch_anchor",
                        )
                        if not ok:
                            # migration 091 pas encore appliquée (le CHECK
                            # refuse 'epoch_anchor') → provenance dégradée
                            # mais modèle persisté quand même
                            decryptage.persist_decryptage(
                                game=game, source_row=src, model=model_obj,
                                confidence=confidence, samples=synth,
                                sync_method="official_epoch",
                            )

    # 2ter. dérive l'ancre de CE modèle pour les games suivantes du VOD
    anchor_out: tuple[float, float] | None = None
    if drift_model is not None:
        a, ac = derive_stream_anchor(drift_model, kills)
        if a is not None and ac >= 0.4:
            anchor_out = (a, ac)

    stats["sync_method"] = sync_method
    stats["offset_confidence"] = confidence

    # 3+4. assets + probes + ledger
    ids = [k["id"] for k in kills]
    assets_by_kill: dict[str, list[dict]] = defaultdict(list)
    for i in range(0, len(ids), 60):
        chunk = ids[i:i + 60]
        for a in fetch_all(db, "kill_assets", {
            "select": "kill_id,type,is_current,url,source_offset_seconds",
            "kill_id": f"in.({','.join(chunk)})",
            "is_current": "eq.true",
        }):
            assets_by_kill[a["kill_id"]].append(a)

    probes: dict[str, dict] = {}
    if args.probe_assets:
        sem = asyncio.Semaphore(8)

        async def _p(kid, url):
            async with sem:
                probes[kid] = await probe_media(url)

        await asyncio.gather(*[
            _p(k["id"], k["clip_url_vertical"] or k["clip_url_horizontal"])
            for k in kills
            if (k.get("clip_url_vertical") or k.get("clip_url_horizontal"))
            and k.get("status") in ("published", "analyzed", "clipped")
        ])

    rows, reclips = build_ledger_rows(
        game, kills, plan, drift_model, source_row_id, sync_method,
        assets_by_kill, probes,
    )
    stats["reclips"] = len(reclips)
    stats["ledger_rows"] = len(rows)
    if args.apply:
        upsert_ledger(db, rows)
    return stats, anchor_out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="écrit (défaut dry-run)")
    ap.add_argument("--games", type=int, default=3, help="nb de games à traiter")
    ap.add_argument("--all", action="store_true", help="toutes les games")
    ap.add_argument("--game", type=str, default=None, help="une game précise (uuid)")
    ap.add_argument("--skip-decrypt", action="store_true",
                    help="pas de vision — dédup + ledger seulement")
    ap.add_argument("--probe-assets", action="store_true",
                    help="ffprobe R2 par clip (audio/durée réels)")
    ap.add_argument("--gemini-budget", type=int, default=8,
                    help="lectures Gemini max par game")
    ap.add_argument("--reset-state", action="store_true")
    args = ap.parse_args()

    db = get_db()
    if db is None:
        print("Supabase indisponible")
        return 1

    state = load_state()
    if args.reset_state:
        state = {"done_games": [], "started_at": None}
    if not state.get("started_at"):
        state["started_at"] = datetime.now(timezone.utc).isoformat()
    done = set(state["done_games"])

    print("Chargement des kills…")
    all_kills = fetch_all(db, "kills", {"select": KILL_COLS})
    by_game: dict[str, list[dict]] = defaultdict(list)
    for k in all_kills:
        by_game[k["game_id"]].append(k)

    games_rows = fetch_all(db, "games", {
        "select": "id,external_id,vod_youtube_id,vod_offset_seconds,duration_seconds"})
    games_map = {g["id"]: g for g in games_rows}

    if args.game:
        targets = [args.game]
    else:
        # games avec VOD et le plus de kills publiables d'abord
        def prio(gid):
            ks = by_game[gid]
            return (games_map.get(gid, {}).get("vod_youtube_id") is None,
                    -sum(1 for k in ks
                         if k.get("tracked_team_involvement") == "team_killer"))
        targets = sorted((g for g in by_game if g not in done), key=prio)
        if not args.all:
            targets = targets[:args.games]

    # Vague 2 — groupement par VOD : la 1re game d'un VOD décryptée par
    # vision donne l'ancre epoch du stream ; ses sœurs se placent par
    # arithmétique, zéro vision. On ordonne chaque groupe pour décrypter
    # d'abord la game au plus de kills à epoch fiable (meilleure ancre).
    def _epoch_kill_count(gid):
        return sum(1 for k in by_game[gid] if (k.get("event_epoch") or 0) > 0)

    vod_of = {gid: (games_map.get(gid) or {}).get("vod_youtube_id")
              for gid in targets}
    ordered: list[str] = []
    seen: set[str] = set()
    for gid in targets:
        if gid in seen:
            continue
        vod = vod_of.get(gid)
        if not vod:
            ordered.append(gid)
            seen.add(gid)
            continue
        siblings = [g for g in targets if vod_of.get(g) == vod and g not in seen]
        siblings.sort(key=_epoch_kill_count, reverse=True)
        ordered.extend(siblings)
        seen.update(siblings)
    targets = ordered

    print(f"{len(targets)} game(s) à passer au crible "
          f"({'APPLY' if args.apply else 'DRY-RUN'})\n")

    totals: Counter = Counter()
    vod_anchors: dict[str, tuple[float, float]] = {}
    for i, gid in enumerate(targets):
        game = games_map.get(gid)
        if game is None:
            continue
        vod = game.get("vod_youtube_id")
        try:
            stats, anchor = await process_game(
                db, game, by_game[gid], args,
                vod_anchor=vod_anchors.get(vod) if vod else None,
            )
        except Exception as e:
            log.error("game_failed", game_id=gid[:8], error=str(e)[:200])
            continue
        if vod and anchor and (vod not in vod_anchors
                               or anchor[1] > vod_anchors[vod][1]):
            vod_anchors[vod] = anchor
        for key in ("kills", "duplicates", "label_fixes", "ledger_rows",
                    "reclips", "cross_source_merged", "golgg_only"):
            totals[key] += stats.get(key, 0)
        print(f"[{i + 1}/{len(targets)}] {gid[:8]} kills={stats['kills']} "
              f"dup={stats.get('duplicates', 0)} labels={stats.get('label_fixes', 0)} "
              f"xsrc={stats.get('cross_source_merged', 0)} "
              f"gaps={stats.get('golgg_only', 0)} "
              f"ledger={stats.get('ledger_rows', 0)} reclips={stats.get('reclips', 0)} "
              f"sync={stats.get('sync_method')} conf={stats.get('offset_confidence')}")
        if args.apply:
            done.add(gid)
            state["done_games"] = sorted(done)
            save_state(state)

    print(f"\nTOTALS : {dict(totals)}")
    print(f"State : {STATE_FILE}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    raise SystemExit(asyncio.run(main()))
