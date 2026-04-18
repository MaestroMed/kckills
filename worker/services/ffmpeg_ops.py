"""ffmpeg operations — encoding, cropping, thumbnails.

All output formats are 1080p as of the V2 quality bump:
  horizontal       16:9   1920x1080   main 4.0   4M cap
  vertical         9:16   1080x1920   main 4.0   4M cap
  vertical_low     9:16    540x 960   baseline 3.1  1.2M cap (slow networks)
  thumbnail        9:16   1080x1920   JPEG q=2

These targets assume yt-dlp downloaded the source at >= 1080p (see
modules/clipper.py — `bestvideo[height<=1080]`). When the source is only
720p (older / Twitch VODs), libx264 upscales gracefully — no point caring
about it because the H.264 encoder is fast enough to do the work without
visible artifacts at the new bitrate.
"""

import subprocess
import structlog
from scheduler import scheduler

log = structlog.get_logger()


async def encode_horizontal(input_path: str, output_path: str) -> bool:
    """Encode 16:9 1920x1080, H.264 main 4.0, faststart."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-profile:v", "main", "-level", "4.0",
        "-maxrate", "4M", "-bufsize", "8M",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", output_path,
    ])


async def encode_vertical(input_path: str, output_path: str) -> bool:
    """Encode 9:16 1080x1920, center crop from horizontal."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=1080:1920",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-profile:v", "main", "-level", "4.0",
        "-maxrate", "4M", "-bufsize", "8M",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", output_path,
    ])


async def encode_vertical_low(input_path: str, output_path: str) -> bool:
    """Encode 9:16 540x960, baseline 3.1 for slow networks."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=540:960",
        "-c:v", "libx264", "-preset", "fast", "-crf", "27",
        "-profile:v", "baseline", "-level", "3.1",
        "-maxrate", "1200k", "-bufsize", "2400k",
        "-c:a", "aac", "-b:a", "80k",
        "-movflags", "+faststart",
        "-y", output_path,
    ])


async def extract_thumbnail(input_path: str, output_path: str, at_seconds: float = 0) -> bool:
    """Extract a single frame as JPEG thumbnail."""
    return _run([
        "-ss", str(at_seconds),
        "-i", input_path,
        "-vframes", "1",
        "-q:v", "2",
        "-y", output_path,
    ])


def _run(args: list[str]) -> bool:
    try:
        result = subprocess.run(["ffmpeg"] + args, capture_output=True, timeout=180)
        return result.returncode == 0
    except Exception as e:
        log.error("ffmpeg_error", error=str(e))
        return False
