"""
VOD_OFFSET_FINDER_V2 — Improved offset detection with multi-candidate scan.

Replaces the v1 heuristic-only approach (which bailed instantly when
Gemini returned NONE for the in-game timer at the first candidate
offset) with a smarter scan strategy :

  1. Compute an INITIAL candidate via the v1 epoch heuristic.
  2. If Gemini reads a valid timer at candidate+60s : adjust by drift
     (same as v1) and accept.
  3. If Gemini sees NONE (intro, draft, panel, ad) : SCAN forward in
     90-second steps up to +30min, looking for ANY frame with a
     readable LoL timer.
  4. The first frame with a valid timer gives us the absolute offset
     (vod_seconds_at_that_frame - timer_at_that_frame = game_start_in_vod).
  5. PATCH games.vod_offset_seconds with the discovered value.
  6. Reset stuck kills back to status='vod_found' so the clipper retries.

Why this matters : for LEC VODs the broadcast usually starts with
~5–15 minutes of pregame analysis / draft chat before the game itself.
The v1 heuristic anchors to "end of upload day - duration" which puts
the candidate squarely in the pregame segment, where Gemini correctly
reports NONE. v2 scans past the pregame to find the real game start.

Per-cycle budget : 5 games × ~5 candidate frames × 1 Gemini call =
~25 RPD, still well within the 950-RPD budget.
"""

from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime, timezone
from typing import Optional

import httpx
import structlog

from config import config
from scheduler import scheduler
from services.observability import run_logged
from services.supabase_client import get_db, safe_update
from services import livestats_api, youtube_cookies

log = structlog.get_logger()


GAMES_PER_RUN = 5
TARGET_GAME_TIME = 60          # validate at offset + 60s
ACCEPT_DRIFT = 10              # +/- 10s tolerance once we found a frame
SCAN_STEP_SECONDS = 90         # scan stride when searching for gameplay
SCAN_MAX_OFFSET_FROM_HEURISTIC = 30 * 60   # search up to 30 min past heuristic


def _fetch_pending_games(limit: int) -> list[dict]:
    db = get_db()
    if db is None:
        return []
    try:
        r = httpx.get(
            f"{db.base}/games",
            headers=db.headers,
            params={
                "select": "id,external_id,vod_youtube_id,duration_seconds",
                "vod_offset_seconds": "is.null",
                "vod_youtube_id": "not.is.null",
                "limit": str(limit),
            },
            timeout=20.0,
        )
        r.raise_for_status()
        return r.json() or []
    except Exception as e:
        log.warn("vof2_fetch_failed", error=str(e)[:120])
        return []


async def _game_start_epoch(external_id: str) -> Optional[int]:
    data = await livestats_api.get_window(external_id)
    if not data:
        return None
    frames = data.get("frames") or []
    if not frames:
        return None
    ts = frames[0].get("rfc460Timestamp")
    if not ts:
        return None
    try:
        cleaned = ts.replace("Z", "+00:00")
        return int(datetime.fromisoformat(cleaned).timestamp())
    except Exception:
        return None


async def _vod_metadata(youtube_id: str) -> Optional[dict]:
    if not await scheduler.wait_for("ytdlp"):
        return None
    try:
        result = subprocess.run(
            [
                __import__("sys").executable, "-m", "yt_dlp",
                *youtube_cookies.cli_args(),
                "--js-runtimes", "node",
                "--dump-json", "--no-playlist", "--skip-download",
                f"https://youtu.be/{youtube_id}",
            ],
            capture_output=True, text=True, timeout=45,
        )
        if result.returncode != 0:
            return None
        import json
        meta = json.loads(result.stdout)
        return {
            "upload_date": meta.get("upload_date"),
            "duration": int(meta.get("duration") or 0),
        }
    except Exception:
        return None


def _initial_candidate(game_epoch: int, meta: dict) -> Optional[int]:
    ud = meta.get("upload_date")
    duration = meta.get("duration") or 0
    if not ud or duration <= 0:
        return None
    try:
        day = datetime.strptime(ud, "%Y%m%d").replace(tzinfo=timezone.utc)
        end_of_day = day.timestamp() + 86399
        vod_start = int(end_of_day - duration)
        return max(0, game_epoch - vod_start)
    except Exception:
        return None


async def _read_timer_at(youtube_id: str, vod_seconds: int) -> Optional[int]:
    """Returns in-game seconds parsed from the LoL HUD timer at
    vod_seconds, or None if unreadable / not gameplay."""
    tmp_dir = getattr(config, "CLIPS_DIR", None) or os.path.join(
        os.path.dirname(__file__), "..", "clips"
    )
    os.makedirs(tmp_dir, exist_ok=True)
    frame_path = os.path.join(tmp_dir, f"vof2_{youtube_id}_{vod_seconds}.jpg")
    try:
        if not await scheduler.wait_for("ytdlp"):
            return None
        url_proc = subprocess.run(
            [
                __import__("sys").executable, "-m", "yt_dlp",
                *youtube_cookies.cli_args(),
                "--js-runtimes", "node",
                "-g", "-f", "best[height<=720]",
                "--no-playlist", f"https://youtu.be/{youtube_id}",
            ],
            capture_output=True, text=True, timeout=30,
        )
        if url_proc.returncode != 0:
            return None
        media_url = url_proc.stdout.strip().splitlines()[0]

        ff = subprocess.run(
            [
                "ffmpeg", "-y", "-ss", str(vod_seconds), "-i", media_url,
                "-frames:v", "1", "-q:v", "2",
                "-vf", "scale=1920:-1", frame_path,
            ],
            capture_output=True, timeout=45,
        )
        if ff.returncode != 0 or not os.path.exists(frame_path):
            return None

        if not await scheduler.wait_for("gemini"):
            return None

        import google.generativeai as genai  # type: ignore
        from services.gemini_client import _wait_for_file_active
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel(config.GEMINI_MODEL_OFFSET)
        img = genai.upload_file(frame_path)
        _wait_for_file_active(genai, img, timeout=30)
        resp = model.generate_content([
            "Read the in-game League of Legends timer at the top center "
            "of the screen. Reply ONLY with MM:SS. If no LoL game is "
            "visible (interview, draft, panel, replay menu, ad), reply NONE.",
            img,
        ])
        text = (resp.text or "").strip()
        m = re.match(r"(\d+):(\d+)", text)
        if not m:
            return None
        return int(m.group(1)) * 60 + int(m.group(2))
    except Exception as e:
        log.warn("vof2_read_timer_error", yt=youtube_id, error=str(e)[:120])
        return None
    finally:
        if os.path.exists(frame_path):
            try:
                os.remove(frame_path)
            except OSError:
                pass


async def _scan_for_gameplay(
    youtube_id: str,
    initial_candidate: int,
    max_seconds_ahead: int,
) -> Optional[int]:
    """Walk forward from the heuristic candidate in SCAN_STEP_SECONDS
    increments, asking Gemini to read the timer each step. The first
    valid reading gives us the absolute game-start offset via
    `game_start_offset = vod_seconds - timer_at_that_vod_seconds`.
    """
    scanned = 0
    probe = initial_candidate
    while scanned <= max_seconds_ahead:
        timer = await _read_timer_at(youtube_id, probe)
        if timer is not None and timer >= 0:
            # Found gameplay! Compute the true offset.
            true_offset = max(0, probe - timer)
            log.info(
                "vof2_scan_hit",
                yt=youtube_id, probe_vod_s=probe,
                timer_in_game_s=timer, derived_offset=true_offset,
                scanned_s=scanned,
            )
            return true_offset
        log.info("vof2_scan_miss", yt=youtube_id, vod_s=probe, scanned_s=scanned)
        probe += SCAN_STEP_SECONDS
        scanned += SCAN_STEP_SECONDS
    return None


async def _process_game(game: dict) -> bool:
    gid = game["id"]
    ext = game.get("external_id") or ""
    yt = game.get("vod_youtube_id")
    if not ext or not yt:
        return False

    short = gid[:8]
    log.info("vof2_start", game_id=short, yt=yt)

    # Stage A : try v1 heuristic first (cheap)
    game_epoch = await _game_start_epoch(ext)
    if not game_epoch:
        log.info("vof2_no_livestats", game_id=short)
        # Even without livestats we can still scan from offset 0
        # (this catches old games where the live feed expired but the
        # VOD is still up). Use a broad scan window.
        offset = await _scan_for_gameplay(yt, 0, 90 * 60)  # scan up to 90 min
        if offset is None:
            log.warn("vof2_scan_failed_no_livestats", game_id=short)
            return False
    else:
        meta = await _vod_metadata(yt)
        if not meta:
            log.info("vof2_no_meta", game_id=short, yt=yt)
            return False
        candidate = _initial_candidate(game_epoch, meta)
        if candidate is None:
            return False

        # Try the heuristic candidate first — works for many recent LEC games
        timer = await _read_timer_at(yt, candidate + TARGET_GAME_TIME)
        if timer is not None:
            drift = timer - TARGET_GAME_TIME
            if abs(drift) <= ACCEPT_DRIFT:
                offset = candidate
                log.info("vof2_heuristic_hit",
                         game_id=short, offset=offset, drift=drift)
            else:
                # Adjust once
                adjusted = max(0, candidate + drift)
                timer2 = await _read_timer_at(yt, adjusted + TARGET_GAME_TIME)
                if timer2 is not None and abs(timer2 - TARGET_GAME_TIME) <= ACCEPT_DRIFT:
                    offset = adjusted
                    log.info("vof2_heuristic_adjusted",
                             game_id=short, offset=offset)
                else:
                    log.info("vof2_heuristic_no_converge_falling_back_to_scan",
                             game_id=short)
                    offset = await _scan_for_gameplay(yt, candidate, SCAN_MAX_OFFSET_FROM_HEURISTIC)
        else:
            # Heuristic frame is in pregame/intro — scan forward
            log.info("vof2_heuristic_in_pregame_scanning", game_id=short)
            offset = await _scan_for_gameplay(yt, candidate, SCAN_MAX_OFFSET_FROM_HEURISTIC)

        if offset is None:
            log.warn("vof2_no_offset_found", game_id=short)
            return False

    # Persist the offset
    if not safe_update("games", {"vod_offset_seconds": offset}, "id", gid):
        log.warn("vof2_db_update_failed", game_id=short)
        return False

    # Reset stuck kills for this game so the clipper retries
    db = get_db()
    if db is not None:
        try:
            httpx.patch(
                f"{db.base}/kills",
                headers={**db.headers, "Prefer": "return=minimal"},
                params={
                    "game_id": f"eq.{gid}",
                    "status": "in.(clip_error,analyzed)",
                },
                json={"status": "vod_found", "retry_count": 0, "needs_reclip": False},
                timeout=20.0,
            )
            log.info("vof2_kills_reset", game_id=short)
        except Exception as e:
            log.warn("vof2_kills_reset_failed", game_id=short, error=str(e)[:120])

    log.info("vof2_done", game_id=short, offset=offset)
    return True


@run_logged()
async def run() -> int:
    games = _fetch_pending_games(GAMES_PER_RUN)
    if not games:
        log.info("vof2_no_pending")
        return 0

    fixed = 0
    for game in games:
        try:
            if await _process_game(game):
                fixed += 1
        except Exception as e:
            log.error(
                "vof2_unhandled_error",
                game_id=str(game.get("id", ""))[:8], error=str(e)[:200],
            )
    log.info("vof2_run_done", processed=len(games), fixed=fixed)
    return fixed
