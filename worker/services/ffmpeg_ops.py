"""ffmpeg operations — encoding, cropping, thumbnails."""

import subprocess
import structlog
from scheduler import scheduler

log = structlog.get_logger()


async def encode_horizontal(input_path: str, output_path: str) -> bool:
    """Encode 16:9 1280x720, H.264 main 3.1, faststart."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-maxrate", "2M", "-bufsize", "4M",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        "-y", output_path,
    ])


async def encode_vertical(input_path: str, output_path: str) -> bool:
    """Encode 9:16 720x1280, center crop from horizontal."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=720:1280",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-maxrate", "2M", "-bufsize", "4M",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        "-y", output_path,
    ])


async def encode_vertical_low(input_path: str, output_path: str) -> bool:
    """Encode 9:16 360x640, baseline 3.0 for slow networks."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=360:640",
        "-c:v", "libx264", "-preset", "fast", "-crf", "28",
        "-profile:v", "baseline", "-level", "3.0",
        "-maxrate", "800k", "-bufsize", "1600k",
        "-c:a", "aac", "-b:a", "64k",
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
        result = subprocess.run(["ffmpeg"] + args, capture_output=True, timeout=120)
        return result.returncode == 0
    except Exception as e:
        log.error("ffmpeg_error", error=str(e))
        return False
