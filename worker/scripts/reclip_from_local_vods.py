"""reclip_from_local_vods.py — clip pending gol.gg kills from LOCAL VOD files.

Workaround for the YouTube IP bot-block: Mehdi downloads the VODs himself
(notube) and drops them in VODS_DIR as `{youtube_id}.mp4`. This script scans
that folder and clips every pending kill of every game whose VOD is present
locally — ffmpeg reads the local file, so ZERO YouTube access. Once clipped,
the daemon's analyzer + publisher (which don't touch YouTube) finish the job.

Only games with a KNOWN vod_offset_seconds are clipped (clip start =
offset + kill.game_time). Games with offset NULL are listed for manual
calibration (their VOD-only offset couldn't be derived without YouTube).

Usage:
  python scripts/reclip_from_local_vods.py --dry-run     # what would clip
  python scripts/reclip_from_local_vods.py               # clip it
  python scripts/reclip_from_local_vods.py --concurrency 3
"""
from __future__ import annotations

import argparse
import asyncio
import glob
import os
import sys
from pathlib import Path

_WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_WORKER_ROOT))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from dotenv import load_dotenv  # noqa: E402
load_dotenv(_WORKER_ROOT / ".env")

import httpx  # noqa: E402
from modules.clipper import clip_kill, VODS_DIR  # noqa: E402
from services.supabase_client import get_db  # noqa: E402


def _present_youtube_ids() -> list[str]:
    ids = []
    for p in glob.glob(os.path.join(VODS_DIR, "*.mp4")):
        yid = os.path.splitext(os.path.basename(p))[0]
        if yid:
            ids.append(yid)
    return ids


def _games_for_vod(db, yid: str) -> list[dict]:
    r = httpx.get(f"{db.base}/games", headers=db.headers, params={
        "select": "id,vod_youtube_id,vod_offset_seconds,external_id",
        "data_source": "eq.gol_gg", "vod_youtube_id": f"eq.{yid}"}, timeout=30)
    r.raise_for_status()
    return r.json() or []


def _pending_kills(db, game_id: str) -> list[dict]:
    r = httpx.get(f"{db.base}/kills", headers=db.headers, params={
        "select": "id,game_time_seconds,multi_kill,killer_champion,victim_champion",
        "game_id": f"eq.{game_id}", "data_source": "eq.gol_gg",
        "status": "in.(raw,enriched,clip_error)",
        "game_time_seconds": "not.is.null", "limit": "500"}, timeout=30)
    r.raise_for_status()
    return r.json() or []


def _set_clipped(db, kill_id: str) -> bool:
    """clip_kill() produces the clip + assets but leaves kills.status alone —
    the daemon's clipper LOOP is what flips it to 'clipped'. We bypass that
    loop, so set it here; the job_dispatcher then bridges clipped ->
    clip.analyze -> published, all off the R2 clip (no YouTube)."""
    try:
        r = httpx.patch(
            f"{db.base}/kills",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{kill_id}"},
            json={"status": "clipped", "retry_count": 0}, timeout=15.0,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--concurrency", type=int, default=3)
    args = ap.parse_args()

    db = get_db()
    if db is None:
        print("FATAL: Supabase env manquant"); return

    print(f"VODS_DIR = {VODS_DIR}")
    ids = _present_youtube_ids()
    print(f"fichiers VOD présents en local : {len(ids)}")
    if not ids:
        print("  (dépose des {youtube_id}.mp4 dans le dossier ci-dessus)")
        return

    todo = []          # (kill, youtube_id, offset, path)
    skipped_null = []  # games offset NULL (calibration manuelle)
    for yid in ids:
        path = os.path.join(VODS_DIR, f"{yid}.mp4")
        for g in _games_for_vod(db, yid):
            if g.get("vod_offset_seconds") is None:
                skipped_null.append(g["external_id"])
                continue
            for k in _pending_kills(db, g["id"]):
                todo.append((k, yid, int(g["vod_offset_seconds"]), path, g["id"]))

    print(f"kills à clipper (offset connu) : {len(todo)}")
    if skipped_null:
        print(f"games offset NULL (je calibre à la main) : {len(set(skipped_null))} "
              f"→ {sorted(set(skipped_null))[:8]}...")
    if args.dry_run:
        print("(dry-run — aucun clip)")
        return

    sem = asyncio.Semaphore(max(1, args.concurrency))
    done = {"ok": 0, "fail": 0}

    async def one(k, yid, off, path, gid):
        async with sem:
            try:
                res = await clip_kill(
                    kill_id=k["id"], youtube_id=yid,
                    vod_offset_seconds=off, game_time_seconds=int(k["game_time_seconds"]),
                    multi_kill=k.get("multi_kill"), killer_champion=k.get("killer_champion"),
                    victim_champion=k.get("victim_champion"),
                    local_vod_path=path, game_id=gid)
                if res:
                    await asyncio.to_thread(_set_clipped, db, k["id"])
                    done["ok"] += 1
                else:
                    done["fail"] += 1
            except Exception as e:
                done["fail"] += 1
                print(f"  [err] {k['id'][:8]}: {str(e)[:100]}")
            n = done["ok"] + done["fail"]
            if n % 20 == 0:
                print(f"  [progress] {n}/{len(todo)} ok={done['ok']} fail={done['fail']}")

    await asyncio.gather(*[one(*t) for t in todo])
    print(f"\nBILAN: clippés={done['ok']} échecs={done['fail']} sur {len(todo)}")


if __name__ == "__main__":
    asyncio.run(main())
