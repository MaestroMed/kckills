# -*- coding: utf-8 -*-
"""
TWITCH_BACKFILL — rattrapage et re-clip des kills KC depuis les VODs Twitch
officielles LEC, synchronisées à l'heure réelle du feed.

Pour chaque game des matchs demandés :
  1. match + games en base (pipeline.upsert_match_and_games) ;
  2. kills : harvester frame par frame, puis RÉCONCILIATION avec la base
     (game jamais extraite, ou --rescan) : insère les kills manquants,
     corrige multi_kill / tueur / first blood — ne supprime JAMAIS rien ;
  3. VOD Twitch du live qui couvre la game + section 1080p60 de la game ;
  4. calibration (modules/twitch_sync) — la game est sautée si moins de 3
     lectures du chrono concordent ;
  5. pour chaque kill ciblé : clipper.clip_kill (fichier local, versions
     R2, kill_assets) -> contrôle média -> analyse Gemini du clip -> OG ->
     publication.

Cibles (--scope, défaut "missing,invisible,review") :
  missing   kill sans clip (raw / vod_found / clip_error / enriched)
  invisible kill publié dont le clip ne montre pas le kill (kill_visible=false,
            typiquement une VOD co-stream décalée après une pause)
  review    kill en needs_review / manual_review (QC raté)
Un kill publié ET visible n'est jamais touché : son clip (souvent le cast
FR de Kameto) reste en place.

Usage :
  python scripts/twitch_backfill.py --match 115548681803406327 --apply
  python scripts/twitch_backfill.py --summer --rescan --apply
  python scripts/twitch_backfill.py --match X                  # plan seulement (dry-run)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("KCKILLS_LIVESTATS_DELAY", "0.5")   # backfill historique

import structlog  # noqa: E402

structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(colors=False),
])
log = structlog.get_logger()

from config import config  # noqa: E402
from models.kill_event import compute_hype_score  # noqa: E402
from modules import analyzer, clipper, feed_clock, harvester, og_generator, pipeline, twitch_sync  # noqa: E402
from modules.clip_qc_v2 import check_media_sanity  # noqa: E402
from services import r2_client, twitch_vod  # noqa: E402
from services.local_paths import LocalPaths  # noqa: E402
from services.supabase_client import safe_insert, safe_select, safe_update  # noqa: E402

SUMMER_2026 = [
    "115548681803406199", "115548681803406271", "115548681803406287", "115548681803406171",
    "115548681803406139", "115548681803406279", "115548681803406243", "115548681803406223",
    "115548681803406259", "115548681803406291", "115548681803406303", "115548681803406327",
]
KILL_COLS = (
    "id,game_id,event_epoch,game_time_seconds,killer_champion,victim_champion,killer_player_id,"
    "victim_player_id,assistants,confidence,tracked_team_involvement,is_first_blood,multi_kill,"
    "shutdown_bounty,fight_type,matchup_lane,lane_phase,status,kill_visible,clip_url_vertical,"
    "og_image_url,highlight_score,ai_description,avg_rating,rating_count"
)
MISSING_STATUSES = {"raw", "enriched", "vod_found", "clip_error", "clipping", "clipped", "analyzed"}
REVIEW_STATUSES = {"needs_review", "manual_review"}
SECTION_MARGIN_S = 240
REPORT_DIR = os.path.join(os.path.dirname(LocalPaths.vods_dir()), "twitch_backfill")
# Règle LoL des séries (indépendante du moteur du harvester, qui peut changer)
MULTIKILL_GAP_MS = 10_000
PENTA_GAP_MS = 30_000


# ─── 2. Réconciliation des kills ────────────────────────────────────────────

def _kill_payload(k) -> dict:
    d = k.to_db_dict()
    d["status"] = "vod_found"
    for key in ("killer_player_id", "victim_player_id"):
        if not d.get(key):
            d.pop(key, None)
    return {kk: v for kk, v in d.items() if v is not None}


async def reconcile_game(game: dict, apply: bool) -> dict:
    """Harvest frame par frame + alignement sur les kills en base."""
    new = await harvester.extract_kills_from_game(external_game_id=game["external_id"], db_game_id=game["id"])
    for k in new:   # identités joueurs + type de fight, comme harvester.run
        try:
            k.killer_player_id = harvester._player_uuid_from_ign(k.killer_name)
            k.victim_player_id = harvester._player_uuid_from_ign(k.victim_name)
            n_conc = sum(1 for o in new if o is not k and abs(o.event_epoch - k.event_epoch) <= 10_000)
            k.fight_type = harvester._classify_fight_type(n_conc, len(k.assistants or []), k.multi_kill)
        except Exception as e:
            log.debug("reconcile_enrich_failed", error=str(e)[:100])
    existing = safe_select("kills", KILL_COLS, game_id=game["id"]) or []
    # Rapprochement 1-1 avec les rows existantes (règles convenues avec la
    # session « harvester », 23/09) : même tueur obligatoire ; row datée
    # entre -2 s et +30 s du kill si même victime, +12 s sinon (l'ancien
    # diff datait à la fin de sa fenêtre de 10 s et croisait parfois les
    # victimes). Plus proche d'abord. On ne corrige QUE multi_kill et first
    # blood : jamais tueur/victime (idx_kills_semantic_unique, clips en place).
    pairs: list[tuple[int, object, dict]] = []
    for k in new:
        for o in existing:
            if o.get("status") == "duplicate" or o.get("killer_champion") != k.killer_champion:
                continue
            dt = (o.get("event_epoch") or 0) - k.event_epoch
            same_victim = o.get("victim_champion") == k.victim_champion
            if -2000 <= dt <= (30_000 if same_victim else 12_000):
                pairs.append(((0 if same_victim else 1, abs(dt)), k, o))
    pairs.sort(key=lambda t: t[0])
    used: set[str] = set()
    matched_new: set[int] = set()
    patches: list[tuple[str, dict]] = []
    crossed = 0
    for _rank, k, o in pairs:
        if id(k) in matched_new or o["id"] in used:
            continue
        matched_new.add(id(k))
        used.add(o["id"])
        if o.get("victim_champion") != k.victim_champion:
            crossed += 1
        patch: dict = {}
        if (o.get("multi_kill") or None) != (k.multi_kill or None):
            patch["multi_kill"] = k.multi_kill
        if bool(o.get("is_first_blood")) != bool(k.is_first_blood):
            patch["is_first_blood"] = bool(k.is_first_blood)
        # Identités joueurs : le harness pipeline n'écrivait jamais
        # killer/victim_player_id (tous les kills du Summer sans pseudo sur
        # le site). Champs hors index unique : sûrs à compléter.
        if not o.get("killer_player_id") and k.killer_player_id and o.get("killer_champion") == k.killer_champion:
            patch["killer_player_id"] = k.killer_player_id
        if not o.get("victim_player_id") and k.victim_player_id and o.get("victim_champion") == k.victim_champion:
            patch["victim_player_id"] = k.victim_player_id
        if patch:
            patches.append((o["id"], patch))
    inserts = [k for k in sorted(new, key=lambda x: x.event_epoch) if id(k) not in matched_new]
    orphans = [o for o in existing if o["id"] not in used and o.get("status") != "duplicate"]
    inserted = 0
    if apply:
        for kid, patch in patches:
            safe_update("kills", patch, "id", kid)
        for k in inserts:
            if safe_insert("kills", _kill_payload(k)):
                inserted += 1
        safe_update("games", {"kills_extracted": True}, "id", game["id"])
    rep = {"harvested": len(new), "existing": len(existing), "patched": len(patches),
           "to_insert": len(inserts), "inserted": inserted, "orphans_old": len(orphans),
           "crossed_victims": crossed,
           "patch_detail": [{"id": kid[:8], **p} for kid, p in patches][:30]}
    log.info("reconcile_done", game=game["external_id"], **{k2: v for k2, v in rep.items() if k2 != "patch_detail"})
    return rep


_IGN_CACHE: dict[str, str] | None = None


def _player_igns() -> dict[str, str]:
    global _IGN_CACHE
    if _IGN_CACHE is None:
        rows = safe_select("players", "id,ign", _limit=10000) or []
        _IGN_CACHE = {r["id"]: r["ign"] for r in rows if r.get("id") and r.get("ign")}
    return _IGN_CACHE


# ─── 5. Clip d'un kill depuis la section Twitch ────────────────────────────

def _sequence_start_ms(kill: dict, game_kills: list[dict]) -> int:
    """Début de la série multi-kill qui se termine sur `kill` (même tueur,
    ≤ 10 s entre deux kills, 30 s pour le 5e) — la fenêtre du clip la couvre."""
    same = sorted((k for k in game_kills if k.get("killer_champion") == kill.get("killer_champion")
                   and k.get("event_epoch") and k["event_epoch"] <= kill["event_epoch"]),
                  key=lambda k: k["event_epoch"])
    start = kill["event_epoch"]
    rank = 1
    for prev in reversed(same[:-1] if same and same[-1]["id"] == kill["id"] else same):
        gap = PENTA_GAP_MS if rank == 4 else MULTIKILL_GAP_MS
        if start - prev["event_epoch"] > gap:
            break
        start = prev["event_epoch"]
        rank += 1
    return start


async def clip_one(kill: dict, game: dict, clock: feed_clock.FeedClock, sync: twitch_sync.SectionSync,
                   vod: twitch_vod.TwitchVod, game_kills: list[dict], apply: bool) -> str:
    epoch = int(kill["event_epoch"])
    gt_wall = round((epoch - clock.anchor_ms) / 1000.0)
    ig = int(clock.ingame_seconds(epoch))
    timing = config.CLIP_TIMING.get(kill.get("multi_kill") or "default", config.CLIP_TIMING["default"])
    before, after = int(timing["before"]), int(timing["after"])
    span_s = (epoch - _sequence_start_ms(kill, game_kills)) / 1000.0
    window_override = {"before": max(before, int(span_s) + 12), "after": after} if span_s > before - 12 else None
    ctx = f"Game {game.get('game_number', '?')}  T+{ig // 60:02d}:{ig % 60:02d}"
    if not apply:
        return "dry"
    urls = await clipper.clip_kill(
        kill_id=kill["id"],
        youtube_id=f"twitch_{vod.video_id}",
        vod_offset_seconds=int(round(sync.c or 0)),
        game_time_seconds=int(gt_wall),
        multi_kill=kill.get("multi_kill"),
        killer_champion=kill.get("killer_champion"),
        victim_champion=kill.get("victim_champion"),
        match_context=ctx,
        local_vod_path=sync.path,
        game_id=game["id"],
        window_override=window_override,
    )
    if not urls or not urls.get("clip_url_horizontal"):
        if kill.get("status") != "published":
            safe_update("kills", {"status": "clip_error"}, "id", kill["id"])
        return "clip_fail"
    h_path = urls.pop("_local_h_path", None)
    c_hash, p_hash = urls.pop("content_hash", None), urls.pop("perceptual_hash", None)
    try:
        if h_path:
            dur, aud = await check_media_sanity(h_path)
            if dur.verdict != "pass" or aud.verdict != "pass":
                log.warn("twitch_clip_media_fail", kill=kill["id"][:8], dur=dur.verdict, audio=aud.verdict)
                if kill.get("status") != "published":
                    safe_update("kills", {"status": "needs_review"}, "id", kill["id"])
                return "media_fail"
        # kill_visible de l'ANCIEN clip ne doit pas être passé comme vérité :
        # l'analyzer le transmet à Gemini (« ne pas affirmer le kill »).
        ign = _player_igns()
        row = {**kill, "kill_visible": None,
               "_killer_name_hint": ign.get(kill.get("killer_player_id") or ""),
               "_victim_name_hint": ign.get(kill.get("victim_player_id") or "")}
        result = await analyzer.analyze_kill_row(row, clip_path=h_path)
        base = compute_hype_score(
            multi_kill=kill.get("multi_kill"), is_first_blood=bool(kill.get("is_first_blood")),
            shutdown_bounty=int(kill.get("shutdown_bounty") or 0), game_time_seconds=ig,
            tracked_team_involvement=kill.get("tracked_team_involvement"),
            confidence=kill.get("confidence") or "high",
        )
        patch = dict(urls)
        if result:
            gem = float(result.get("highlight_score") or base)
            patch.update({
                "highlight_score": round(base * 0.4 + gem * 0.6, 1),
                "ai_tags": result.get("tags") or [],
                "ai_description": result.get("description_fr"),
                "kill_visible": bool(result.get("kill_visible_on_screen", True)),
                "caster_hype_level": result.get("caster_hype_level"),
            })
        else:
            patch["highlight_score"] = round(base, 1)
        og_local = og_generator.generate_og_image(
            kill_id=kill["id"],
            killer_name=row["_killer_name_hint"] or ("KC" if kill.get("tracked_team_involvement") == "team_killer" else "Opponent"),
            killer_champion=kill.get("killer_champion") or "?",
            victim_name=row["_victim_name_hint"] or ("Opponent" if kill.get("tracked_team_involvement") == "team_killer" else "KC"),
            victim_champion=kill.get("victim_champion") or "?",
            description=patch.get("ai_description") or kill.get("ai_description") or "",
            rating=float(kill.get("avg_rating") or 0),
            rating_count=int(kill.get("rating_count") or 0),
            multi_kill=kill.get("multi_kill"),
        )
        og_url = await r2_client.upload_og(kill["id"], og_local) if og_local else None
        if og_url:
            patch["og_image_url"] = og_url
        patch["status"] = "published"
        safe_update("kills", patch, "id", kill["id"])
        clipper._best_effort_kill_hashes(kill["id"], c_hash, p_hash)
        return "published" if patch.get("kill_visible", True) else "published_invisible"
    finally:
        if h_path:
            clipper.cleanup_local_clip(h_path)


# ─── Orchestration par game ─────────────────────────────────────────────────

def _targets(kills: list[dict], scope: set[str]) -> list[dict]:
    out = []
    for k in kills:
        st = k.get("status") or ""
        if st == "duplicate" or not k.get("event_epoch"):
            continue
        if "missing" in scope and not k.get("clip_url_vertical") and st in MISSING_STATUSES:
            out.append(k)
        elif "invisible" in scope and st == "published" and k.get("kill_visible") is False:
            out.append(k)
        elif "review" in scope and st in REVIEW_STATUSES:
            out.append(k)
    return sorted(out, key=lambda k: k["event_epoch"])


async def process_game(game: dict, args, report: dict) -> None:
    gext = game["external_id"]
    grep: dict = {"game": gext, "game_number": game.get("game_number")}
    report["games"].append(grep)
    if args.rescan or not game.get("kills_extracted"):
        grep["reconcile"] = await reconcile_game(game, apply=args.apply)
    clock = await feed_clock.get_clock(gext)
    if not clock:
        grep["error"] = "pas d'horloge feed"
        return
    grep["pauses_s"] = round(clock.total_paused_s)
    kills = safe_select("kills", KILL_COLS, game_id=game["id"]) or []
    scope = set(args.scope.split(","))
    targets = _targets(kills, scope)
    grep["targets"] = len(targets)
    if not targets:
        return
    vod = await twitch_vod.find_vod_for_epoch(clock.anchor_ms, channel=args.channel)
    if not vod:
        grep["error"] = "aucune VOD Twitch ne couvre la game"
        return
    anchor_pos = vod.position_of(clock.anchor_ms / 1000.0)
    last_epoch = clock.end_ms or max(k["event_epoch"] for k in kills) + 60_000
    start = max(0.0, anchor_pos - SECTION_MARGIN_S)
    end = min(float(vod.duration_s), vod.position_of(last_epoch / 1000.0) + SECTION_MARGIN_S)
    section = os.path.join(LocalPaths.vods_dir(), f"twitch_{vod.video_id}_{gext}.mp4")
    grep["vod"] = {"id": vod.video_id, "title": vod.title, "section": [round(start), round(end)]}
    if not args.apply and not args.calibrate:
        grep["plan"] = [{"id": k["id"][:8], "status": k["status"], "visible": k.get("kill_visible"),
                         "kill": f"{k.get('killer_champion')}>{k.get('victim_champion')}", "multi": k.get("multi_kill")}
                        for k in targets]
        return
    if not await twitch_vod.download_section(vod.video_id, start, end, section):
        grep["error"] = "téléchargement de la section échoué"
        return
    sync = await twitch_sync.calibrate_section(section, clock, guess_c=anchor_pos - start,
                                               tmp_dir=os.path.join(REPORT_DIR, "tmp"))
    grep["sync"] = sync.to_json()
    with open(section + ".sync.json", "w", encoding="utf-8") as f:
        json.dump({"vod": vod.__dict__, "section_start_s": start, "clock": clock.to_json(), **sync.to_json()}, f, indent=1)
    if not sync.ok:
        grep["error"] = f"calibration refusée : {sync.reason}"
        return
    if args.calibrate and not args.apply:
        return
    outcomes: dict[str, int] = {}
    t0 = time.time()
    for i, k in enumerate(targets, 1):
        try:
            res = await clip_one(k, game, clock, sync, vod, kills, apply=args.apply)
        except Exception as e:   # un kill raté ne bloque jamais la game
            log.error("twitch_clip_exception", kill=k["id"][:8], error=str(e)[:200])
            res = "exception"
        outcomes[res] = outcomes.get(res, 0) + 1
        log.info("twitch_kill_done", game=gext, n=f"{i}/{len(targets)}", kill=k["id"][:8], result=res,
                 elapsed_s=round(time.time() - t0))
    grep["outcomes"] = outcomes


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--match", default="", help="ids lolesports séparés par des virgules")
    ap.add_argument("--summer", action="store_true", help="les 12 séries KC du Summer 2026")
    ap.add_argument("--games", default="", help="numéros de game à traiter (ex : 3,4)")
    ap.add_argument("--scope", default="missing,invisible,review")
    ap.add_argument("--rescan", action="store_true", help="réconcilie aussi les games déjà extraites")
    ap.add_argument("--calibrate", action="store_true", help="télécharge + calibre sans clipper")
    ap.add_argument("--apply", action="store_true", help="écrit en base / R2 (défaut : plan seulement)")
    ap.add_argument("--channel", default=twitch_vod.DEFAULT_CHANNEL)
    args = ap.parse_args()
    matches = SUMMER_2026 if args.summer else [m for m in args.match.split(",") if m]
    only_games = {int(x) for x in args.games.split(",") if x}
    os.makedirs(REPORT_DIR, exist_ok=True)
    report = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "apply": args.apply, "matches": []}
    for mext in matches:
        mrep: dict = {"match": mext, "games": [], "errors": []}
        report["matches"].append(mrep)
        match_id, games = await pipeline.upsert_match_and_games(mext, mrep)
        if not match_id:
            mrep["error"] = "match introuvable"
            continue
        for game in sorted(games, key=lambda g: int(g.get("game_number") or 0)):
            if only_games and int(game.get("game_number") or 0) not in only_games:
                continue
            if "kills_extracted" not in game:
                row = safe_select("games", "id,external_id,game_number,kills_extracted", id=game["id"]) or [game]
                game = {**game, **row[0]}
            try:
                await process_game(game, args, mrep)
            except Exception as e:
                log.error("twitch_game_exception", game=game.get("external_id"), error=str(e)[:300])
                mrep["games"].append({"game": game.get("external_id"), "error": str(e)[:300]})
        path = os.path.join(REPORT_DIR, f"report_{time.strftime('%Y%m%d_%H%M%S')}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1)[:6000])


if __name__ == "__main__":
    asyncio.run(main())
