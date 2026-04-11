"""
CLIPPER — Downloads VOD segments, clips kills, generates thumbnails, uploads to R2.

For each kill in status 'vod_found':
1. Calculate the VOD timestamp: kill_game_time + vod_offset
2. Download the segment with yt-dlp (kill_time - BEFORE to kill_time + AFTER)
3. Generate a thumbnail at the kill moment
4. Upload clip + thumbnail to Cloudflare R2
5. Update kill record with URLs
"""

import os
import subprocess
import hashlib
import httpx
from .config import config
from .db import get_db, log


def clip_kill(kill_id: str, game_vod_url: str, vod_offset: float,
              game_timestamp_ms: int, killer_champion: str, victim_champion: str) -> tuple[str | None, str | None]:
    """
    Download and clip a single kill from a VOD.

    Returns (clip_url, thumbnail_url) or (None, None) on failure.
    """
    # Calculate VOD timestamp
    game_time_seconds = game_timestamp_ms / 1000
    vod_time = vod_offset + game_time_seconds

    # Clip boundaries
    clip_start = max(0, vod_time - config.CLIP_BEFORE)
    clip_duration = config.CLIP_BEFORE + config.CLIP_AFTER

    # Generate unique filename
    file_hash = hashlib.md5(f"{kill_id}-{vod_time}".encode()).hexdigest()[:12]
    clip_filename = f"kill_{file_hash}.mp4"
    thumb_filename = f"thumb_{file_hash}.jpg"

    # Ensure directories exist
    os.makedirs(config.CLIPS_DIR, exist_ok=True)
    os.makedirs(config.THUMBNAILS_DIR, exist_ok=True)

    clip_path = os.path.join(config.CLIPS_DIR, clip_filename)
    thumb_path = os.path.join(config.THUMBNAILS_DIR, thumb_filename)

    try:
        # Step 1: Download the segment with yt-dlp + ffmpeg
        log("info", "clipper", f"Clipping kill {kill_id} at VOD time {vod_time:.1f}s")

        # Use yt-dlp to download just the segment
        # --download-sections downloads only the specified time range
        download_result = subprocess.run([
            "yt-dlp",
            "--download-sections", f"*{clip_start:.1f}-{clip_start + clip_duration:.1f}",
            "--force-keyframes-at-cuts",
            "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]",
            "--merge-output-format", "mp4",
            "-o", clip_path,
            "--no-playlist",
            game_vod_url,
        ], capture_output=True, text=True, timeout=120)

        if download_result.returncode != 0:
            # Fallback: download then clip with ffmpeg
            log("warn", "clipper", f"yt-dlp sections failed, trying ffmpeg approach")
            clip_path = _fallback_clip(game_vod_url, clip_start, clip_duration, clip_path)
            if not clip_path:
                return None, None

        if not os.path.exists(clip_path):
            log("error", "clipper", f"Clip file not created for kill {kill_id}")
            return None, None

        # Step 2: Generate thumbnail at the kill moment
        # The kill happens at CLIP_BEFORE seconds into the clip
        thumb_time = config.CLIP_BEFORE
        subprocess.run([
            "ffmpeg", "-y",
            "-ss", str(thumb_time),
            "-i", clip_path,
            "-vframes", "1",
            "-q:v", "2",
            "-vf", "scale=640:-1",
            thumb_path,
        ], capture_output=True, timeout=30)

        # Step 3: Upload to R2
        clip_url = upload_to_r2(clip_path, f"clips/{clip_filename}", "video/mp4")
        thumb_url = None
        if os.path.exists(thumb_path):
            thumb_url = upload_to_r2(thumb_path, f"thumbnails/{thumb_filename}", "image/jpeg")

        # Clean up local files
        _cleanup(clip_path, thumb_path)

        return clip_url, thumb_url

    except Exception as e:
        log("error", "clipper", f"Failed to clip kill {kill_id}: {e}")
        _cleanup(clip_path, thumb_path)
        return None, None


def _fallback_clip(vod_url: str, start: float, duration: float, output_path: str) -> str | None:
    """Fallback: use yt-dlp to get stream URL, then ffmpeg to clip."""
    try:
        # Get direct URL
        result = subprocess.run(
            ["yt-dlp", "-f", "best[height<=720]", "--get-url", vod_url],
            capture_output=True, text=True, timeout=30,
        )
        stream_url = result.stdout.strip()
        if not stream_url:
            return None

        # Clip with ffmpeg
        subprocess.run([
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", stream_url,
            "-t", str(duration),
            "-c:v", "libx264",
            "-c:a", "aac",
            "-preset", "fast",
            "-crf", "23",
            output_path,
        ], capture_output=True, timeout=120)

        return output_path if os.path.exists(output_path) else None
    except Exception:
        return None


def upload_to_r2(file_path: str, key: str, content_type: str) -> str | None:
    """Upload a file to Cloudflare R2 using S3-compatible API."""
    if not config.R2_ACCOUNT_ID or not config.R2_ACCESS_KEY_ID:
        log("warn", "clipper", "R2 credentials not configured, skipping upload")
        return None

    try:
        # Use boto3-compatible approach via subprocess (aws cli)
        # or we can use httpx with S3v4 signing
        endpoint = f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

        # For simplicity, use subprocess with aws cli configured for R2
        subprocess.run([
            "aws", "s3", "cp",
            file_path,
            f"s3://{config.R2_BUCKET_NAME}/{key}",
            "--endpoint-url", endpoint,
            "--content-type", content_type,
        ], capture_output=True, timeout=60, env={
            **os.environ,
            "AWS_ACCESS_KEY_ID": config.R2_ACCESS_KEY_ID,
            "AWS_SECRET_ACCESS_KEY": config.R2_SECRET_ACCESS_KEY,
            "AWS_DEFAULT_REGION": "auto",
        })

        public_url = f"{config.R2_PUBLIC_URL}/{key}"
        return public_url

    except Exception as e:
        log("error", "clipper", f"R2 upload failed for {key}: {e}")
        return None


def _cleanup(*paths: str):
    """Remove temporary files."""
    for path in paths:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass


def run():
    """Process all kills that need clipping."""
    db = get_db()

    # Get kills ready for clipping (status = vod_found)
    kills = db.table("kills").select(
        "id, game_id, game_timestamp_ms, killer_champion, victim_champion"
    ).eq("status", "vod_found").limit(50).execute()

    if not kills.data:
        return

    log("info", "clipper", f"Processing {len(kills.data)} kills for clipping")

    for kill in kills.data:
        # Get game VOD info
        game = db.table("games").select(
            "vod_url, vod_offset_seconds, vod_offset_calibrated"
        ).eq("id", kill["game_id"]).single().execute()

        if not game.data or not game.data.get("vod_url"):
            continue

        vod_url = game.data["vod_url"]
        offset = game.data.get("vod_offset_seconds")

        if offset is None:
            # Can't clip without offset
            db.table("kills").update({"status": "vod_searching"}).eq("id", kill["id"]).execute()
            continue

        # Mark as clipping
        db.table("kills").update({"status": "clipping"}).eq("id", kill["id"]).execute()

        # Clip!
        clip_url, thumb_url = clip_kill(
            kill["id"],
            vod_url,
            offset,
            kill["game_timestamp_ms"],
            kill["killer_champion"],
            kill["victim_champion"],
        )

        if clip_url:
            db.table("kills").update({
                "clip_url": clip_url,
                "clip_thumbnail_url": thumb_url,
                "status": "ready",
                "processing_error": None,
            }).eq("id", kill["id"]).execute()
            log("info", "clipper", f"Kill {kill['id']} clipped successfully")
        else:
            db.table("kills").update({
                "status": "failed",
                "processing_error": "Clipping failed",
            }).eq("id", kill["id"]).execute()
            log("error", "clipper", f"Kill {kill['id']} clipping failed")
