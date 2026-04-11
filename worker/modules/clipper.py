"""
CLIPPER — Downloads VOD segments, produces triple format clips, uploads to R2.

Output per kill:
  {id}_h.mp4     — 16:9 1280x720  (desktop, kill detail)
  {id}_v.mp4     — 9:16 720x1280  (scroll mobile, HQ)
  {id}_v_low.mp4 — 9:16 360x640   (scroll mobile, slow network)
  {id}_thumb.jpg — 9:16 720x1280  (poster frame)

All MP4s: H.264, movflags +faststart, AAC 96k.
"""

import os
import hashlib
import subprocess
import structlog
from config import config
from scheduler import scheduler

log = structlog.get_logger()


async def clip_kill(
    kill_id: str,
    youtube_id: str,
    vod_offset: int,
    game_time_seconds: int,
) -> dict | None:
    """
    Download and clip a single kill from a YouTube VOD.
    Returns {horizontal, vertical, vertical_low, thumbnail} URLs or None.
    """
    can_dl = await scheduler.wait_for("ytdlp")
    if not can_dl:
        return None

    # Calculate timestamps
    vod_time = vod_offset + game_time_seconds
    clip_start = max(0, vod_time - config.CLIP_BEFORE_SECONDS)
    clip_end = vod_time + config.CLIP_AFTER_SECONDS
    clip_duration = config.CLIP_BEFORE_SECONDS + config.CLIP_AFTER_SECONDS

    file_hash = hashlib.md5(f"{kill_id}-{vod_time}".encode()).hexdigest()[:10]
    vod_url = f"https://www.youtube.com/watch?v={youtube_id}"

    os.makedirs(config.CLIPS_DIR, exist_ok=True)
    os.makedirs(config.THUMBNAILS_DIR, exist_ok=True)

    raw_path = os.path.join(config.CLIPS_DIR, f"raw_{file_hash}.mp4")
    h_path = os.path.join(config.CLIPS_DIR, f"{kill_id}_h.mp4")
    v_path = os.path.join(config.CLIPS_DIR, f"{kill_id}_v.mp4")
    vl_path = os.path.join(config.CLIPS_DIR, f"{kill_id}_v_low.mp4")
    thumb_path = os.path.join(config.THUMBNAILS_DIR, f"{kill_id}_thumb.jpg")

    try:
        # Step 1: Download segment with yt-dlp
        log.info("clip_download", kill_id=kill_id, start=clip_start, end=clip_end)
        result = subprocess.run([
            "yt-dlp",
            "--download-sections", f"*{clip_start}-{clip_end}",
            "--force-keyframes-at-cuts",
            "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]",
            "--merge-output-format", "mp4",
            "-o", raw_path,
            "--no-playlist",
            vod_url,
        ], capture_output=True, text=True, timeout=120)

        if not os.path.exists(raw_path):
            log.error("clip_download_failed", kill_id=kill_id, stderr=result.stderr[:500])
            return None

        await scheduler.wait_for("ffmpeg_cooldown")

        # Step 2: Horizontal 16:9 1280x720
        _ffmpeg([
            "-i", raw_path,
            "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-maxrate", "2M", "-bufsize", "4M",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            "-y", h_path,
        ])

        await scheduler.wait_for("ffmpeg_cooldown")

        # Step 3: Vertical 9:16 720x1280 (crop center)
        _ffmpeg([
            "-i", raw_path,
            "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=720:1280",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-maxrate", "2M", "-bufsize", "4M",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            "-y", v_path,
        ])

        await scheduler.wait_for("ffmpeg_cooldown")

        # Step 4: Vertical low 360x640
        _ffmpeg([
            "-i", raw_path,
            "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=360:640",
            "-c:v", "libx264", "-preset", "fast", "-crf", "28",
            "-profile:v", "baseline", "-level", "3.0",
            "-maxrate", "800k", "-bufsize", "1600k",
            "-c:a", "aac", "-b:a", "64k",
            "-movflags", "+faststart",
            "-y", vl_path,
        ])

        # Step 5: Thumbnail at kill moment
        _ffmpeg([
            "-ss", str(config.CLIP_BEFORE_SECONDS),
            "-i", v_path,
            "-vframes", "1",
            "-q:v", "2",
            thumb_path,
        ])

        # Clean up raw file
        _safe_remove(raw_path)

        # Step 6: Upload to R2
        urls = {}
        for local_path, r2_key in [
            (h_path, f"clips/{kill_id}_h.mp4"),
            (v_path, f"clips/{kill_id}_v.mp4"),
            (vl_path, f"clips/{kill_id}_v_low.mp4"),
            (thumb_path, f"thumbnails/{kill_id}_thumb.jpg"),
        ]:
            if os.path.exists(local_path):
                url = await _upload_r2(local_path, r2_key)
                urls[r2_key.split("/")[0]] = url

        log.info("clip_done", kill_id=kill_id, formats=len(urls))
        return {
            "clip_url_horizontal": urls.get("clips"),
            "clip_url_vertical": urls.get("clips"),
            "clip_url_vertical_low": urls.get("clips"),
            "thumbnail_url": urls.get("thumbnails"),
        }

    except subprocess.TimeoutExpired:
        log.error("clip_timeout", kill_id=kill_id)
        _safe_remove(raw_path)
        return None
    except Exception as e:
        log.error("clip_error", kill_id=kill_id, error=str(e))
        _safe_remove(raw_path)
        return None


def _ffmpeg(args: list[str]):
    """Run ffmpeg with args."""
    subprocess.run(["ffmpeg"] + args, capture_output=True, timeout=120)


async def _upload_r2(file_path: str, key: str) -> str | None:
    """Upload file to Cloudflare R2."""
    if not config.R2_ACCOUNT_ID or not config.R2_ACCESS_KEY_ID:
        return None

    await scheduler.wait_for("r2")
    endpoint = f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

    try:
        subprocess.run([
            "aws", "s3", "cp", file_path,
            f"s3://{config.R2_BUCKET_NAME}/{key}",
            "--endpoint-url", endpoint,
        ], capture_output=True, timeout=60, env={
            **os.environ,
            "AWS_ACCESS_KEY_ID": config.R2_ACCESS_KEY_ID,
            "AWS_SECRET_ACCESS_KEY": config.R2_SECRET_ACCESS_KEY,
            "AWS_DEFAULT_REGION": "auto",
        })
        return f"{config.R2_PUBLIC_URL}/{key}"
    except Exception as e:
        log.error("r2_upload_failed", key=key, error=str(e))
        return None


def _safe_remove(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
