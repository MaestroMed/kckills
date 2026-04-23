"""
VOD_OFFSET_FINDER — Recover the per-game `vod_offset_seconds` for games
where the lolesports API never returned an offset (91 of 94 games at
the time of writing). Without this column the clipper produces clips
that show interview/draft content instead of gameplay.

Algorithm per game (cap GAMES_PER_RUN per cycle to spare Gemini quota):

    1. Fetch live stats `window/{external_id}` — the first frame's
       `rfc460Timestamp` is the wall-clock UTC time the game STARTED.
    2. Fetch yt-dlp `--dump-json` metadata for the VOD — `upload_date`
       (YYYYMMDD) + `duration` give us an upper bound on when the VOD
       started broadcasting.  Estimate :
           vod_start_epoch ≈ vod_upload_epoch_end_of_day - duration
       Then candidate offset = max(0, game_start_epoch - vod_start_epoch).
    3. Validate via Gemini : extract a frame at `offset + 60s`, ask for
       the in-game timer.  Accept if timer ∈ [00:50, 01:10].  If far
       off, adjust by drift and retry ONCE.
    4. PATCH games.vod_offset_seconds.
    5. Reset stuck kills (status='analyzed', needs_reclip=true) back to
       status='vod_found' so the clipper re-runs them with the fix.

Idempotent : only touches games where vod_offset_seconds IS NULL.
Daemon-compatible : exposes `async def run() -> int`.
"""

from __future__ import annotations

import os
import re
import subprocess
import json
from datetime import datetime, timezone

import httpx
import structlog

from config import config
from scheduler import scheduler
from services.supabase_client import get_db, safe_update
from services import livestats_api

log = structlog.get_logger()

# Per-cycle budget. 5 games × 1-2 Gemini calls ≈ 10 RPD ; with hourly
# daemon interval this drains a 91-game backlog over ~24h while
# leaving ~940 RPD of Gemini headroom for the rest of the pipeline.
GAMES_PER_RUN = 5

# Validation window : a frame extracted at offset+60s should show the
# in-game timer between 00:50 and 01:10. Anything outside that is drift
# we either correct (one retry) or give up on.
TARGET_GAME_TIME = 60          # seconds
ACCEPT_DRIFT = 10              # seconds tolerance around target
MAX_VALIDATION_RETRIES = 1     # one corrective re-try after the first
                               # estimate, then accept-or-skip


# --------------------------------------------------------------------------
# Supabase helpers — `safe_select` only supports eq filters, so we fall
# back to a raw PostgREST GET for the `is.null` / `not.is.null` clause.
# --------------------------------------------------------------------------

def _fetch_pending_games(limit: int) -> list[dict]:
    """Games with a YouTube VOD but no offset yet."""
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
        log.warn("vod_offset_finder_fetch_failed", error=str(e)[:120])
        return []


def _fetch_stuck_kills(game_id: str) -> list[dict]:
    """Kills that were quarantined waiting for a real offset."""
    db = get_db()
    if db is None:
        return []
    try:
        r = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={
                "select": "id",
                "game_id": f"eq.{game_id}",
                "status": "eq.analyzed",
                "needs_reclip": "eq.true",
            },
            timeout=20.0,
        )
        r.raise_for_status()
        return r.json() or []
    except Exception as e:
        log.warn(
            "vod_offset_finder_kills_fetch_failed",
            game_id=game_id[:8], error=str(e)[:120],
        )
        return []


# --------------------------------------------------------------------------
# Live stats — first frame's epoch = real-world game start time.
# --------------------------------------------------------------------------

async def _game_start_epoch(external_id: str) -> int | None:
    """Wall-clock UTC epoch (seconds) when the game actually started."""
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
        # rfc460Timestamp is RFC3339 UTC, sometimes with fractional sec.
        # datetime.fromisoformat handles "...Z" only on 3.11+, so strip it.
        cleaned = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        return int(dt.timestamp())
    except Exception as e:
        log.warn("rfc460_parse_failed", ts=ts, error=str(e)[:80])
        return None


# --------------------------------------------------------------------------
# yt-dlp metadata — upload date + duration to estimate VOD start.
# --------------------------------------------------------------------------

async def _vod_metadata(youtube_id: str) -> dict | None:
    """Returns {'upload_date': 'YYYYMMDD', 'duration': int_seconds}."""
    if not await scheduler.wait_for("ytdlp"):
        return None
    try:
        result = subprocess.run(
            [
                __import__("sys").executable, "-m", "yt_dlp",
                "--js-runtimes", "node",
                "--dump-json", "--no-playlist", "--skip-download",
                f"https://youtu.be/{youtube_id}",
            ],
            capture_output=True, text=True, timeout=45,
        )
        if result.returncode != 0:
            log.warn(
                "ytdlp_meta_failed",
                yt=youtube_id, stderr=result.stderr[:200],
            )
            return None
        meta = json.loads(result.stdout)
        return {
            "upload_date": meta.get("upload_date"),
            "duration": int(meta.get("duration") or 0),
        }
    except Exception as e:
        log.warn("ytdlp_meta_exception", yt=youtube_id, error=str(e)[:120])
        return None


def _estimate_vod_start_epoch(meta: dict) -> int | None:
    """Estimate the wall-clock UTC epoch when the VOD broadcast started.

    YouTube's `upload_date` is the (UTC) calendar day the VOD became
    available — for LEC this is typically a few hours after broadcast
    end. We approximate the broadcast START as
        end_of_upload_day - duration
    which is a tight upper bound for same-day uploads.
    """
    ud = meta.get("upload_date")
    duration = meta.get("duration") or 0
    if not ud or duration <= 0:
        return None
    try:
        day = datetime.strptime(ud, "%Y%m%d").replace(tzinfo=timezone.utc)
        # End of upload day in UTC = day + 24h - 1s. Anchoring to the end
        # gives us the most conservative VOD-start estimate ; the +60s
        # Gemini timer check then nails the true offset.
        end_of_day = day.timestamp() + 86399
        return int(end_of_day - duration)
    except Exception as e:
        log.warn("upload_date_parse_failed", ud=ud, error=str(e)[:80])
        return None


# --------------------------------------------------------------------------
# Gemini timer-read validation — ground-truth the offset against pixels.
# --------------------------------------------------------------------------

async def _read_timer_at(youtube_id: str, vod_seconds: int) -> int | None:
    """Snap a 1-frame still at vod_seconds and ask Gemini for the timer.

    Returns the in-game timer in seconds, or None if unreadable / not
    gameplay. We use a -ss seek on the YouTube URL so we don't have to
    download the whole VOD — ffmpeg streams the bytes it needs.
    """
    tmp_dir = getattr(config, "CLIPS_DIR", "/tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    frame_path = os.path.join(
        tmp_dir, f"vof_{youtube_id}_{vod_seconds}.jpg",
    )
    try:
        # Get a direct media URL via yt-dlp so ffmpeg can seek into it.
        if not await scheduler.wait_for("ytdlp"):
            return None
        url_proc = subprocess.run(
            [
                __import__("sys").executable, "-m", "yt_dlp",
                "--js-runtimes", "node",
                "-g", "-f", "best[height<=720]",
                "--no-playlist", f"https://youtu.be/{youtube_id}",
            ],
            capture_output=True, text=True, timeout=30,
        )
        if url_proc.returncode != 0:
            log.warn("ytdlp_geturl_failed", yt=youtube_id)
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
            log.warn("ffmpeg_snap_failed", yt=youtube_id, ts=vod_seconds)
            return None

        if not await scheduler.wait_for("gemini"):
            return None

        import google.generativeai as genai  # type: ignore
        from services.gemini_client import _wait_for_file_active
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel(
            os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
        )
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
            log.info(
                "vod_offset_timer_unreadable",
                yt=youtube_id, vod_s=vod_seconds, response=text[:30],
            )
            return None
        return int(m.group(1)) * 60 + int(m.group(2))
    except Exception as e:
        log.warn("vod_offset_validation_error", error=str(e)[:120])
        return None
    finally:
        if os.path.exists(frame_path):
            try:
                os.remove(frame_path)
            except OSError:
                pass


async def _resolve_offset(
    youtube_id: str, candidate: int,
) -> int | None:
    """Validate `candidate` offset and adjust once if drift detected."""
    if candidate < 0:
        candidate = 0
    for attempt in range(MAX_VALIDATION_RETRIES + 1):
        probe_at = candidate + TARGET_GAME_TIME
        timer = await _read_timer_at(youtube_id, probe_at)
        if timer is None:
            # Couldn't read — bail rather than write a guess.
            log.info(
                "vod_offset_unverified",
                yt=youtube_id, attempt=attempt, candidate=candidate,
            )
            return None
        drift = timer - TARGET_GAME_TIME
        if abs(drift) <= ACCEPT_DRIFT:
            log.info(
                "vod_offset_validated",
                yt=youtube_id, offset=candidate, drift=drift,
            )
            return candidate
        log.info(
            "vod_offset_adjust",
            yt=youtube_id, attempt=attempt, drift=drift,
            old=candidate, new=max(0, candidate + drift),
        )
        candidate = max(0, candidate + drift)
    log.warn("vod_offset_no_converge", yt=youtube_id, last=candidate)
    return None


# --------------------------------------------------------------------------
# Per-game pipeline.
# --------------------------------------------------------------------------

async def _process_game(game: dict) -> bool:
    gid = game["id"]
    ext = game.get("external_id") or ""
    yt = game.get("vod_youtube_id")
    if not ext or not yt:
        return False

    short = gid[:8]

    game_epoch = await _game_start_epoch(ext)
    if not game_epoch:
        log.info("vof_no_livestats", game_id=short, ext=ext)
        return False

    meta = await _vod_metadata(yt)
    if not meta:
        return False

    vod_epoch = _estimate_vod_start_epoch(meta)
    if not vod_epoch:
        return False

    candidate = max(0, game_epoch - vod_epoch)
    duration = int(meta.get("duration") or 0)
    if duration and candidate >= duration:
        log.warn(
            "vof_candidate_out_of_range",
            game_id=short, candidate=candidate, vod_duration=duration,
        )
        return False

    log.info(
        "vof_candidate",
        game_id=short, yt=yt, candidate=candidate,
        game_epoch=game_epoch, vod_epoch=vod_epoch,
    )

    confirmed = await _resolve_offset(yt, candidate)
    if confirmed is None:
        return False

    if not safe_update(
        "games", {"vod_offset_seconds": confirmed}, "id", gid,
    ):
        log.warn("vof_update_failed", game_id=short)
        return False

    # Re-queue the kills that were quarantined waiting for this offset.
    stuck = _fetch_stuck_kills(gid)
    re_queued = 0
    for k in stuck:
        if safe_update(
            "kills",
            {"status": "vod_found", "needs_reclip": False, "retry_count": 0},
            "id", k["id"],
        ):
            re_queued += 1
    log.info(
        "vof_done",
        game_id=short, offset=confirmed, requeued=re_queued,
    )
    return True


# --------------------------------------------------------------------------
# Daemon entry point.
# --------------------------------------------------------------------------

async def run() -> int:
    """Process up to GAMES_PER_RUN games per cycle.

    Returns the number of games successfully patched.
    """
    log.info("vod_offset_finder_start", cap=GAMES_PER_RUN)
    games = _fetch_pending_games(GAMES_PER_RUN)
    if not games:
        log.info("vod_offset_finder_idle")
        return 0

    fixed = 0
    for g in games:
        try:
            if await _process_game(g):
                fixed += 1
        except Exception as e:
            log.error(
                "vof_game_error",
                game_id=g.get("id", "?")[:8], error=str(e)[:200],
            )

    log.info(
        "vod_offset_finder_done",
        scanned=len(games), fixed=fixed,
    )
    return fixed
