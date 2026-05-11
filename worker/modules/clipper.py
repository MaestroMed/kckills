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
import socket
import sys
import structlog

from config import config
from scheduler import scheduler
from services import job_queue, r2_client
from services.clip_hash import content_hash, perceptual_hash
from services.ffmpeg_ops import video_codec_args
from services.local_paths import LocalPaths
from services.media_probe import probe_video
from services.observability import run_logged
from services.runtime_tuning import (
    get_batch_size,
    get_lease_seconds,
    get_parallelism,
)
from services.supabase_batch import batched_safe_insert, batched_safe_update, get_writer
from services.supabase_client import get_db, safe_select, safe_update

log = structlog.get_logger()

FFMPEG_TIMEOUT = 180  # seconds per ffmpeg invocation
# Wave 27.17 — bumped from 180 to 300s. Daemon log analysis shows
# ALL clip_download failures are pure asyncio.wait_for timeouts (zero
# ytdlp_throttled, zero ytdlp_nonzero, zero bot_blocked) on the LEC
# full-match VODs (~7700s @ 1080p60, ~2.5 GB total). yt-dlp does
# request only the --download-sections range, but parsing the
# manifest + locating the right HLS chunks for a deep timestamp can
# eat 60-90s before the 40-second segment download even starts. With
# the old 180s ceiling, the chronic-timeout VODs (Fiz9AWzVzEA: 22
# failures, bKj8k3dkEl0: 18 failures) used the entire budget on the
# locate phase and timed out before downloading. 300s gives the
# segment download enough headroom to finish on the slow VODs while
# not meaningfully slowing the fast path.
YTDLP_TIMEOUT = 600   # seconds for a single segment download
# Wave 27.31 — 300 was enough for LEC casts but KC Replay casts are
# 1-2 h long. Locating a deep timestamp (e.g. 1843s = 30 min into a
# 90-min HLS manifest) eats 100-200 s of the budget, then the actual
# 40 s segment download takes another 40-80 s, plus we're competing
# with up to 8 concurrent daemon downloads on the same scheduler.
# 300 s was failing on KC Replay reclips ; 600 s gives generous
# headroom while still bounding a runaway.


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


# PR-loltok DH : VODS_DIR now flows through services.local_paths so
# the same code lands on Mehdi's D:/ Gen5 NVMe in pilot mode and on
# /var/cache/kckills inside a Linux container. Override via
# KCKILLS_VODS_DIR / KCKILLS_DATA_ROOT.
VODS_DIR = LocalPaths.vods_dir()


def _check_vod_cache(vod_path: str, youtube_id: str) -> bool:
    """Sync helper — runs in a thread via asyncio.to_thread.
    Returns True iff a cached VOD exists AND is at least 10 MB
    (smaller files are presumed truncated downloads). Logs the hit
    so the operator's daily report sees the cache reuse rate."""
    if not os.path.exists(vod_path):
        return False
    try:
        size_mb = os.path.getsize(vod_path) / (1024 * 1024)
    except OSError:
        return False
    if size_mb <= 10:
        return False
    log.info("vod_cache_hit", youtube_id=youtube_id, size_mb=round(size_mb))
    return True


async def download_full_vod(youtube_id: str) -> str | None:
    """Download the full VOD once. Returns local path or None.

    This is the KEY fix for YouTube throttling: 1 download per VOD instead
    of N downloads per kill. The VOD is cached in worker/vods/ and reused
    for all kills in all games of the match.
    """
    os.makedirs(VODS_DIR, exist_ok=True)
    vod_path = os.path.join(VODS_DIR, f"{youtube_id}.mp4")

    # Wave 27.1 — both `os.path.exists` and `os.path.getsize` are
    # syscalls ; on a slow disk they can take 50-200 ms each. Wrap
    # them in `asyncio.to_thread` so the cache-hit fast path doesn't
    # block the event loop.
    cache_hit = await asyncio.to_thread(_check_vod_cache, vod_path, youtube_id)
    if cache_hit:
        return vod_path

    # Wave 27.1 — defensive timeout on the scheduler wait. If the
    # scheduler hangs (DB outage during quota probe, lock contention,
    # etc.), we'd wait forever and starve every other clipper worker
    # blocked behind the global `ytdlp` semaphore. 60 s is well above
    # the normal jitter (4 s delay) but bounds the worst case.
    try:
        can_dl = await asyncio.wait_for(scheduler.wait_for("ytdlp"), timeout=60)
    except asyncio.TimeoutError:
        log.warn("vod_download_scheduler_wait_timeout", youtube_id=youtube_id)
        return None
    if not can_dl:
        return None

    log.info("vod_download_start", youtube_id=youtube_id)
    vod_url = f"https://www.youtube.com/watch?v={youtube_id}"
    cmd = [
        sys.executable, "-m", "yt_dlp",
        *_cookies_args(),
        # YouTube post-2026-04 requires JS runtime + EJS challenge solver
        # to resolve the n-decoder. Without these, only image formats are
        # returned and the download fails with "Requested format not
        # available". deno is installed via winget, on PATH via main.py.
        "--js-runtimes", "deno",
        "--remote-components", "ejs:github",
        # Wave 27.30 — prefer the HLS muxed format (format 301 on a
        # typical KC Replay cast : mp4 1920x1080 60 m3u8 avc1+mp4a). This
        # is ONE single stream with audio embedded, so no merge step is
        # needed. Avoids both :
        #   - the AV1 segfault (Wave 27.29 H.264 fix) — HLS gives us avc1
        #   - the 3.75 GB video + 130 MB audio mux step failing silently
        #     and producing an audio-only output (yt-dlp / ffmpeg muxer
        #     bug on Windows that we hit repeatedly on KC Replay casts)
        # Fallback chain : muxed HLS -> separate avc1 video+audio merge
        # -> any 1080p video+audio -> best single stream.
        "-f", "best[protocol=m3u8_native][height<=1080][vcodec^=avc1]/"
              "best[protocol=m3u8_native][height<=1080]/"
              "bestvideo[vcodec^=avc1][height<=1080]+bestaudio/"
              "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "--merge-output-format", "mp4",
        # Wave 13e (2026-04-29) yt-dlp perf bumps — see _run_ytdlp() below.
        "--concurrent-fragments", "8",
        "--throttled-rate", "100K",
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
            # Wave 27.29 — bumped 600 -> 1800. KC Replay casts are 1-2 h
            # long ; at YouTube's typical throttled ~5 MB/s a 2.5-3 GB
            # 1080p VOD takes 9-12 min to download + ~60 s to merge
            # video+audio. The 600 s ceiling failed on every cast in the
            # smoke pass (Wave 27.28 reclip). 1800 s gives the merge
            # phase generous headroom while still bounding a runaway.
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=1800)
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
    game_id: str | None = None,
) -> dict | None:
    """Encode and upload a single kill clip. Returns dict of R2 URLs or None.

    If `local_vod_path` is provided (full VOD already downloaded), extracts
    the segment with ffmpeg directly — ZERO yt-dlp calls, ZERO throttle risk.
    Falls back to per-kill yt-dlp download if no local VOD.

    `game_id` is used to compute the versioned R2 key layout
    (`clips/{game_id}/{kill_id}/v{N}/{file}`) and to write the new
    `kill_assets` rows introduced in migration 026. When omitted, the
    versioned uploads are skipped and only the legacy flat keys are
    written — this preserves the path used by older callers (admin
    re-clip CLIs) that don't carry the parent game.
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
            *video_codec_args("hq"),
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
            *video_codec_args("hq"),
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
            *video_codec_args("low"),
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
            except Exception as e:
                # Wave 20.1 — was `pass`. A silent failure here means
                # this kill ships with no thumbnail OG card. The full
                # extraction can still succeed if other candidate
                # offsets work, so we log + continue rather than fail
                # the clip — but we WILL surface the issue now.
                log.warn(
                    "thumbnail_candidate_failed",
                    kill_id=kill_id,
                    offset_s=offset_s,
                    suffix=suffix,
                    error=str(e)[:160],
                )

        chosen = await asyncio.to_thread(_pick_best_thumbnail, thumb_candidates)
        if chosen and chosen != thumb_path:
            try:
                # Rename winner to canonical thumb_path
                if os.path.exists(thumb_path):
                    os.remove(thumb_path)
                os.rename(chosen, thumb_path)
            except OSError as e:
                # Fall back to copy if rename fails (cross-device)
                log.warn(
                    "thumbnail_rename_failed",
                    kill_id=kill_id,
                    src=chosen,
                    dst=thumb_path,
                    error=str(e)[:160],
                )
                import shutil
                try:
                    shutil.copy2(chosen, thumb_path)
                except OSError as e2:
                    # Both rename + copy failed — clip still has its
                    # primary thumb at thumb_path (or doesn't, in
                    # which case OG generation will skip). Log so the
                    # operator can investigate disk-full / permission
                    # issues before they cascade into broken OG cards.
                    log.error(
                        "thumbnail_copy_failed",
                        kill_id=kill_id,
                        src=chosen,
                        dst=thumb_path,
                        error=str(e2)[:160],
                    )
        # Cleanup the losers
        for cand in thumb_candidates:
            if cand != thumb_path and os.path.exists(cand):
                try:
                    os.remove(cand)
                except OSError as e:
                    # Disk-full / permission issue worth knowing about.
                    # Doesn't fail the clip — leftover candidate files
                    # accumulate until the disk-hygiene GC sweeps them.
                    log.warn(
                        "thumbnail_cleanup_failed",
                        kill_id=kill_id,
                        path=cand,
                        error=str(e)[:160],
                    )

        # ─── 6. Compute canonical hashes (Phase 1 foundation) ────────
        # SHA-256 dedups byte-identical re-encodes; pHash dedups visually
        # identical clips at different bitrates (community resubmissions).
        # Non-blocking: hash failures don't abort the upload.
        # Wave 27.1 — parallelised. SHA-256 on a 10 MB file is ~150 ms,
        # pHash via Pillow DCT is ~80 ms ; serialised they cost ~230 ms
        # per clip. asyncio.gather + to_thread runs them in parallel
        # (~150 ms total) without burning the event loop.
        thumb_exists = await asyncio.to_thread(os.path.exists, thumb_path)
        c_hash, p_hash = await asyncio.gather(
            asyncio.to_thread(content_hash, h_path),
            asyncio.to_thread(perceptual_hash, thumb_path) if thumb_exists else asyncio.sleep(0, result=None),
        )

        # ─── 7. Determine version + archive prior assets ─────────────
        # Version = max(version of existing kill_assets) + 1, or 1 if none.
        # Re-clipping flips prior is_current=TRUE rows to FALSE so the
        # frontend manifest only ever surfaces the latest set.
        version = await asyncio.to_thread(_compute_next_version, kill_id) if game_id else 1
        if game_id:
            await asyncio.to_thread(_archive_prior_assets, kill_id)

        # ─── 8. Upload everything to R2 in parallel ─────────────────
        # Both layouts go up : the LEGACY flat keys keep the
        # kills.clip_url_* columns working (back-compat), and the
        # VERSIONED keys feed the new kill_assets rows.
        legacy_uploads = [
            r2_client.upload_clip(kill_id, h_path, "h"),
            r2_client.upload_clip(kill_id, v_path, "v"),
            r2_client.upload_clip(kill_id, vl_path, "v_low") if os.path.exists(vl_path) else _noop(),
            r2_client.upload_clip(kill_id, thumb_path, "thumb") if os.path.exists(thumb_path) else _noop(),
        ]

        versioned_uploads: list = []
        if game_id:
            versioned_uploads = [
                r2_client.upload_versioned(game_id, kill_id, version, h_path, "horizontal"),
                r2_client.upload_versioned(game_id, kill_id, version, v_path, "vertical"),
                (
                    r2_client.upload_versioned(game_id, kill_id, version, vl_path, "vertical_low")
                    if os.path.exists(vl_path) else _noop()
                ),
                (
                    r2_client.upload_versioned(game_id, kill_id, version, thumb_path, "thumbnail")
                    if os.path.exists(thumb_path) else _noop()
                ),
            ]

        # Wave 13f: TaskGroup for atomic clip upload — if any of the 4
        # (or 8) uploads fail, the clip is broken anyway, so fail-fast and
        # let sibling uploads cancel cleanly instead of finishing wasted work.
        legacy_tasks: list[asyncio.Task] = []
        versioned_tasks: list[asyncio.Task] = []
        async with asyncio.TaskGroup() as tg:
            for coro in legacy_uploads:
                legacy_tasks.append(tg.create_task(coro))
            for coro in versioned_uploads:
                versioned_tasks.append(tg.create_task(coro))
        h_url, v_url, vl_url, thumb_url = [t.result() for t in legacy_tasks]
        if game_id:
            h_url_v, v_url_v, vl_url_v, thumb_url_v = [
                t.result() for t in versioned_tasks
            ]
        else:
            h_url_v, v_url_v, vl_url_v, thumb_url_v = (None, None, None, None)

        # ─── 9. Insert kill_assets rows for each artefact ────────────
        # Probing each file is cheap (~50ms each) and runs off-thread so
        # the gather above isn't blocked. probe_video tolerates failure
        # and returns {} → row goes in with NULL media metadata.
        if game_id:
            encoder_args = {
                "container": "mp4",
                "v_codec": "h264",
                "preset": "fast",
                "vf_horizontal": "scale=1920:1080:force_original_aspect_ratio=decrease,pad",
                "vf_vertical": v_filter,
                "vf_vertical_low": "crop=ih*9/16:ih:iw/2-ih*9/32:0,scale=540:960",
                "movflags": "+faststart",
                "a_codec": "aac",
                "a_bitrate_hq": "128k",
                "a_bitrate_low": "80k",
            }
            window_json = {"start": int(clip_start), "end": int(clip_end)}
            encoding_node = f"{socket.gethostname()}/{os.getpid()}"

            assets_to_insert = [
                ("horizontal",   h_path,     h_url_v,     h_url),
                ("vertical",     v_path,     v_url_v,     v_url),
                ("vertical_low", vl_path,    vl_url_v,    vl_url),
                ("thumbnail",    thumb_path, thumb_url_v, thumb_url),
            ]
            for asset_type, local_path, versioned_url, _legacy_url in assets_to_insert:
                if not versioned_url or not os.path.exists(local_path):
                    continue
                probe = await asyncio.to_thread(probe_video, local_path)
                try:
                    size = os.path.getsize(local_path)
                except OSError:
                    size = None

                # Per-asset hashes : SHA-256 always (cheap, byte-exact);
                # pHash only on thumbnail (DCT is the same data we need).
                # Reuse already-computed h_path / thumb_path hashes when we can.
                if asset_type == "horizontal":
                    asset_content_hash = c_hash
                    asset_phash = None
                elif asset_type == "thumbnail":
                    asset_content_hash = await asyncio.to_thread(content_hash, local_path)
                    asset_phash = p_hash
                else:
                    asset_content_hash = await asyncio.to_thread(content_hash, local_path)
                    asset_phash = None

                row = {
                    "kill_id": kill_id,
                    "version": version,
                    "type": asset_type,
                    "url": versioned_url,
                    "r2_key": r2_client.versioned_key(game_id, kill_id, version, asset_type),
                    "width": probe.get("width"),
                    "height": probe.get("height"),
                    "duration_ms": probe.get("duration_ms"),
                    "codec": probe.get("codec") or ("h264" if asset_type != "thumbnail" else None),
                    "bitrate_kbps": probe.get("bitrate_kbps"),
                    "size_bytes": size,
                    "content_hash": asset_content_hash,
                    "perceptual_hash": asset_phash,
                    "source_offset_seconds": int(vod_offset_seconds or 0),
                    "source_clip_window_seconds": window_json,
                    "encoder_args": encoder_args,
                    "encoding_node": encoding_node,
                    "is_current": True,
                }
                # Strip Nones so PostgREST doesn't reject (some columns
                # are NOT NULL — but width / height / duration_ms / etc
                # are nullable, so we only drop keys whose value is None
                # AND which aren't structurally required).
                row = {k: v for k, v in row.items() if v is not None}
                await batched_safe_insert("kill_assets", row)

        log.info(
            "clip_done",
            kill_id=kill_id,
            game_id=(game_id[:8] if game_id else None),
            version=version,
            h=bool(h_url), v=bool(v_url), vl=bool(vl_url), thumb=bool(thumb_url),
            h_versioned=bool(h_url_v), v_versioned=bool(v_url_v),
            content_hash=(c_hash[:12] + "...") if c_hash else None,
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
            *video_codec_args("hq"),
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
            *video_codec_args("hq"),
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
            *video_codec_args("low"),
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
        # Wave 13f: TaskGroup for atomic moment upload — outer try/except
        # catches the ExceptionGroup if any upload fails (returns None, sets
        # status=clip_error). Sibling uploads cancel cleanly.
        async with asyncio.TaskGroup() as tg:
            t_h = tg.create_task(r2_client.upload_moment(moment_id, h_path, "h"))
            t_v = tg.create_task(r2_client.upload_moment(moment_id, v_path, "v"))
            t_vl = tg.create_task(
                r2_client.upload_moment(moment_id, vl_path, "v_low")
                if os.path.exists(vl_path) else _noop()
            )
            t_thumb = tg.create_task(
                r2_client.upload_moment(moment_id, thumb_path, "thumb")
                if os.path.exists(thumb_path) else _noop()
            )
        h_url, v_url, vl_url, thumb_url = (
            t_h.result(), t_v.result(), t_vl.result(), t_thumb.result(),
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
    """Return yt-dlp cookie args.

    PR24 — delegates to services.youtube_cookies which supports two modes :
      * KCKILLS_YT_COOKIES_FILE       — Netscape cookies.txt path
      * KCKILLS_YT_COOKIES_CHROME_PROFILE — name/path of a Chrome profile
        that's NOT currently active (read SQLite directly + DPAPI-decrypt)

    With YouTube Premium auth :
      * 429s drop sharply (Premium accounts get priority)
      * Higher-quality formats unlocked
      * Age-gates bypassed

    Falls back to no cookies if neither env var is set — preserves the
    legacy anonymous-yt-dlp behaviour. Also keeps the old
    worker/cookies.txt convention for back-compat.
    """
    try:
        from services import youtube_cookies
        args = youtube_cookies.cli_args()
        if args:
            return args
    except Exception:
        pass

    # Legacy fallback : worker/cookies.txt sitting next to main.py
    legacy = os.path.join(os.path.dirname(__file__), "..", "cookies.txt")
    if os.path.exists(legacy):
        return ["--cookies", legacy]
    return []


async def _run_ytdlp(url: str, output_path: str, start: float, end: float) -> bool:
    """Run yt-dlp via `python -m yt_dlp` to stay cross-platform and venv-safe."""
    cmd = [
        sys.executable, "-m", "yt_dlp",
        *_cookies_args(),
        # YouTube post-2026-04 requires JS runtime + EJS challenge solver
        # to resolve the n-decoder. Without these, only image formats are
        # returned and the download fails with "Requested format not
        # available". deno is installed via winget, on PATH via main.py.
        "--js-runtimes", "deno",
        "--remote-components", "ejs:github",
        "--download-sections", f"*{start}-{end}",
        "--force-keyframes-at-cuts",
        # Wave 27.31 — prefer H.264 (avc1) over AV1 for the same reason
        # as download_full_vod : the vertical filter chain (drawtext +
        # h264_nvenc) segfaults on AV1 input on Windows. The HLS muxed
        # format is the cleanest path (single stream, no merge needed).
        # Fallback chain mirrors download_full_vod's selector.
        "-f", "best[protocol=m3u8_native][height<=1080][vcodec^=avc1]/"
              "best[protocol=m3u8_native][height<=1080]/"
              "bestvideo[vcodec^=avc1][height<=1080]+bestaudio/"
              "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "--merge-output-format", "mp4",
        # Wave 13e (2026-04-29) yt-dlp perf bumps :
        # * --concurrent-fragments 8 : parallel HLS/DASH fragment download
        #   (default=1 serialises every .ts chunk, this gives 2-3× speedup)
        # * --throttled-rate 100K : auto-restart segment if YouTube starts
        #   throttling instead of stalling at 5 KB/s for minutes
        "--concurrent-fragments", "8",
        "--throttled-rate", "100K",
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
            stderr_text = (stderr or b"")[:400].decode("utf-8", "ignore")
            # YouTube anti-bot detection : when this fires, EVERY clip
            # request fails until cookies are provided. Don't burn the
            # batch's retry budget on a global outage — raise a sentinel
            # exception so the caller can drop out of the batch entirely.
            if "Sign in to confirm" in stderr_text or "not a bot" in stderr_text:
                log.error("ytdlp_bot_blocked",
                          hint="add worker/cookies.txt — see clipper._cookies_args docstring")
                raise YouTubeBotBlockedError()
            log.warn("ytdlp_nonzero", rc=proc.returncode, stderr=stderr_text)
            return False
        return True
    except FileNotFoundError:
        log.error("ytdlp_not_installed")
        return False


class YouTubeBotBlockedError(Exception):
    """Raised by _run_ytdlp when YouTube returns the 'Sign in to confirm
    you're not a bot' error. The caller should abort the batch and
    NOT bump retry_count — the failure is external."""


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


# ─── kill_assets versioning helpers ──────────────────────────────────────

# Keep these synchronous (called via asyncio.to_thread) — the underlying
# Supabase REST calls are httpx.Client.get/post, not async. Wrapping in a
# thread keeps the worker event loop from blocking on the round-trip.

# Asset types written by the clipper. The `og_image` and `hls_master`
# variants are produced by separate modules (og_generator, hls_packager)
# and must NOT be archived here — only the four formats this module owns.
_CLIPPER_OWNED_ASSET_TYPES = ("horizontal", "vertical", "vertical_low", "thumbnail")


def _compute_next_version(kill_id: str) -> int:
    """Return the next version number for a kill's assets.

    Reads MAX(version) from kill_assets WHERE kill_id = kill_id and
    returns max+1. Returns 1 when no rows exist or on any failure
    (PostgREST down, table missing — pre-026 deployments).
    """
    db = get_db()
    if db is None:
        return 1
    try:
        import httpx
        r = httpx.get(
            f"{db.base}/kill_assets",
            headers=db.headers,
            params={
                "select": "version",
                "kill_id": f"eq.{kill_id}",
                "order": "version.desc",
                "limit": "1",
            },
            timeout=10.0,
        )
        if r.status_code != 200:
            return 1
        rows = r.json() or []
        if not rows:
            return 1
        cur = int(rows[0].get("version") or 0)
        return cur + 1 if cur > 0 else 1
    except Exception as e:
        log.warn("kill_assets_version_lookup_failed",
                 kill_id=kill_id[:8], error=str(e)[:160])
        return 1


def _archive_prior_assets(kill_id: str) -> None:
    """Flip is_current=FALSE on all current clipper-owned assets for a kill.

    Required before inserting v{N+1} rows so the unique index
    `idx_kill_assets_one_current_per_type` doesn't reject the new rows.
    No-op if nothing matches. Errors are logged + swallowed so a re-clip
    can still proceed (worst case the trigger leaves an inconsistent
    manifest and the next clipper pass corrects it).
    """
    db = get_db()
    if db is None:
        return
    try:
        import httpx
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        # PostgREST PATCH with `id=eq.kill` + type=in.(...) flips just the
        # rows we're about to replace.
        types_csv = ",".join(_CLIPPER_OWNED_ASSET_TYPES)
        r = httpx.patch(
            f"{db.base}/kill_assets",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={
                "kill_id": f"eq.{kill_id}",
                "is_current": "eq.true",
                "type": f"in.({types_csv})",
            },
            json={"is_current": False, "archived_at": now_iso},
            timeout=10.0,
        )
        if r.status_code >= 400:
            log.warn("kill_assets_archive_nonzero",
                     kill_id=kill_id[:8], status=r.status_code, body=r.text[:160])
    except Exception as e:
        log.warn("kill_assets_archive_failed",
                 kill_id=kill_id[:8], error=str(e)[:160])


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

# Cap how many kills we attempt per pass + worker fan-out.
#
# These two scalars are now resolved at module-import time via
# services.runtime_tuning, which reads :
#   KCKILLS_BATCH_CLIPPER     (default 200)
#   KCKILLS_PARALLEL_CLIPPER  (default 8 — NVENC fan-out on RTX 4070 Ti)
#
# History (preserved for context):
#   With CONCURRENCY=6 workers at ~25s/clip (now that ffmpeg_cooldown
#   dropped 5s -> 1s), 200 clips = ~14 min per pass. The 300s daemon
#   interval keeps ticking during the pass, so the next run fires
#   immediately after if there's still a backlog. On a 16-core Ryzen the
#   bottleneck is yt-dlp throttle (scheduler-managed), not ffmpeg or disk I/O.
#   Empirical max throughput : ~400 clips/hour, validated without YouTube
#   429s on a residential IP.
#
#   CONCURRENCY raised 6 -> 8 for NVENC: GPU is the bottleneck on RTX 4070 Ti.
#   Ada Lovelace can run 8 concurrent NVENC sessions per consumer card
#   (limit enforced by NVIDIA driver). Each clipper worker also spawns
#   yt-dlp + ffmpeg, but ffmpeg now offloads encode to the GPU so CPU
#   contention drops.
BATCH_SIZE = get_batch_size("clipper")
CONCURRENCY = get_parallelism("clipper")
CLIP_LEASE_SECONDS = get_lease_seconds("clipper")


@run_logged()
async def run() -> int:
    """Clipper main loop — queue-first, legacy scan as fallback.

    Order :
      1. Try claiming `clip.create` jobs from pipeline_jobs (new path).
      2. If the queue returns empty, fall back to the legacy
         status='vod_found' / 'clip_error' scan AND enqueue any kills
         it finds so the next pass goes through the queue cleanly.
         This bridges the migration window — no kill gets stuck.
      3. Process up to BATCH_SIZE kills in parallel (CONCURRENCY=8).
      4. On success : flip kills.status='clipped', enqueue downstream
         `clip.analyze` job.
      5. On failure : let job_queue.fail() handle retry/DLQ. Keep
         legacy retry_count++ for back-compat with /admin/clips.

    Returns the number of kills successfully clipped this pass.
    """
    log.info("clipper_scan_start")

    worker_id = f"clipper-{os.getpid()}"

    # ─── 1. Queue-first claim ──────────────────────────────────────
    claimed = await asyncio.to_thread(
        job_queue.claim,
        worker_id,
        ["clip.create"],
        BATCH_SIZE,
        CLIP_LEASE_SECONDS,  # default 600s ; tunable via KCKILLS_LEASE_CLIPPER
    )

    legacy_fallback_used = False

    # Each claimed entry is a pipeline_jobs row. Build the (kill, job)
    # pairs we'll process. job is None for legacy-fallback work.
    work: list[tuple[dict, dict | None]] = []

    for job in claimed:
        kill_id = job.get("entity_id")
        if not kill_id:
            await asyncio.to_thread(
                job_queue.fail, job["id"], "no entity_id on job",
                60, "bad_payload",
            )
            continue
        rows = safe_select(
            "kills",
            "id, game_id, game_time_seconds, status, retry_count",
            id=kill_id,
        )
        if not rows:
            await asyncio.to_thread(
                job_queue.fail, job["id"], "kill row missing",
                3600, "kill_deleted",
            )
            continue
        work.append((rows[0], job))

    # ─── 2. Legacy fallback if queue was empty ────────────────────
    if not work:
        legacy_fallback_used = True

        fresh_kills = safe_select(
            "kills",
            "id, game_id, game_time_seconds, status, retry_count",
            status="vod_found",
        ) or []

        # Retry queue : push the retry_count<MAX filter into SQL so we
        # don't hit PostgREST's 1000-row default cap with all retry=3.
        retry_kills: list[dict] = []
        try:
            import httpx
            db = get_db()
            if db is not None:
                r = httpx.get(
                    f"{db.base}/kills",
                    headers=db.headers,
                    params={
                        "select": "id,game_id,game_time_seconds,status,retry_count",
                        "status": "eq.clip_error",
                        "retry_count": f"lt.{MAX_RETRY_COUNT}",
                        "order": "retry_count.asc,updated_at.asc",
                        "limit": "1000",
                    },
                    timeout=20.0,
                )
                if r.status_code == 200:
                    retry_kills = r.json() or []
        except Exception:
            retry_kills = [
                k for k in (safe_select(
                    "kills",
                    "id, game_id, game_time_seconds, status, retry_count",
                    status="clip_error",
                ) or [])
                if int(k.get("retry_count") or 0) < MAX_RETRY_COUNT
            ]

        all_kills = fresh_kills + retry_kills
        kills = all_kills[:BATCH_SIZE]

        if not kills:
            log.info("clipper_no_pending")
            return 0

        # Enqueue every legacy-found kill so subsequent passes go
        # through the queue. enqueue() is idempotent via the unique
        # index on (type, entity_type, entity_id) WHERE active.
        enqueued = 0
        for k in kills:
            jid = await asyncio.to_thread(
                job_queue.enqueue,
                "clip.create", "kill", k["id"],
                None, 50, None, MAX_RETRY_COUNT,
            )
            if jid:
                enqueued += 1
        log.info(
            "clipper_legacy_fallback",
            fresh=len(fresh_kills), retry=len(retry_kills),
            processing=len(kills), enqueued_for_next_pass=enqueued,
        )
        # Process the kills NOW (don't wait for next pass) so the
        # transition from legacy → queue is seamless. job=None signals
        # legacy-mode handling in the worker below.
        work = [(k, None) for k in kills]
    else:
        log.info(
            "clipper_queue",
            claimed=len(claimed), processing=len(work),
        )

    # ─── 3. Parallel clip workers ─────────────────────────────────
    sem = asyncio.Semaphore(CONCURRENCY)
    counters = {"ok": 0, "fail": 0, "yt_blocked": 0}

    async def _process_one(kill: dict, job: dict | None):
        async with sem:
            # Fetch parent game to find the VOD info
            games = safe_select(
                "games",
                "vod_youtube_id, vod_offset_seconds",
                id=kill.get("game_id", ""),
            )
            if not games:
                if job is not None:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        "parent game missing", 3600, "game_missing",
                    )
                return
            game = games[0]
            yt_id = game.get("vod_youtube_id")
            offset = int(game.get("vod_offset_seconds") or 0)
            if not yt_id:
                # No VOD yet — surface as retry, the vod_offset_finder
                # will fill it in. 30 min retry lets that module run.
                if job is not None:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        "vod_youtube_id null on game", 1800, "no_vod",
                    )
                return

            # PR10-A : batched_safe_update collapses the N status='clipping'
            # writes per cycle into ONE PATCH (id=in.(uuid1,uuid2,...)) — same
            # for the status='clipped' writes once they all flush together.
            await batched_safe_update("kills", {"status": "clipping"}, "id", kill["id"])

            try:
                urls = await clip_kill(
                    kill_id=kill["id"],
                    youtube_id=yt_id,
                    vod_offset_seconds=offset,
                    game_time_seconds=int(kill.get("game_time_seconds") or 0),
                    game_id=kill.get("game_id") or None,
                )
            except YouTubeBotBlockedError:
                # YouTube is anti-bot-blocking the entire process. Don't
                # bump retry_count (it's not the kill's fault) and DON'T
                # leave the kill in 'clipping' (would never recover).
                # For queue jobs : 10 min retry so the queue naturally
                # rate-limits during the outage.
                prior = "clip_error" if kill.get("status") == "clip_error" else "vod_found"
                await batched_safe_update("kills", {"status": prior}, "id", kill["id"])
                if job is not None:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        "youtube_bot_blocked", 600, "ytdlp_bot_blocked",
                    )
                counters["yt_blocked"] += 1
                # Re-raise so the gather sees it and the batch-level log fires.
                raise

            if urls and urls.get("clip_url_horizontal"):
                payload = {**urls, "status": "clipped"}
                payload.pop("_local_h_path", None)
                await batched_safe_update("kills", payload, "id", kill["id"])
                try:
                    from services.event_qc import tick_qc_clip_produced
                    tick_qc_clip_produced(kill["id"])
                except Exception as _e:
                    log.warn("event_qc_tick_failed", kill_id=kill["id"][:8], stage="clip_produced", error=str(_e)[:120])

                # Mark queue success + enqueue downstream analyze.
                # Inherit priority bracket from the parent job so editorial /
                # live work keeps its lane through the pipeline.
                priority = 50
                if job is not None:
                    try:
                        priority = 70 if int(job.get("priority") or 50) >= 70 else 50
                    except Exception:
                        priority = 50
                    await asyncio.to_thread(
                        job_queue.succeed, job["id"],
                        {"clip_url_horizontal": urls.get("clip_url_horizontal")},
                    )
                await asyncio.to_thread(
                    job_queue.enqueue,
                    "clip.analyze", "kill", kill["id"],
                    None, priority, None, 3,
                )
                counters["ok"] += 1
            else:
                await batched_safe_update(
                    "kills",
                    {"status": "clip_error", "retry_count": int(kill.get("retry_count") or 0) + 1},
                    "id",
                    kill["id"],
                )
                if job is not None:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        "clip_kill returned no urls", 300, "clip_failed",
                    )
                counters["fail"] += 1

    # Start the background flusher BEFORE the worker fan-out so writes
    # batch as they happen, not all at the end.
    await get_writer().start_background_flusher()
    # Wave 13f: NOT migrated to TaskGroup — kills are independent units of
    # work and we explicitly want best-effort isolation. A bot-blocked kill
    # in one worker shouldn't cancel the other in-flight kills mid-encode.
    # return_exceptions=True keeps the per-kill failures visible to the
    # post-gather loop that counts YouTubeBotBlockedError for the batch
    # summary log. TaskGroup's "cancel all siblings on first error" semantic
    # would lose work and break that audit log. Keep gather().
    results = await asyncio.gather(
        *(_process_one(k, j) for (k, j) in work),
        return_exceptions=True,
    )
    # Drain the tail of the buffer so the next module sees a consistent
    # DB state immediately.
    await get_writer().flush_now()

    yt_blocked = sum(
        1 for r in results if isinstance(r, YouTubeBotBlockedError)
    )
    if yt_blocked > 0:
        log.error(
            "clipper_yt_blocked_batch_aborted",
            yt_blocked=yt_blocked, batch_size=len(work),
            hint="put a cookies.txt in worker/ exported from a logged-in browser",
        )

    log.info(
        "clipper_scan_done",
        processed=counters["ok"], failed=counters["fail"],
        yt_blocked=counters["yt_blocked"],
        legacy_fallback=legacy_fallback_used,
    )
    return counters["ok"]
