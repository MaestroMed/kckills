"""Pilote QC v3 sur une game : E1 → E4, sans IA payante, sans écrire en base.

    python -m qc3.pilot --game <uuid games> --video <fichier> [--origin S] [--prior-offset S]
                        [--kills kc|quarantine|all] [--profile ewc26] [--limit N]

  1. E1 chronologie du feed (cache disque), appariement avec les kills en base
     (même tueur / même victime, epoch le plus proche à ±15 s) : écart mesuré.
  2. E2 ancre de la game dans la vidéo (3 lectures locales du chrono).
  3. Pour chaque kill retenu : fenêtre depuis le début du combat (PV), clip
     16:9 coupé dans le fichier local, E3 verdict (chrono à l'instant du kill).
  4. E4 titre écrit depuis les données.
Sortie : <LocalPaths data>/qc3/pilot/<game>/ (rapport.json + clips).

`--origin` : position de la VOD au début du fichier (section téléchargée).
`--prior-offset` : position ≈ prior + chrono (sinon games.vod_offset_seconds).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
from collections import Counter

from engine_v2.chrono import ChronoReader
from qc3 import sync as S
from qc3 import titles as T
from qc3.timeline import CACHE_DIR, KillMoment, Timeline, load_timeline
from qc3.verify import verify_clip

OUT_ROOT = os.path.join(os.path.dirname(CACHE_DIR), "pilot")
MATCH_TOL_MS = 15_000

# Fenêtre d'un clip (secondes de VOD autour de l'instant du kill dans le feed).
SCREEN_LEAD_S = 3.0     # le kill est à l'écran ~3 s avant l'instant du feed (pilote E0, G4/G5)
MIN_BEFORE_S = 8.0
MAX_BEFORE_S = 25.0
AFTER_S = 5.0


def match_db_kills(tl: Timeline, db_kills: list[dict]) -> list[tuple[dict, KillMoment | None]]:
    used: set[int] = set()
    out = []
    for d in sorted(db_kills, key=lambda x: x.get("event_epoch") or 0):
        cands = [k for k in tl.kills if id(k) not in used
                 and k.killer_champion == d.get("killer_champion")
                 and k.victim_champion == d.get("victim_champion")
                 and abs(k.epoch_ms - int(d.get("event_epoch") or 0)) <= MATCH_TOL_MS]
        k = min(cands, key=lambda k: abs(k.epoch_ms - int(d["event_epoch"]))) if cands else None
        if k:
            used.add(id(k))
        out.append((d, k))
    return out


def clip_window(k: KillMoment, vs: S.VodSync) -> tuple[float, float, float]:
    """(début, fin, position du kill dans le clip) en secondes de VOD."""
    kill_pos = vs.pos(k.epoch_ms)
    before = MIN_BEFORE_S
    if k.fight_start_ms:
        before = min(MAX_BEFORE_S, max(before, (k.epoch_ms - k.fight_start_ms) / 1000.0 + 2.0))
    start = kill_pos - SCREEN_LEAD_S - before
    end = kill_pos + AFTER_S
    return start, end, kill_pos - start


def cut(video: str, origin: float, start: float, end: float, out: str) -> bool:
    if os.path.exists(out):
        return True
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{start - origin:.2f}", "-i", video,
                        "-t", f"{end - start:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out],
                       capture_output=True, timeout=300)
    return r.returncode == 0 and os.path.exists(out)


async def run(game_id: str, video: str, origin: float, prior_offset: float | None,
              kills_filter: str, profile: str, limit: int | None, hud_profile: str = "worlds26") -> dict:
    from services.supabase_client import safe_select

    game = safe_select("games", "id,external_id,game_number,vod_youtube_id,vod_offset_seconds", id=game_id)[0]
    tl = await load_timeline(game["external_id"])
    if tl is None:
        raise SystemExit("feed indisponible")
    db = [k for k in safe_select("kills", "id,event_epoch,game_time_seconds,killer_champion,victim_champion,"
                                 "status,publication_status,needs_reclip,reclip_reason,tracked_team_involvement",
                                 game_id=game_id, _limit=500) or [] if k.get("status") != "duplicate"]
    pairs = match_db_kills(tl, db)
    deltas = [round((d["event_epoch"] - k.epoch_ms) / 1000, 2) for d, k in pairs if k]

    base = prior_offset if prior_offset is not None else game.get("vod_offset_seconds")
    if base is None:
        raise SystemExit("ni --prior-offset ni games.vod_offset_seconds")
    src = S.LocalVideo(video, origin)
    reader = ChronoReader(profile)
    vs = S.measure(tl, src, reader, prior_pos=lambda e: base + tl.chrono_at(e))
    src.close()

    out_dir = os.path.join(OUT_ROOT, game_id)
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    targets = [(d, k) for d, k in pairs if k]
    if kills_filter == "kc":
        targets = [(d, k) for d, k in targets if d.get("tracked_team_involvement")]
    elif kills_filter == "quarantine":
        targets = [(d, k) for d, k in targets if d.get("status") == "needs_review"]
    if limit:
        targets = targets[:limit]
    for d, k in targets:
        row = {"kill_id": d["id"], "status": d["status"], "chrono": mmss(k.chrono_s),
               "db_minus_feed_s": round((d["event_epoch"] - k.epoch_ms) / 1000, 2),
               "title": T.title(tl, k), "multi_kill": k.multi_kill,
               "fight_s": round((k.epoch_ms - k.fight_start_ms) / 1000, 1) if k.fight_start_ms else None}
        if vs.status == "ok":
            start, end, kill_t = clip_window(k, vs)
            out = os.path.join(out_dir, f"{d['id'][:8]}_{int(k.chrono_s)}.mp4")
            if cut(video, origin, start, end, out):
                slot = None
                if k.victim_pid and k.victim_side:
                    slot = (0 if k.victim_side == "blue" else 5) + (int(k.victim_pid) - 1) % 5
                v = verify_clip(out, kill_t, k.chrono_s, reader, victim_slot=slot, hud_profile=hud_profile)
                row.update({"clip": out, "window": [round(start, 1), round(end, 1)], "verdict": v.verdict,
                            "timer_hits": v.timer_hits, "hud_delta_s": v.hud_delta_s, "detail": v.detail})
            else:
                row["verdict"] = "cut_failed"
        rows.append(row)

    report = {
        "game": game_id, "external_id": game["external_id"], "video": video, "origin": origin,
        "timeline": {"frames": len(tl.frames), "kills": len(tl.kills), "pauses": tl.clock.pauses,
                     "finished": tl.finished},
        "db_kills": len(db), "matched": len(deltas), "unmatched": len(pairs) - len(deltas),
        "db_minus_feed_s": {"min": min(deltas, default=None), "max": max(deltas, default=None),
                            "abs_over_1s": sum(1 for x in deltas if abs(x) > 1)},
        "sync": vs.to_json(),
        "verdicts": dict(Counter(r.get("verdict") for r in rows)),
        "rows": rows,
    }
    with open(os.path.join(out_dir, "rapport.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    return report


def mmss(s: float) -> str:
    return T.mmss(s)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--origin", type=float, default=0.0)
    ap.add_argument("--prior-offset", type=float, default=None)
    ap.add_argument("--kills", choices=["kc", "quarantine", "all"], default="kc")
    ap.add_argument("--profile", default="worlds26_row")
    ap.add_argument("--hud", default="worlds26")
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    rep = asyncio.run(run(a.game, a.video, a.origin, a.prior_offset, a.kills, a.profile, a.limit, a.hud))
    print(json.dumps({k: v for k, v in rep.items() if k != "rows"}, ensure_ascii=False, indent=1))
    for r in rep["rows"]:
        print(f"  {r['chrono']:>6} {r.get('verdict', '-'):10} hits={r.get('timer_hits', '-')} hud={r.get('hud_delta_s')} "
              f"Δbase={r['db_minus_feed_s']:+.1f}s  {r['title']}")
