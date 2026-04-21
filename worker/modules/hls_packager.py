"""
HLS_PACKAGER — Re-encode published clips into HLS multi-bitrate streams.

For each published kill that has a vertical MP4 but no HLS master URL:
1. Download the source MP4 from R2
2. Run ffmpeg to produce 3-variant HLS (240p / 480p / 720p)
3. Upload .m3u8 + .ts segments to R2 under hls/{kill_id}/
4. Update kills.hls_master_url

Daemon interval: 30 min. Cheap query (skips clips already packaged).
Caps at 5 clips per run to avoid R2 storage spikes.

NOTE: This module is OPTIONAL — the scroll player falls back to
clip_url_vertical MP4 when hls_master_url is null. Adds ~6-8 MB
of HLS variants per clip but enables adaptive bitrate on slow networks.
"""
from __future__ import annotations

import asyncio
import os
import sys
import subprocess
from pathlib import Path

import httpx
import structlog

from config import config
from services import r2_client
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()

MAX_PER_RUN = 5
HLS_DIR = os.path.join(os.path.dirname(__file__), "..", "hls_temp")


async def package_clip(kill_id: str, mp4_url: str) -> str | None:
    """Download MP4 + run ffmpeg HLS encode + upload to R2.

    Returns the master.m3u8 R2 URL on success, None on failure.
    """
    work_dir = os.path.join(HLS_DIR, kill_id)
    os.makedirs(work_dir, exist_ok=True)

    src_path = os.path.join(work_dir, "src.mp4")
    try:
        # Download source MP4
        log.info("hls_download_start", kill_id=kill_id[:8])
        with httpx.stream("GET", mp4_url, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            with open(src_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)

        # Run ffmpeg HLS encode
        # 3 variants: 240p / 480p / 720p
        log.info("hls_encode_start", kill_id=kill_id[:8])
        master_path = os.path.join(work_dir, "master.m3u8")
        cmd = [
            "ffmpeg", "-y", "-i", src_path,
            "-map", "0:v:0", "-map", "0:v:0", "-map", "0:v:0",
            "-map", "0:a?",
            "-c:v", "libx264", "-c:a", "aac",
            "-filter:v:0", "scale=-2:240", "-b:v:0", "400k", "-maxrate:v:0", "600k", "-bufsize:v:0", "800k",
            "-filter:v:1", "scale=-2:480", "-b:v:1", "1000k", "-maxrate:v:1", "1500k", "-bufsize:v:1", "2000k",
            "-filter:v:2", "scale=-2:720", "-b:v:2", "2500k", "-maxrate:v:2", "3500k", "-bufsize:v:2", "5000k",
            "-hls_time", "2", "-hls_playlist_type", "vod",
            "-hls_segment_filename", os.path.join(work_dir, "v%v_%03d.ts"),
            "-master_pl_name", "master.m3u8",
            "-var_stream_map", "v:0,a:0 v:1,a:0 v:2,a:0",
            os.path.join(work_dir, "v%v.m3u8"),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            log.error("hls_encode_timeout", kill_id=kill_id[:8])
            return None

        if proc.returncode != 0:
            err = (stderr or b"")[:300].decode("utf-8", "ignore")
            log.error("hls_encode_failed", kill_id=kill_id[:8], stderr=err)
            return None

        # Upload all .m3u8 + .ts files to R2
        log.info("hls_upload_start", kill_id=kill_id[:8])
        master_url = None
        for fname in os.listdir(work_dir):
            if not (fname.endswith(".m3u8") or fname.endswith(".ts")):
                continue
            local = os.path.join(work_dir, fname)
            key = f"hls/{kill_id}/{fname}"
            content_type = "application/vnd.apple.mpegurl" if fname.endswith(".m3u8") else "video/mp2t"
            url = await r2_client.upload(local, key, content_type=content_type)
            if fname == "master.m3u8":
                master_url = url

        return master_url

    except Exception as e:
        log.error("hls_package_error", kill_id=kill_id[:8], error=str(e)[:200])
        return None
    finally:
        # Cleanup work dir
        try:
            for f in os.listdir(work_dir):
                os.remove(os.path.join(work_dir, f))
            os.rmdir(work_dir)
        except Exception:
            pass


# ─── Daemon loop ─────────────────────────────────────────────────────────

async def run() -> int:
    """Find published clips without HLS master, package next 5."""
    log.info("hls_packager_start")

    # Get up to MAX_PER_RUN clips with MP4 but no HLS
    candidates = safe_select(
        "kills",
        "id, clip_url_vertical, hls_master_url",
        status="published",
        # hls_master_url IS NULL — Supabase REST doesn't support raw `is.null` via kwargs
        # Use a custom filter via httpx instead
    ) or []

    # Filter client-side to those without hls_master_url + with vertical clip
    pending = [
        k for k in candidates
        if not k.get("hls_master_url") and k.get("clip_url_vertical")
    ][:MAX_PER_RUN]

    if not pending:
        log.info("hls_packager_no_pending")
        return 0

    packaged = 0
    for kill in pending:
        kid = kill["id"]
        mp4_url = kill["clip_url_vertical"]
        log.info("hls_package_kill", kill_id=kid[:8])
        master_url = await package_clip(kid, mp4_url)
        if master_url:
            safe_update("kills", {"hls_master_url": master_url}, "id", kid)
            packaged += 1

    log.info("hls_packager_done", packaged=packaged)
    return packaged
