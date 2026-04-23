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

# Bumped 5 -> 25 after the clipper boost (200 clips/pass) — without this
# the HLS packager would run 1h behind the clipper, leaving published
# clips MP4-only for too long. With CONCURRENCY=3 each cycle finishes in
# ~3 min wall time (25 clips × ~20s / 3 workers ≈ 170s), comfortably
# under the 30min daemon interval.
MAX_PER_RUN = 25
# Parallel ffmpeg workers per HLS pass. Each ffmpeg already saturates
# ~6 cores via `-threads 0`, so 3 concurrent encodes on a 16-core box
# leaves headroom for the rest of the daemon (clipper, analyzer downloads).
CONCURRENCY = 4
# HLS_DIR now comes from config (defaults to D:/kckills_worker/hls_temp
# on the user's Gen5 NVMe, falls back to worker/hls_temp). This is an
# I/O hot path — each clip writes ~40-80MB of .ts segments here during
# encoding before upload to R2.
HLS_DIR = config.HLS_DIR


async def _source_has_audio(src_path: str) -> bool:
    """Return True if the source file contains at least one audio stream.

    Uses ffprobe (shipped with ffmpeg). Falls back to True on probe
    failure — better to crash on the encode and learn than to silently
    drop audio when it was actually present.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            src_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        return b"audio" in (stdout or b"")
    except Exception:
        # Probe failed — assume present. The encode either works or
        # surfaces the real issue in its stderr.
        return True


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
        # Detect audio presence — drives the var_stream_map syntax.
        has_audio = await _source_has_audio(src_path)

        # ffmpeg 5+ HLS multi-variant — use -filter_complex split instead
        # of -map 0:v:0 repeated. The old approach blew up on libx264
        # with "Variant stream info update failed / incorrect codec
        # parameters" because var_stream_map could not resolve the
        # repeated source maps cleanly.
        # Fix: split the source video into 3 labelled outputs, scale each
        # to its target height, then map each label as its own variant.
        # Audio is mapped 3 times (one per variant) when present so the
        # var_stream_map a:0/a:1/a:2 references resolve correctly.

        # 4 variants: 240p / 480p / 720p / 1080p. Source is 1080p (post
        # 1080p quality bump), so the 1080p variant is just a re-encode
        # at higher bitrate, not an upscale. Adaptive bitrate negotiation
        # in hls.js / Safari native picks the right variant per device.
        # Pick codec — h264_nvenc on Ada (RTX 4070 Ti), libx264 fallback.
        # NVENC consumer cards = 8 sessions/process; this filter_complex
        # opens 4 sessions in one ffmpeg = well within budget.
        from services.ffmpeg_ops import _resolve_encoder
        vcodec = _resolve_encoder("auto")

        if vcodec == "h264_nvenc":
            # NVENC per-output args. p4 + tune hq is balanced for ABR ladder.
            # No multipass on HLS — wall time matters more than 5% quality
            # because hls.js negotiates the variant down anyway.
            def _nv(idx: str, b: str, mx: str, bs: str) -> list[str]:
                return [
                    "-c:v:" + idx, "h264_nvenc",
                    "-preset:v:" + idx, "p4",
                    "-tune:v:" + idx, "hq",
                    "-rc:v:" + idx, "vbr",
                    "-b:v:" + idx, b,
                    "-maxrate:v:" + idx, mx,
                    "-bufsize:v:" + idx, bs,
                    "-bf:v:" + idx, "3",
                    "-b_ref_mode:v:" + idx, "middle",
                    "-pix_fmt:v:" + idx, "yuv420p",
                ]
            variant_args = (
                ["-map", "[v1out]", *_nv("0", "400k", "600k", "800k")] +
                ["-map", "[v2out]", *_nv("1", "1000k", "1500k", "2000k")] +
                ["-map", "[v3out]", *_nv("2", "2500k", "3500k", "5000k")] +
                ["-map", "[v4out]", *_nv("3", "5000k", "7000k", "10000k")]
            )
        else:
            variant_args = [
                # Variant 0 — 240p (slow 3G fallback)
                "-map", "[v1out]", "-c:v:0", "libx264",
                "-b:v:0", "400k", "-maxrate:v:0", "600k", "-bufsize:v:0", "800k",
                # Variant 1 — 480p (3G+ / shaky 4G)
                "-map", "[v2out]", "-c:v:1", "libx264",
                "-b:v:1", "1000k", "-maxrate:v:1", "1500k", "-bufsize:v:1", "2000k",
                # Variant 2 — 720p (4G / mid-tier mobile)
                "-map", "[v3out]", "-c:v:2", "libx264",
                "-b:v:2", "2500k", "-maxrate:v:2", "3500k", "-bufsize:v:2", "5000k",
                # Variant 3 — 1080p (5G / wifi / desktop)
                "-map", "[v4out]", "-c:v:3", "libx264",
                "-b:v:3", "5000k", "-maxrate:v:3", "7000k", "-bufsize:v:3", "10000k",
            ]

        cmd = [
            "ffmpeg", "-y", "-i", src_path,
            "-filter_complex",
            "[0:v]split=4[v1][v2][v3][v4];"
            "[v1]scale=-2:240[v1out];"
            "[v2]scale=-2:480[v2out];"
            "[v3]scale=-2:720[v3out];"
            "[v4]scale=-2:1080[v4out]",
            *variant_args,
        ]
        if has_audio:
            cmd += [
                # Audio mapped once per variant — var_stream_map needs
                # one a:N per v:N reference.
                "-map", "a:0", "-map", "a:0", "-map", "a:0", "-map", "a:0",
                "-c:a", "aac", "-b:a", "96k", "-ac", "2",
            ]
        cmd += [
            # Force keyframe alignment for clean 2s segments — without
            # this ffmpeg may produce mis-aligned segments that the
            # player chokes on at variant switch.
            "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
            "-f", "hls",
            "-hls_time", "2",
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", os.path.join(work_dir, "v%v_%03d.ts"),
            "-master_pl_name", "master.m3u8",
            "-var_stream_map",
            (
                "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3"
                if has_audio
                else "v:0 v:1 v:2 v:3"
            ),
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

    log.info("hls_packager_queue", pending=len(pending), workers=CONCURRENCY)

    sem = asyncio.Semaphore(CONCURRENCY)
    counters = {"packaged": 0, "failed": 0}

    async def _process(kill: dict):
        async with sem:
            kid = kill["id"]
            mp4_url = kill["clip_url_vertical"]
            log.info("hls_package_kill", kill_id=kid[:8])
            try:
                master_url = await package_clip(kid, mp4_url)
            except Exception as e:
                log.error("hls_package_crash", kill_id=kid[:8], error=str(e)[:200])
                counters["failed"] += 1
                return
            if master_url:
                safe_update("kills", {"hls_master_url": master_url}, "id", kid)
                counters["packaged"] += 1
            else:
                counters["failed"] += 1

    await asyncio.gather(*[_process(k) for k in pending], return_exceptions=False)

    log.info(
        "hls_packager_done",
        packaged=counters["packaged"],
        failed=counters["failed"],
        attempted=len(pending),
    )
    return counters["packaged"]
