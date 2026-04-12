"""
CLIPPER — Downloads VOD segments, produces triple format clips, uploads to R2.

Output per kill:
  {id}_h.mp4      — 16:9 1280x720  (desktop, kill detail page)
  {id}_v.mp4      — 9:16 720x1280  (scroll mobile, HQ)
  {id}_v_low.mp4  — 9:16 360x640   (scroll mobile, slow network)
  {id}_thumb.jpg  — 9:16 720x1280  (poster frame, OG base)

All MP4s: H.264, movflags +faststart, AAC 96k / 64k for v_low.

Flow:
1. Compute clip window (game_time_seconds + vod_offset ± pad)
2. yt-dlp --download-sections to grab a raw 20-second segment
3. ffmpeg × 4 to produce horizontal / vertical / vertical-low / thumbnail
4. Upload each artefact to R2 via services.r2_client.upload_clip
5. Return a dict of the four public URLs
6. Clean up all temp files
"""

from __future__ import annotations

import asyncio
import os
import sys
import structlog

from config import config
from scheduler import scheduler
from services import r2_client
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()

FFMPEG_TIMEOUT = 180  # seconds per ffmpeg invocation
YTDLP_TIMEOUT = 180   # seconds for a single segment download


def _build_overlay_filter(
    killer: str,
    victim: str,
    context: str = "",
    is_vertical: bool = True,
) -> str:
    """Build ffmpeg drawtext filter chain for text overlays on clips.

    - Hook text (0-3s): "KILLER → VICTIM" in gold, centered top
    - Context bar (permanent): match info at bottom
    """
    # Escape ffmpeg special chars
    def esc(s: str) -> str:
        return s.replace("'", "").replace(":", "\\:").replace("\\", "\\\\")

    hook = esc(f"{killer}  >  {victim}")
    ctx = esc(context) if context else ""

    # Font sizes adapt to vertical vs horizontal
    hook_size = 38 if is_vertical else 32
    ctx_size = 18 if is_vertical else 16
    y_hook = "h*0.06" if is_vertical else "h*0.08"
    y_ctx = "h*0.94" if is_vertical else "h*0.92"

    parts = [
        f"drawtext=text='{hook}':fontsize={hook_size}:fontcolor=#C8AA6E"
        f":borderw=3:bordercolor=black:x=(w-tw)/2:y={y_hook}"
        f":enable='between(t,0,3)'"
    ]
    if ctx:
        parts.append(
            f"drawtext=text='{ctx}':fontsize={ctx_size}:fontcolor=white"
            f":borderw=2:bordercolor=black:x=(w-tw)/2:y={y_ctx}"
        )

    return ",".join(parts)


async def clip_kill(
    kill_id: str,
    youtube_id: str,
    vod_offset_seconds: int,
    game_time_seconds: int,
    multi_kill: str | None = None,
    killer_champion: str | None = None,
    victim_champion: str | None = None,
    match_context: str | None = None,
) -> dict | None:
    """Download, encode and upload a single kill. Returns dict of R2 URLs or None."""
    os.makedirs(config.CLIPS_DIR, exist_ok=True)
    os.makedirs(config.THUMBNAILS_DIR, exist_ok=True)

    # Variable clip duration based on kill context (audit v2 blueprint)
    timing = config.CLIP_TIMING.get(multi_kill or "", config.CLIP_TIMING["default"])
    before = timing["before"]
    after = timing["after"]

    vod_time = int(vod_offset_seconds or 0) + int(game_time_seconds or 0)
    clip_start = max(0, vod_time - before)
    clip_end = vod_time + after

    raw_path = os.path.join(config.CLIPS_DIR, f"raw_{kill_id}.mp4")
    h_path = os.path.join(config.CLIPS_DIR, f"{kill_id}_h.mp4")
    v_path = os.path.join(config.CLIPS_DIR, f"{kill_id}_v.mp4")
    vl_path = os.path.join(config.CLIPS_DIR, f"{kill_id}_v_low.mp4")
    thumb_path = os.path.join(config.THUMBNAILS_DIR, f"{kill_id}_thumb.jpg")

    vod_url = f"https://www.youtube.com/watch?v={youtube_id}"

    try:
        # ─── 1. Download segment ────────────────────────────────────
        can_dl = await scheduler.wait_for("ytdlp")
        if not can_dl:
            log.warn("ytdlp_quota_exceeded", kill_id=kill_id)
            return None

        log.info("clip_download", kill_id=kill_id, start=clip_start, end=clip_end)
        ok = await _run_ytdlp(vod_url, raw_path, clip_start, clip_end)
        if not ok or not os.path.exists(raw_path):
            log.error("clip_download_failed", kill_id=kill_id)
            return None

        # ─── 2. Encode horizontal 16:9 ──────────────────────────────
        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg([
            "-i", raw_path,
            "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-profile:v", "main", "-level", "3.1",
            "-maxrate", "2M", "-bufsize", "4M",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            "-y", h_path,
        ]):
            log.error("ffmpeg_horizontal_failed", kill_id=kill_id)
            return None

        # ─── 3. Encode vertical 9:16 HQ + text overlays ─────────────
        # Smart crop: shift 8% right of center to capture kill feed + action.
        # The LoL broadcast camera tracks action slightly right-of-center,
        # and the kill feed is in the top-right quadrant.
        # Standard center: iw/2 - ih*9/32. Shifted right: + iw*0.08
        v_crop = "crop=ih*9/16:ih:iw/2-ih*9/32+iw*0.08:0,scale=720:1280"
        if killer_champion and victim_champion:
            overlay = _build_overlay_filter(
                killer_champion, victim_champion,
                context=match_context or "",
                is_vertical=True,
            )
            v_filter = f"{v_crop},{overlay}"
        else:
            v_filter = v_crop

        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg([
            "-i", raw_path,
            "-vf", v_filter,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-profile:v", "main", "-level", "3.1",
            "-maxrate", "2M", "-bufsize", "4M",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            "-y", v_path,
        ]):
            log.error("ffmpeg_vertical_failed", kill_id=kill_id)
            return None

        # ─── 4. Encode vertical 9:16 low (360p, no overlay for perf) ──
        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg([
            "-i", raw_path,
            "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=360:640",
            "-c:v", "libx264", "-preset", "fast", "-crf", "28",
            "-profile:v", "baseline", "-level", "3.0",
            "-maxrate", "800k", "-bufsize", "1600k",
            "-c:a", "aac", "-b:a", "64k",
            "-movflags", "+faststart",
            "-y", vl_path,
        ]):
            log.warn("ffmpeg_low_failed", kill_id=kill_id)  # non-fatal

        # ─── 5. Extract thumbnail at kill moment ────────────────────
        await _ffmpeg([
            "-ss", str(before),
            "-i", v_path,
            "-vframes", "1",
            "-q:v", "2",
            "-y", thumb_path,
        ])

        # ─── 6. Upload everything to R2 in parallel ─────────────────
        h_url, v_url, vl_url, thumb_url = await asyncio.gather(
            r2_client.upload_clip(kill_id, h_path, "h"),
            r2_client.upload_clip(kill_id, v_path, "v"),
            r2_client.upload_clip(kill_id, vl_path, "v_low") if os.path.exists(vl_path) else _noop(),
            r2_client.upload_clip(kill_id, thumb_path, "thumb") if os.path.exists(thumb_path) else _noop(),
        )

        log.info(
            "clip_done",
            kill_id=kill_id,
            h=bool(h_url), v=bool(v_url), vl=bool(vl_url), thumb=bool(thumb_url),
        )

        return {
            "clip_url_horizontal": h_url,
            "clip_url_vertical": v_url,
            "clip_url_vertical_low": vl_url,
            "thumbnail_url": thumb_url,
            # Local path kept alive for Gemini video analysis —
            # caller is responsible for cleanup via cleanup_local_files()
            "_local_h_path": h_path if os.path.exists(h_path) else None,
        }

    except Exception as e:
        log.error("clip_error", kill_id=kill_id, error=str(e))
        return None
    finally:
        # Clean up raw + vertical + thumbnail (not needed after R2 upload)
        # Keep h_path alive for Gemini analysis — pipeline cleans it later
        for p in (raw_path, v_path, vl_path, thumb_path):
            _safe_remove(p)


def cleanup_local_clip(local_path: str | None):
    """Remove a local clip file after Gemini analysis is done."""
    if local_path:
        _safe_remove(local_path)


def _cookies_args() -> list[str]:
    """Return yt-dlp cookie args if a cookies.txt exists, empty list otherwise.

    We intentionally do NOT use --cookies-from-browser because Chrome's DPAPI
    encryption fails when running from non-interactive shells (Claude Code,
    systemd, Task Scheduler). Instead, the user can manually export a
    cookies.txt via a browser extension if YouTube starts throttling.
    """
    cookies_file = os.path.join(os.path.dirname(__file__), "..", "cookies.txt")
    if os.path.exists(cookies_file):
        return ["--cookies", cookies_file]
    return []


async def _run_ytdlp(url: str, output_path: str, start: float, end: float) -> bool:
    """Run yt-dlp via `python -m yt_dlp` to stay cross-platform and venv-safe."""
    cmd = [
        sys.executable, "-m", "yt_dlp",
        *_cookies_args(),
        "--download-sections", f"*{start}-{end}",
        "--force-keyframes-at-cuts",
        "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]",
        "--merge-output-format", "mp4",
        "-o", output_path,
        "--no-playlist",
        "--quiet", "--no-warnings",
        url,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=YTDLP_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.error("ytdlp_timeout", url=url[:60])
            return False
        if proc.returncode != 0:
            log.warn("ytdlp_nonzero", rc=proc.returncode, stderr=(stderr or b"")[:400].decode("utf-8", "ignore"))
            return False
        return True
    except FileNotFoundError:
        log.error("ytdlp_not_installed")
        return False


async def _ffmpeg(args: list[str]) -> bool:
    """Run ffmpeg asynchronously, return True on success."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", *args]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=FFMPEG_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.error("ffmpeg_timeout", cmd=" ".join(cmd[:6]))
            return False
        if proc.returncode != 0:
            log.warn("ffmpeg_nonzero", rc=proc.returncode, stderr=(stderr or b"")[:400].decode("utf-8", "ignore"))
            return False
        return True
    except FileNotFoundError:
        log.error("ffmpeg_not_installed")
        return False


async def _noop():
    return None


def _safe_remove(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


# ─── Daemon loop: pick up kills that need clipping ─────────────────────────

async def run() -> int:
    """Find kills in status='vod_found' and clip them. Returns clip count."""
    log.info("clipper_scan_start")

    kills = safe_select(
        "kills",
        "id, game_id, game_time_seconds, status",
        status="vod_found",
    )
    if not kills:
        log.info("clipper_no_pending")
        return 0

    processed = 0
    for kill in kills:
        # Fetch parent game to find the VOD info
        games = safe_select(
            "games",
            "vod_youtube_id, vod_offset_seconds",
            id=kill.get("game_id", ""),
        )
        if not games:
            continue
        game = games[0]
        yt_id = game.get("vod_youtube_id")
        offset = int(game.get("vod_offset_seconds") or 0)
        if not yt_id:
            continue

        safe_update("kills", {"status": "clipping"}, "id", kill["id"])

        urls = await clip_kill(
            kill_id=kill["id"],
            youtube_id=yt_id,
            vod_offset_seconds=offset,
            game_time_seconds=int(kill.get("game_time_seconds") or 0),
        )
        if urls and urls.get("clip_url_horizontal"):
            payload = {**urls, "status": "clipped"}
            safe_update("kills", payload, "id", kill["id"])
            processed += 1
        else:
            safe_update(
                "kills",
                {"status": "clip_error", "retry_count": int(kill.get("retry_count") or 0) + 1},
                "id",
                kill["id"],
            )

    log.info("clipper_scan_done", processed=processed)
    return processed
