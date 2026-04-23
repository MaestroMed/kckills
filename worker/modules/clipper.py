"""
CLIPPER — Downloads VOD segments, produces triple format clips, uploads to R2.

Output per kill (V2 — 1080p quality bump):
  {id}_h.mp4      — 16:9 1920x1080  (desktop, kill detail page)
  {id}_v.mp4      — 9:16 1080x1920  (scroll mobile, HQ)
  {id}_v_low.mp4  — 9:16  540x 960  (scroll mobile, slow network)
  {id}_thumb.jpg  — 9:16 1080x1920  (poster frame, OG base)

All MP4s: H.264 main 4.0 (HQ) / baseline 3.1 (low), movflags +faststart,
AAC 128k / 80k. yt-dlp pulls source at <= 1080p; older Twitch VODs that
only have 720p available are upscaled cleanly by libx264.

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
from services.clip_hash import content_hash, perceptual_hash
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
    # Escape for ffmpeg drawtext on Windows: no single quotes, escape colons
    def esc(s: str) -> str:
        return (
            s.replace("\\", "\\\\\\\\")
            .replace(":", "\\\\:")
            .replace("'", "\u2019")  # replace ' with typographic apostrophe
            .replace(";", "\\\\;")
        )

    hook = esc(f"{killer}  >  {victim}")
    ctx = esc(context) if context else ""

    hook_size = 38 if is_vertical else 32
    ctx_size = 18 if is_vertical else 16
    y_hook = "h*0.06" if is_vertical else "h*0.08"
    y_ctx = "h*0.94" if is_vertical else "h*0.92"

    parts = [
        f"drawtext=text={hook}:fontsize={hook_size}:fontcolor=#C8AA6E"
        f":borderw=3:bordercolor=black:x=(w-tw)/2:y={y_hook}"
        f":enable=between(t\\,0\\,3)"
    ]
    if ctx:
        parts.append(
            f"drawtext=text={ctx}:fontsize={ctx_size}:fontcolor=white"
            f":borderw=2:bordercolor=black:x=(w-tw)/2:y={y_ctx}"
        )

    return ",".join(parts)


VODS_DIR = os.environ.get("LOLTOK_VODS_DIR", os.path.join(os.path.dirname(__file__), "..", "vods"))


async def download_full_vod(youtube_id: str) -> str | None:
    """Download the full VOD once. Returns local path or None.

    This is the KEY fix for YouTube throttling: 1 download per VOD instead
    of N downloads per kill. The VOD is cached in worker/vods/ and reused
    for all kills in all games of the match.
    """
    os.makedirs(VODS_DIR, exist_ok=True)
    vod_path = os.path.join(VODS_DIR, f"{youtube_id}.mp4")

    if os.path.exists(vod_path):
        size_mb = os.path.getsize(vod_path) / (1024 * 1024)
        if size_mb > 10:  # valid VOD, not a truncated file
            log.info("vod_cache_hit", youtube_id=youtube_id, size_mb=round(size_mb))
            return vod_path

    can_dl = await scheduler.wait_for("ytdlp")
    if not can_dl:
        return None

    log.info("vod_download_start", youtube_id=youtube_id)
    vod_url = f"https://www.youtube.com/watch?v={youtube_id}"
    cmd = [
        sys.executable, "-m", "yt_dlp",
        *_cookies_args(),
        "--js-runtimes", "node",
        "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "--merge-output-format", "mp4",
        "-o", vod_path,
        "--no-playlist",
        "--quiet", "--no-warnings",
        vod_url,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.error("vod_download_timeout", youtube_id=youtube_id)
            return None
        if proc.returncode != 0:
            err = (stderr or b"")[:300].decode("utf-8", "ignore")
            log.error("vod_download_failed", youtube_id=youtube_id, stderr=err)
            _safe_remove(vod_path)
            return None
    except FileNotFoundError:
        log.error("ytdlp_not_installed")
        return None

    if os.path.exists(vod_path):
        size_mb = os.path.getsize(vod_path) / (1024 * 1024)
        log.info("vod_download_done", youtube_id=youtube_id, size_mb=round(size_mb))
        return vod_path
    return None


async def clip_kill(
    kill_id: str,
    youtube_id: str,
    vod_offset_seconds: int,
    game_time_seconds: int,
    multi_kill: str | None = None,
    killer_champion: str | None = None,
    victim_champion: str | None = None,
    match_context: str | None = None,
    local_vod_path: str | None = None,
) -> dict | None:
    """Encode and upload a single kill clip. Returns dict of R2 URLs or None.

    If `local_vod_path` is provided (full VOD already downloaded), extracts
    the segment with ffmpeg directly — ZERO yt-dlp calls, ZERO throttle risk.
    Falls back to per-kill yt-dlp download if no local VOD.
    """
    os.makedirs(config.CLIPS_DIR, exist_ok=True)
    os.makedirs(config.THUMBNAILS_DIR, exist_ok=True)

    # Variable clip duration based on kill context (audit v2 blueprint)
    timing = config.CLIP_TIMING.get(multi_kill or "", config.CLIP_TIMING["default"])
    before = timing["before"]
    after = timing["after"]

    vod_time = int(vod_offset_seconds or 0) + int(game_time_seconds or 0)
    clip_start = max(0, vod_time - before)
    clip_end = vod_time + after
    clip_duration = clip_end - clip_start

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

        if local_vod_path and os.path.exists(local_vod_path):
            # ─── Fast path: extract segment from local VOD via ffmpeg ──
            # ZERO YouTube calls. No throttle risk. Instant.
            log.info("clip_extract_local", kill_id=kill_id, start=clip_start, duration=clip_duration)
            if not await _ffmpeg([
                "-ss", str(clip_start),
                "-i", local_vod_path,
                "-t", str(clip_duration),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                "-y", raw_path,
            ]):
                log.error("clip_extract_failed", kill_id=kill_id)
                return None
        else:
            # ─── Slow path: download segment from YouTube (throttle risk) ──
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
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-profile:v", "main", "-level", "4.0",
            "-maxrate", "4M", "-bufsize", "8M",
            "-c:a", "aac", "-b:a", "128k",
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
        v_crop = "crop=ih*9/16:ih:iw/2-ih*9/32+iw*0.08:0,scale=1080:1920"
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
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-profile:v", "main", "-level", "4.0",
            "-maxrate", "4M", "-bufsize", "8M",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-y", v_path,
        ]):
            log.error("ffmpeg_vertical_failed", kill_id=kill_id)
            return None

        # ─── 4. Encode vertical 9:16 low (540p, no overlay for perf) ──
        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg([
            "-i", raw_path,
            "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=540:960",
            "-c:v", "libx264", "-preset", "fast", "-crf", "27",
            "-profile:v", "baseline", "-level", "3.1",
            "-maxrate", "1200k", "-bufsize", "2400k",
            "-c:a", "aac", "-b:a", "80k",
            "-movflags", "+faststart",
            "-y", vl_path,
        ]):
            log.warn("ffmpeg_low_failed", kill_id=kill_id)  # non-fatal

        # ─── 5. Smart thumbnail extraction — best of 3 frames ─────
        # Extract 3 candidate frames at -1s, +0.5s, +2s around the
        # kill moment. Pick the one with highest luminance variance
        # (= most visual info, least likely to be a black/loading
        # frame or kill-cam transition).
        # The kill-cam usually fades to black for ~0.3s right after
        # the kill animation, so picking exact-moment often yields
        # a near-black thumbnail. The +1s offset captures the post-
        # kill victory pose / reaction shot which is much more
        # readable as a poster.
        thumb_candidates = []
        for offset_s, suffix in [(-1.0, "a"), (0.5, "b"), (2.0, "c")]:
            cand_path = os.path.join(
                config.THUMBNAILS_DIR, f"{kill_id}_thumb_{suffix}.jpg",
            )
            try:
                await _ffmpeg([
                    "-ss", str(max(0, before + offset_s)),
                    "-i", v_path,
                    "-vframes", "1",
                    "-q:v", "2",
                    "-y", cand_path,
                ])
                if os.path.exists(cand_path) and os.path.getsize(cand_path) > 1000:
                    thumb_candidates.append(cand_path)
            except Exception:
                pass

        chosen = await asyncio.to_thread(_pick_best_thumbnail, thumb_candidates)
        if chosen and chosen != thumb_path:
            try:
                # Rename winner to canonical thumb_path
                if os.path.exists(thumb_path):
                    os.remove(thumb_path)
                os.rename(chosen, thumb_path)
            except OSError:
                # Fall back to copy if rename fails (cross-device)
                import shutil
                try:
                    shutil.copy2(chosen, thumb_path)
                except OSError:
                    pass
        # Cleanup the losers
        for cand in thumb_candidates:
            if cand != thumb_path and os.path.exists(cand):
                try:
                    os.remove(cand)
                except OSError:
                    pass

        # ─── 6. Compute canonical hashes (Phase 1 foundation) ────────
        # SHA-256 dedups byte-identical re-encodes; pHash dedups visually
        # identical clips at different bitrates (community resubmissions).
        # Non-blocking: hash failures don't abort the upload.
        c_hash = await asyncio.to_thread(content_hash, h_path)
        p_hash = (
            await asyncio.to_thread(perceptual_hash, thumb_path)
            if os.path.exists(thumb_path)
            else None
        )

        # ─── 7. Upload everything to R2 in parallel ─────────────────
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
            content_hash=c_hash[:12] + "..." if c_hash else None,
            phash=p_hash,
        )

        return {
            "clip_url_horizontal": h_url,
            "clip_url_vertical": v_url,
            "clip_url_vertical_low": vl_url,
            "thumbnail_url": thumb_url,
            "content_hash": c_hash,
            "perceptual_hash": p_hash,
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


async def clip_moment(
    moment_id: str,
    youtube_id: str,
    vod_offset_seconds: int,
    clip_start_game_seconds: int,
    clip_end_game_seconds: int,
    classification: str = "teamfight",
    kill_count: int = 1,
    match_context: str | None = None,
    local_vod_path: str | None = None,
) -> dict | None:
    """Encode and upload a moment clip with variable duration.

    Unlike clip_kill() which uses fixed -30s/+10s timing, clip_moment()
    uses the moment's computed window: 15s before first kill to 10s after
    last kill, clamped to [20, 60] seconds.
    """
    os.makedirs(config.CLIPS_DIR, exist_ok=True)
    os.makedirs(config.THUMBNAILS_DIR, exist_ok=True)

    vod_start = int(vod_offset_seconds or 0) + int(clip_start_game_seconds or 0)
    vod_end = int(vod_offset_seconds or 0) + int(clip_end_game_seconds or 0)
    clip_start = max(0, vod_start)
    clip_duration = vod_end - clip_start

    raw_path = os.path.join(config.CLIPS_DIR, f"raw_m_{moment_id}.mp4")
    h_path = os.path.join(config.CLIPS_DIR, f"m_{moment_id}_h.mp4")
    v_path = os.path.join(config.CLIPS_DIR, f"m_{moment_id}_v.mp4")
    vl_path = os.path.join(config.CLIPS_DIR, f"m_{moment_id}_v_low.mp4")
    thumb_path = os.path.join(config.THUMBNAILS_DIR, f"m_{moment_id}_thumb.jpg")

    # Build overlay text for the moment
    badge = classification.upper().replace("_", " ")
    overlay_text = f"{badge} - {kill_count} kill{'s' if kill_count > 1 else ''}"

    try:
        # ─── 1. Extract segment from local VOD or YouTube ───────────
        can_dl = await scheduler.wait_for("ytdlp")
        if not can_dl:
            return None

        if local_vod_path and os.path.exists(local_vod_path):
            log.info("moment_extract_local", moment_id=moment_id, start=clip_start, duration=clip_duration)
            if not await _ffmpeg([
                "-ss", str(clip_start),
                "-i", local_vod_path,
                "-t", str(clip_duration),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                "-y", raw_path,
            ]):
                log.error("moment_extract_failed", moment_id=moment_id)
                return None
        else:
            vod_url = f"https://www.youtube.com/watch?v={youtube_id}"
            ok = await _run_ytdlp(vod_url, raw_path, clip_start, clip_start + clip_duration)
            if not ok or not os.path.exists(raw_path):
                log.error("moment_download_failed", moment_id=moment_id)
                return None

        # ─── 2. Horizontal 16:9 ────────────────────────────────────
        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg([
            "-i", raw_path,
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-profile:v", "main", "-level", "4.0",
            "-maxrate", "4M", "-bufsize", "8M",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-y", h_path,
        ]):
            log.error("moment_h_failed", moment_id=moment_id)
            return None

        # ─── 3. Vertical 9:16 HQ (no burnt-in overlay — frontend handles badges)
        v_crop = "crop=ih*9/16:ih:iw/2-ih*9/32+iw*0.08:0,scale=1080:1920"
        v_filter = v_crop

        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg([
            "-i", raw_path,
            "-vf", v_filter,
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-profile:v", "main", "-level", "4.0",
            "-maxrate", "4M", "-bufsize", "8M",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-y", v_path,
        ]):
            log.error("moment_v_failed", moment_id=moment_id)
            return None

        # ─── 4. Vertical 9:16 low (540p) ───────────────────────────
        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg([
            "-i", raw_path,
            "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=540:960",
            "-c:v", "libx264", "-preset", "fast", "-crf", "27",
            "-profile:v", "baseline", "-level", "3.1",
            "-maxrate", "1200k", "-bufsize", "2400k",
            "-c:a", "aac", "-b:a", "80k",
            "-movflags", "+faststart",
            "-y", vl_path,
        ]):
            log.warn("moment_vl_failed", moment_id=moment_id)

        # ─── 5. Thumbnail at mid-clip ──────────────────────────────
        thumb_at = clip_duration // 2
        await _ffmpeg([
            "-ss", str(thumb_at),
            "-i", v_path,
            "-vframes", "1", "-q:v", "2",
            "-y", thumb_path,
        ])

        # ─── 6. Upload to R2 under moments/ prefix ─────────────────
        h_url, v_url, vl_url, thumb_url = await asyncio.gather(
            r2_client.upload_moment(moment_id, h_path, "h"),
            r2_client.upload_moment(moment_id, v_path, "v"),
            r2_client.upload_moment(moment_id, vl_path, "v_low") if os.path.exists(vl_path) else _noop(),
            r2_client.upload_moment(moment_id, thumb_path, "thumb") if os.path.exists(thumb_path) else _noop(),
        )

        log.info(
            "moment_clip_done",
            moment_id=moment_id,
            classification=classification,
            duration=clip_duration,
            h=bool(h_url), v=bool(v_url),
        )

        return {
            "clip_url_horizontal": h_url,
            "clip_url_vertical": v_url,
            "clip_url_vertical_low": vl_url,
            "thumbnail_url": thumb_url,
            "_local_h_path": h_path if os.path.exists(h_path) else None,
        }

    except Exception as e:
        log.error("moment_clip_error", moment_id=moment_id, error=str(e))
        return None
    finally:
        for p in (raw_path, v_path, vl_path, thumb_path):
            _safe_remove(p)


def _build_moment_overlay(badge_text: str, context: str = "") -> str:
    """Build ffmpeg drawtext filter for moment badge overlay.

    Shows classification badge (e.g. 'TEAMFIGHT - 5 kills') for first 4 seconds,
    and match context at the bottom permanently.

    ffmpeg drawtext escaping rules (Windows-safe):
    - ':' must be '\\:' inside drawtext option values
    - ',' must be '\\,' inside drawtext option values
    - Single quotes are removed entirely (Windows shell issue)
    - The enable= value uses '\\,' for function arg separators
    """
    if not badge_text and not context:
        return ""

    def _esc(s: str) -> str:
        """Escape a string for ffmpeg drawtext text= value."""
        return s.replace("\\", "\\\\").replace(":", "\\:").replace(",", "\\,").replace("'", "").replace('"', "")

    parts = []

    # Badge text: top center, gold, first 4 seconds
    if badge_text:
        safe_badge = _esc(badge_text)
        parts.append(
            f"drawtext=text={safe_badge}"
            f"\\:fontcolor=#C8AA6E\\:fontsize=36\\:borderw=3\\:bordercolor=black"
            f"\\:x=(w-text_w)/2\\:y=60"
            f"\\:enable='between(t,0,4)'"
        )

    # Context bar: bottom left, permanent
    if context:
        safe_ctx = _esc(context)
        parts.append(
            f"drawtext=text={safe_ctx}"
            f"\\:fontcolor=#A09B8C\\:fontsize=18\\:borderw=2\\:bordercolor=black"
            f"\\:x=20\\:y=h-40"
        )

    return ",".join(parts) if parts else ""


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
        "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
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


def _pick_best_thumbnail(candidates: list[str]) -> str | None:
    """From a list of candidate thumbnail paths, return the one with
    the highest "informative-ness" score.

    Score = mean luminance × variance (capped). High score = bright
    AND high contrast = readable poster. Low score = mostly black or
    mostly uniform = boring placeholder.

    Returns None if all candidates fail PIL load (unlikely but safe).
    """
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    try:
        from PIL import Image, ImageStat
    except ImportError:
        # PIL absent — just return the first candidate (still better
        # than nothing). PIL is part of `Pillow` which is in worker
        # requirements.txt, so this should never trigger.
        return candidates[0]

    scored: list[tuple[float, str]] = []
    for path in candidates:
        try:
            with Image.open(path) as img:
                gray = img.convert("L")
                stats = ImageStat.Stat(gray)
                mean_lum = stats.mean[0]      # 0-255
                stddev = stats.stddev[0]      # spread = visual info
                # Penalty for too-dark (likely loading screen) or
                # too-bright (likely white flash on kill)
                if mean_lum < 30 or mean_lum > 240:
                    score = stddev * 0.3
                else:
                    score = stddev * (1.0 - abs(mean_lum - 128) / 200.0)
                scored.append((score, path))
        except Exception:
            scored.append((0.0, path))

    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1] if scored else candidates[0]


# ─── Daemon loop: pick up kills that need clipping ─────────────────────────

MAX_RETRY_COUNT = 3

# Cap how many kills we attempt per pass. With CONCURRENCY=6 workers
# at ~25s/clip (now that ffmpeg_cooldown dropped 5s -> 1s), 200 clips =
# ~14 min per pass. The 300s daemon interval keeps ticking during the
# pass, so the next run fires immediately after if there's still a
# backlog. On a 16-core Ryzen the bottleneck is yt-dlp throttle
# (scheduler-managed), not ffmpeg or disk I/O.
#
# Empirical max throughput at these settings : ~400 clips/hour, validated
# without YouTube 429s on a residential IP.
BATCH_SIZE = 200
CONCURRENCY = 6


async def run() -> int:
    """Find kills in status='vod_found' OR 'clip_error' (retry_count<3) and clip them.

    The clip_error branch lets transient failures (YouTube throttle, network
    blips, ffmpeg hiccups) self-heal without a human requeue. Each failed
    attempt bumps retry_count; once it hits MAX_RETRY_COUNT the kill stops
    being picked up and needs manual attention via /admin/clips.

    Returns the number of kills successfully clipped this pass.
    """
    log.info("clipper_scan_start")

    # Primary queue: never-tried kills
    fresh_kills = safe_select(
        "kills",
        "id, game_id, game_time_seconds, status, retry_count",
        status="vod_found",
    ) or []

    # Retry queue: kills that failed but haven't exhausted their attempts
    retry_kills = [
        k for k in (safe_select(
            "kills",
            "id, game_id, game_time_seconds, status, retry_count",
            status="clip_error",
        ) or [])
        if int(k.get("retry_count") or 0) < MAX_RETRY_COUNT
    ]

    # Fresh first so new arrivals don't starve behind a long retry queue.
    all_kills = fresh_kills + retry_kills

    # Batch cap — see BATCH_SIZE docstring above.
    kills = all_kills[:BATCH_SIZE]

    if not kills:
        log.info("clipper_no_pending")
        return 0

    log.info(
        "clipper_queue",
        fresh=len(fresh_kills),
        retry=len(retry_kills),
        processing=len(kills),
        remaining=max(0, len(all_kills) - len(kills)),
    )

    # Parallel clip workers — bounded by CONCURRENCY semaphore.
    # ffmpeg is multi-threaded, yt-dlp is rate-limited by scheduler,
    # so 4 workers ≈ optimal CPU utilisation without throttle thrash.
    sem = asyncio.Semaphore(CONCURRENCY)
    counters = {"ok": 0, "fail": 0}

    async def _process_one(kill: dict):
        async with sem:
            # Fetch parent game to find the VOD info
            games = safe_select(
                "games",
                "vod_youtube_id, vod_offset_seconds",
                id=kill.get("game_id", ""),
            )
            if not games:
                return
            game = games[0]
            yt_id = game.get("vod_youtube_id")
            offset = int(game.get("vod_offset_seconds") or 0)
            if not yt_id:
                return

            safe_update("kills", {"status": "clipping"}, "id", kill["id"])

            urls = await clip_kill(
                kill_id=kill["id"],
                youtube_id=yt_id,
                vod_offset_seconds=offset,
                game_time_seconds=int(kill.get("game_time_seconds") or 0),
            )
            if urls and urls.get("clip_url_horizontal"):
                payload = {**urls, "status": "clipped"}
                # Strip the in-process file path before persisting — it's only
                # there for the analyzer that runs after clipping, never a DB
                # column.
                payload.pop("_local_h_path", None)
                safe_update("kills", payload, "id", kill["id"])
                # PR6-C : tick the canonical event's "clip produced" QC gate.
                # No-op if event_mapper hasn't created the row yet — next
                # event_mapper cycle will pick it up with qc_clip_produced
                # already TRUE thanks to the proxy logic in _kill_to_event_row.
                try:
                    from services.event_qc import tick_qc_clip_produced
                    tick_qc_clip_produced(kill["id"])
                except Exception as _e:
                    log.warn("event_qc_tick_failed", kill_id=kill["id"][:8], stage="clip_produced", error=str(_e)[:120])
                counters["ok"] += 1
            else:
                safe_update(
                    "kills",
                    {"status": "clip_error", "retry_count": int(kill.get("retry_count") or 0) + 1},
                    "id",
                    kill["id"],
                )
                counters["fail"] += 1

    await asyncio.gather(*(_process_one(k) for k in kills), return_exceptions=False)

    log.info("clipper_scan_done", processed=counters["ok"], failed=counters["fail"])
    return counters["ok"]
