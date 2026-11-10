"""QC3_SYNC — ancre VOD de chaque game, lue en local (0 jeton). Remplace vod_offset_finder_v2.

vof2 balayait la VOD par pas de 90 s en lisant le chrono avec Gemini, toutes
les heures, sur les mêmes games, sans mémoire des échecs (audit du 21/10).
Ici (worker/qc3, rétro-ingénierie du 21/10/2026) :
  * la chronologie du feed (qc3.timeline, cache disque) donne le temps réel
    de chaque instant de la game ;
  * position VOD = ancre + temps réel depuis la 1re frame du feed : c'est
    exactement ce qu'attend le clipper (vod_offset_seconds + wall_seconds) ;
  * l'ancre se lit avec 3 chronos lus en local sur le flux (ffmpeg -ss sur
    l'URL directe, pas de téléchargement), qui doivent concorder à 1,5 s.

Au plus MAX_ATTEMPTS essais par game, puis abandon motivé (état local
qc3_sync_state.json) : jamais de boucle sans fin.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import httpx
import structlog

from engine_v2.chrono import ChronoReader
from qc3 import sync as S
from qc3.timeline import CACHE_DIR, load_timeline
from services import youtube_cookies
from services.observability import run_logged
from services.supabase_client import get_db, safe_update
from services.vod_offset import FRAME_STREAM_FORMAT

log = structlog.get_logger()

GAMES_PER_RUN = 3
MAX_ATTEMPTS = 3
RETRY_AFTER_S = 6 * 3600
DRAFT_GUESS_S = 330              # segment getEventDetails → 1re frame du feed (draft + chargement)
WIDE_STEPS = tuple(s for d in range(0, 301, 10) for s in ((d, -d) if d else (0,)))
CHRONO_PROFILES = ("worlds26_row", "ewc26")
STATE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "qc3_sync_state.json")
SYNC_DIR = os.path.join(os.path.dirname(CACHE_DIR), "sync")


def _state() -> dict:
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(st: dict) -> None:
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)


def _pending_games(limit: int) -> list[dict]:
    db = get_db()
    if db is None:
        return []
    try:
        r = httpx.get(f"{db.base}/games", headers=db.headers, timeout=20.0, params={
            "select": "id,external_id,match_id,game_number,vod_youtube_id",
            "vod_offset_seconds": "is.null", "vod_youtube_id": "not.is.null",
            "kills_extracted": "is.true", "order": "created_at.desc", "limit": str(limit * 5)})
        r.raise_for_status()
        return r.json() or []
    except Exception as e:
        log.warn("qc3_sync_fetch_failed", error=str(e)[:120])
        return []


def _stream_url(yt: str) -> str | None:
    try:
        p = subprocess.run([sys.executable, "-m", "yt_dlp", *youtube_cookies.cli_args(), "--js-runtimes", "node",
                            "-g", "-f", FRAME_STREAM_FORMAT, "--no-playlist", f"https://youtu.be/{yt}"],
                           capture_output=True, text=True, timeout=60)
        return p.stdout.strip().splitlines()[0] if p.returncode == 0 and p.stdout.strip() else None
    except Exception:
        return None


async def _segment_start(game: dict) -> float | None:
    """Début du segment de la game dans sa VOD (getEventDetails startMillis)."""
    from modules.vod_offset_finder_v2 import _api_segment
    seg = await _api_segment(game)
    return float(seg[0]) if seg else None


async def sync_game(game: dict) -> tuple[str, float | None]:
    tl = await load_timeline(game["external_id"])
    if tl is None or not tl.kills:
        return "no_feed", None
    seg = await _segment_start(game)
    if seg is None:
        return "no_segment", None
    url = _stream_url(game["vod_youtube_id"])
    if not url:
        return "no_stream", None
    src = S.RemoteStream(url)
    old = S.SEARCH_STEPS
    try:
        S.SEARCH_STEPS = WIDE_STEPS
        for profile in CHRONO_PROFILES:
            reader = ChronoReader(profile)
            if not reader.calibrated:
                continue
            vs = S.measure(tl, src, reader, prior_pos=lambda e: seg + DRAFT_GUESS_S + tl.chrono_at(e))
            os.makedirs(SYNC_DIR, exist_ok=True)
            with open(os.path.join(SYNC_DIR, f"{game['id']}.json"), "w", encoding="utf-8") as f:
                json.dump({"profile": profile, **vs.to_json()}, f, indent=1)
            if vs.status == "ok":
                return "ok", vs.anchor_s
            if vs.status == "inconsistent":
                return "inconsistent", None
        return "unreadable", None
    finally:
        S.SEARCH_STEPS = old


@run_logged()
async def run() -> int:
    st = _state()
    now = time.time()
    todo = []
    for g in _pending_games(GAMES_PER_RUN):
        s = st.get(g["id"], {})
        if s.get("attempts", 0) >= MAX_ATTEMPTS or now - s.get("last", 0) < RETRY_AFTER_S:
            continue
        todo.append(g)
        if len(todo) >= GAMES_PER_RUN:
            break
    if not todo:
        log.info("qc3_sync_nothing")
        return 0
    done = 0
    for g in todo:
        try:
            status, anchor = await sync_game(g)
        except Exception as e:
            status, anchor = f"error:{type(e).__name__}", None
        s = st.setdefault(g["id"], {"attempts": 0})
        s.update({"attempts": s["attempts"] + 1, "last": now, "status": status})
        if status == "ok" and anchor is not None:
            from modules.vod_offset_finder_v2 import _offset_collides
            offset = int(round(anchor))
            if _offset_collides(g, offset):
                s["status"] = "shared_offset"
            elif safe_update("games", {"vod_offset_seconds": offset}, "id", g["id"]):
                s["offset"] = offset
                done += 1
        log.info("qc3_sync_game", game_id=g["id"][:8], status=s["status"], anchor=anchor, attempts=s["attempts"])
    _save_state(st)
    return done
