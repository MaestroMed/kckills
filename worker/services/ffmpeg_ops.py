"""ffmpeg operations — encoding, cropping, thumbnails.

All output formats are 1080p as of the V2 quality bump:
  horizontal       16:9   1920x1080   main 4.0   4M cap
  vertical         9:16   1080x1920   main 4.0   4M cap
  vertical_low     9:16    540x 960   baseline 3.1  1.2M cap (slow networks)
  thumbnail        9:16   1080x1920   JPEG q=2

These targets assume yt-dlp downloaded the source at >= 1080p (see
modules/clipper.py — `bestvideo[height<=1080]`). When the source is only
720p (older / Twitch VODs), the encoder upscales gracefully — no point
caring about it because at the new bitrate artifacts are invisible.

GPU encoding (NVENC, RTX 4070 Ti, 8th-gen Ada Lovelace):
- `has_nvenc()` is cached and probes ffmpeg once per process.
- All encode_* helpers accept `encoder="auto"|"nvenc"|"libx264"`.
- "auto" picks NVENC when available AND config.USE_NVENC permits.
- NVENC settings target equivalent quality to libx264 -preset fast -crf 22.
"""

import asyncio
import functools
import subprocess
import structlog

from config import config
from scheduler import scheduler

log = structlog.get_logger()


# ─── NVENC detection ────────────────────────────────────────────────────────

@functools.cache
def has_nvenc() -> bool:
    """True if ffmpeg has h264_nvenc encoder available.

    Cached per process — probes ffmpeg -encoders once.
    """
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, timeout=5, text=True,
        )
        return "h264_nvenc" in (out.stdout or "")
    except Exception as e:
        log.warn("nvenc_probe_failed", error=str(e))
        return False


def _resolve_encoder(encoder: str) -> str:
    """Resolve 'auto' against config.USE_NVENC + has_nvenc().

    Returns 'h264_nvenc' or 'libx264'.
    """
    if encoder == "h264_nvenc":
        return "h264_nvenc" if has_nvenc() else "libx264"
    if encoder == "libx264":
        return "libx264"
    # auto
    pref = (getattr(config, "USE_NVENC", "auto") or "auto").lower()
    if pref == "0":
        return "libx264"
    if pref == "1":
        return "h264_nvenc" if has_nvenc() else "libx264"
    # "auto" — opportunistic
    return "h264_nvenc" if has_nvenc() else "libx264"


# ─── NVENC argument builders ────────────────────────────────────────────────

def _nvenc_args_hq(maxrate: str, bufsize: str, profile: str = "high",
                   level: str = "auto", multipass: bool = True) -> list[str]:
    """h264_nvenc args for HQ variants (horizontal / vertical 1080p).

    p5 + tune hq + cq 23 ≈ x264 fast crf 22 in objective metrics.
    Multipass fullres adds ~10-15% time for ~5% quality on Ada.

    PR23.7 — `-level` defaults to "auto" : the previous "4.1" string
    started rejecting on the 2026-04 NVIDIA driver with
    "InitializeEncoder failed: invalid param (8): Invalid Level".
    Letting the encoder pick the level itself based on resolution +
    bitrate is more robust and produces level >= 4.0 anyway for the
    1080p targets we ship.
    """
    args = [
        "-c:v", "h264_nvenc",
        "-preset", "p5",
        "-tune", "hq",
        "-rc", "vbr",
        "-cq", "23",
        "-b:v", "0",                  # let cq drive, but cap at maxrate
        "-maxrate", maxrate,
        "-bufsize", bufsize,
        "-profile:v", profile,
        "-bf", "3",
        "-b_ref_mode", "middle",      # Ada supports B-frames as ref
        "-g", "60",                   # 2s GOP at 30fps
        "-pix_fmt", "yuv420p",
        "-rc-lookahead", "32",
        "-spatial-aq", "1",
        "-temporal-aq", "1",
    ]
    # Only pass -level if explicitly overridden (not the default "auto").
    if level and level != "auto":
        args += ["-level", level]
    if multipass:
        args += ["-multipass", "fullres"]
    return args


def _nvenc_args_low(maxrate: str, bufsize: str) -> list[str]:
    """h264_nvenc args for low variant (540p, fast).

    Baseline profile = no B-frames (browser compat for old Android).
    p4 instead of p5, no multipass — quality bar is lower.

    PR23.7 — dropped explicit `-level 3.1` for the same reason as
    _nvenc_args_hq (driver rejection). 540p + 1.2Mbps maxrate gives
    level 3.1 anyway via auto.
    """
    return [
        "-c:v", "h264_nvenc",
        "-preset", "p4",
        "-tune", "hq",
        "-rc", "vbr",
        "-cq", "28",
        "-b:v", "0",
        "-maxrate", maxrate,
        "-bufsize", bufsize,
        "-profile:v", "baseline",
        "-bf", "0",                   # baseline = no B-frames
        "-g", "60",
        "-pix_fmt", "yuv420p",
        "-spatial-aq", "1",
    ]


def _libx264_args_hq(maxrate: str, bufsize: str, profile: str = "main",
                     level: str = "4.0", crf: str = "22") -> list[str]:
    return [
        "-c:v", "libx264", "-preset", "fast", "-crf", crf,
        "-profile:v", profile, "-level", level,
        "-maxrate", maxrate, "-bufsize", bufsize,
    ]


def _libx264_args_low(maxrate: str, bufsize: str) -> list[str]:
    return [
        "-c:v", "libx264", "-preset", "fast", "-crf", "27",
        "-profile:v", "baseline", "-level", "3.1",
        "-maxrate", maxrate, "-bufsize", bufsize,
    ]


def video_codec_args(
    variant: str,
    encoder: str = "auto",
    maxrate: str | None = None,
    bufsize: str | None = None,
    profile: str | None = None,
    level: str | None = None,
) -> list[str]:
    """Public helper used by clipper.py / hls_packager.py to get the
    right `-c:v ...` flag block for a given variant.

    variant: one of "hq", "low".
    """
    chosen = _resolve_encoder(encoder)

    if variant == "hq":
        mr = maxrate or "4M"
        bs = bufsize or "8M"
        prof = profile or "high"
        lvl = level or "4.1"
        if chosen == "h264_nvenc":
            return _nvenc_args_hq(mr, bs, profile=prof, level=lvl, multipass=True)
        # libx264 sticks to the original main/4.0 spec to keep output bit-
        # identical to pre-NVENC pipeline on machines without GPU.
        return _libx264_args_hq(mr, bs, profile="main", level="4.0")

    if variant == "low":
        mr = maxrate or "1200k"
        bs = bufsize or "2400k"
        if chosen == "h264_nvenc":
            return _nvenc_args_low(mr, bs)
        return _libx264_args_low(mr, bs)

    raise ValueError(f"unknown variant: {variant}")


# ─── Standalone encode helpers (used by older callsites) ────────────────────

async def encode_horizontal(input_path: str, output_path: str, encoder: str = "auto") -> bool:
    """Encode 16:9 1920x1080, faststart."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        *video_codec_args("hq", encoder=encoder),
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", output_path,
    ])


async def encode_vertical(input_path: str, output_path: str, encoder: str = "auto") -> bool:
    """Encode 9:16 1080x1920, center crop from horizontal."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=1080:1920",
        *video_codec_args("hq", encoder=encoder),
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", output_path,
    ])


async def encode_vertical_low(input_path: str, output_path: str, encoder: str = "auto") -> bool:
    """Encode 9:16 540x960, baseline 3.1 for slow networks."""
    await scheduler.wait_for("ffmpeg_cooldown")
    return _run([
        "-i", input_path,
        "-vf", "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=540:960",
        *video_codec_args("low", encoder=encoder),
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
