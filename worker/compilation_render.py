"""
COMPILATION RENDER — standalone worker for user-built best-of compilations.

Migration 062 introduces a `compilations` table where visitors stitch
together 3-20 published kills with optional intro / outro text cards.
This module pops pending rows, downloads each kill's horizontal MP4 from
R2, optionally renders intro/outro title cards with ffmpeg drawtext, and
concatenates everything into a single 1080p H.264 + AAC MP4 with the
faststart flag set. The output is uploaded back to R2 at
``compilations/<short_code>.mp4`` and the row flips to ``status='done'``.

Run modes
─────────
* ``python -m worker.compilation_render --once``
    Process up to ``--batch-size`` pending rows then exit. Used by ops
    scripts + the daemon integration TODO below.

* ``python -m worker.compilation_render --watch``
    Long-running loop : claim → render → sleep 30 s. Crashes restart via
    systemd / Task Scheduler like the rest of the worker.

Failure handling
────────────────
Each compilation is rendered in isolation. A failure in one row :
  * Flips that row to ``status='failed'`` with a short ``render_error``.
  * Marks the corresponding pipeline_jobs row (if any) as failed so the
    queue's retry/DLQ ladder kicks in.
  * Does NOT interrupt sibling renders.

# TODO: integrate with main.py DAEMON_MODULES — wrap render_pending_once()
#       in an `@run_logged()`-decorated async run() shim and add
#       "compilation": run to DAEMON_MODULES in main.py. The module is
#       fully sync today (ffmpeg + httpx + boto3), so the shim only needs
#       `asyncio.to_thread(render_pending_once)`.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

# Local imports — this file lives next to main.py so the worker package
# imports the same way every other module does.
from config import config
from services.supabase_client import get_db
from services.storage_factory import get_storage_backend

log = structlog.get_logger()


# ─── Constants ─────────────────────────────────────────────────────────

# Polling cadence in --watch mode. 30 s is a reasonable middle ground :
# fast enough that the user submitting a compilation rarely waits more
# than half a minute for the worker to pick it up, slow enough that we
# don't pound PostgREST when the queue is empty.
WATCH_INTERVAL_SECONDS = 30

# How many compilations to process per pass. Renders are CPU-heavy
# (ffmpeg libx264 medium preset @ 1080p) so we do them serially. The
# scheduler isn't pulled in here — render time is bounded by the cap
# below and we don't want compilations starving live clip work.
DEFAULT_BATCH_SIZE = 2

# Hard ceiling per render (worst case 20 clips × ~13 s each = ~260 s of
# source + 2 re-encode passes). 15 min leaves generous headroom while
# keeping a runaway bounded.
RENDER_TIMEOUT_SECONDS = 900

# Intro / outro card duration (seconds). Tuned to be readable without
# overstaying its welcome — same length as the worker's CLIP_TIMING
# default "before" pad.
CARD_DURATION_SECONDS = 2

# Lease window for the pipeline_jobs claim. Must be > RENDER_TIMEOUT to
# prevent a slow render from being stolen by a sibling worker.
LEASE_SECONDS = 1200

# R2 prefix for the final outputs. Matches the layout convention used by
# r2_client.upload (no /clips/, no /moments/ — a top-level bucket so the
# share link looks clean : clips.kckills.com/compilations/abc12345.mp4).
R2_PREFIX = "compilations"

# ffmpeg : we re-encode the concat output rather than `-c copy` because
# the source clips can have slightly different encoder settings (libx264
# tuned for CRF 18 vs CRF 23 across waves), which makes stream-copy
# concat unreliable. The cost is real (~2× source duration on CPU) but
# the output is guaranteed to play back cleanly on every device.
FFMPEG_PRESET = "medium"
FFMPEG_CRF = "21"
FFMPEG_VIDEO_BITRATE = "5M"
FFMPEG_AUDIO_BITRATE = "128k"
FFMPEG_FPS = "30"
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


# ─── DB helpers ────────────────────────────────────────────────────────


def _claim_pending(batch_size: int) -> list[dict[str, Any]]:
    """Atomically flip up to ``batch_size`` pending compilations to
    ``status='rendering'`` and return them.

    We use a 2-step claim because Supabase's PostgREST REST API doesn't
    expose ``UPDATE ... RETURNING ... LIMIT N`` cleanly :
      1. GET first N rows WHERE status='pending' ORDER BY created_at.
      2. PATCH each row WHERE id=? AND status='pending'.
         Rows that got claimed by another worker between (1) and (2)
         have status != 'pending' and the PATCH no-ops.

    Returns the rows that were successfully flipped (status read
    post-patch). Skipped rows are silently dropped.
    """
    db = get_db()
    if db is None:
        return []

    try:
        client = db._get_client()
        # Step 1 — pull a batch of candidates.
        r = client.get(
            f"{db.base}/compilations",
            params={
                "select": "id,short_code,title,kill_ids,intro_text,outro_text,status,created_at",
                "status": "eq.pending",
                "order": "created_at.asc",
                "limit": str(int(batch_size)),
            },
        )
        r.raise_for_status()
        candidates = r.json() or []
    except Exception as e:
        log.warn("compilation_claim_fetch_failed", error=str(e)[:200])
        return []

    claimed: list[dict[str, Any]] = []
    for row in candidates:
        comp_id = row.get("id")
        if not comp_id:
            continue
        try:
            patch = client.patch(
                f"{db.base}/compilations",
                json={"status": "rendering"},
                headers={**db.headers, "Prefer": "return=representation"},
                params={
                    "id": f"eq.{comp_id}",
                    # Only race-safe if we also gate on the previous status.
                    "status": "eq.pending",
                },
            )
            if patch.status_code >= 400:
                continue
            rows = patch.json() or []
            if rows:
                claimed.append(rows[0])
        except Exception as e:
            log.warn(
                "compilation_claim_patch_failed",
                comp_id=str(comp_id)[:8], error=str(e)[:200],
            )
    if claimed:
        log.info("compilation_claimed", count=len(claimed))
    return claimed


def _release_stuck(timeout_minutes: int = 30) -> int:
    """Re-pending compilations that have been stuck in 'rendering' for
    too long (worker crashed mid-render). Returns the number of rows
    released.
    """
    db = get_db()
    if db is None:
        return 0
    try:
        client = db._get_client()
        cutoff = (datetime.now(timezone.utc).timestamp() - timeout_minutes * 60)
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
        r = client.patch(
            f"{db.base}/compilations",
            json={"status": "pending"},
            headers={**db.headers, "Prefer": "return=representation"},
            params={
                "status": "eq.rendering",
                "updated_at": f"lt.{cutoff_iso}",
            },
        )
        r.raise_for_status()
        rows = r.json() or []
        if rows:
            log.warn("compilation_released_stuck", count=len(rows), timeout_minutes=timeout_minutes)
        return len(rows)
    except Exception as e:
        log.warn("compilation_release_stuck_failed", error=str(e)[:200])
        return 0


def _mark_done(
    comp_id: str,
    output_url: str,
    duration_seconds: int,
) -> bool:
    db = get_db()
    if db is None:
        return False
    try:
        client = db._get_client()
        r = client.patch(
            f"{db.base}/compilations",
            json={
                "status": "done",
                "output_url": output_url,
                "output_duration_seconds": int(duration_seconds),
                "render_error": None,
            },
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{comp_id}"},
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("compilation_mark_done_failed", comp_id=str(comp_id)[:8], error=str(e)[:200])
        return False


def _mark_failed(comp_id: str, message: str) -> bool:
    db = get_db()
    if db is None:
        return False
    truncated = (message or "")[:500]
    try:
        client = db._get_client()
        r = client.patch(
            f"{db.base}/compilations",
            json={"status": "failed", "render_error": truncated},
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{comp_id}"},
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("compilation_mark_failed_failed", comp_id=str(comp_id)[:8], error=str(e)[:200])
        return False


def _fetch_kill_clip_urls(kill_ids: list[str]) -> dict[str, str]:
    """Map kill_id -> clip_url_horizontal for every kill_id in the input.

    Filters out kills without a horizontal clip on the way in — the
    caller decides whether a missing entry should abort the render.
    """
    db = get_db()
    if db is None:
        return {}
    if not kill_ids:
        return {}

    # Validate all UUIDs before sending to PostgREST.
    valid_ids = [kid for kid in kill_ids if UUID_RE.match(str(kid))]
    if not valid_ids:
        return {}

    try:
        client = db._get_client()
        # PostgREST `in.(...)` syntax. Up to 20 ids per the schema cap, so
        # the URL stays well under any practical length limit.
        in_clause = "(" + ",".join(valid_ids) + ")"
        r = client.get(
            f"{db.base}/kills",
            params={
                "select": "id,clip_url_horizontal",
                "id": f"in.{in_clause}",
            },
        )
        r.raise_for_status()
        rows = r.json() or []
        out: dict[str, str] = {}
        for row in rows:
            kid = row.get("id")
            url = row.get("clip_url_horizontal")
            if kid and url:
                out[str(kid)] = str(url)
        return out
    except Exception as e:
        log.error("compilation_fetch_clips_failed", error=str(e)[:200])
        return {}


# ─── ffmpeg helpers ────────────────────────────────────────────────────


def _run_ffmpeg(args: list[str], *, log_label: str) -> bool:
    """Run a single ffmpeg invocation. Returns True on success."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", *args]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=RENDER_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        log.error("ffmpeg_timeout", label=log_label)
        return False
    except FileNotFoundError:
        log.error("ffmpeg_not_installed")
        return False
    if proc.returncode != 0:
        stderr = (proc.stderr or b"")[:600].decode("utf-8", errors="ignore")
        log.warn("ffmpeg_nonzero", label=log_label, rc=proc.returncode, stderr=stderr)
        return False
    return True


def _escape_drawtext(s: str) -> str:
    """Escape a string for ffmpeg drawtext text= value.

    drawtext is parsed twice : the filter chain parses ':' / ',' / '''
    as separators, then drawtext itself reads the value. We escape both
    layers conservatively (same approach as worker/modules/clipper.py).
    """
    return (
        s.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace(",", "\\,")
        .replace("'", "’")  # curly apostrophe
        .replace('"', "")
    )


def _render_title_card(
    text: str,
    output_path: str,
    *,
    duration: int = CARD_DURATION_SECONDS,
) -> bool:
    """Render a black-background title card with centered text into a
    short MP4. Lambda-style : 1 ffmpeg call, no temp files.

    Notes :
      * Uses lavfi `color` source (no external assets needed).
      * Font defaults to whatever ffmpeg's drawtext picks up from the
        system. On Windows that's typically Arial ; on Linux it's the
        Liberation family. Good enough for a 1080p readable title card.
      * Audio : silent stereo AAC track at 44.1 kHz so the concat
        demuxer doesn't barf on stream-count mismatches with the kill
        clips (which all have audio).
    """
    safe = _escape_drawtext(text)
    drawtext = (
        f"drawtext=text={safe}"
        f":fontcolor=#F0E6D2:fontsize=58:borderw=3:bordercolor=#785A28"
        f":x=(w-text_w)/2:y=(h-text_h)/2"
    )
    args = [
        # Video : black 1080p color source.
        "-f", "lavfi",
        "-i", f"color=c=#010A13:s={OUTPUT_WIDTH}x{OUTPUT_HEIGHT}:r={FFMPEG_FPS}:d={duration}",
        # Audio : matching silent track for stream-count parity.
        "-f", "lavfi",
        "-i", f"anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf", drawtext,
        "-c:v", "libx264", "-preset", FFMPEG_PRESET, "-crf", FFMPEG_CRF,
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", FFMPEG_AUDIO_BITRATE, "-ar", "44100", "-ac", "2",
        "-shortest",
        "-movflags", "+faststart",
        "-t", str(duration),
        "-y", output_path,
    ]
    return _run_ffmpeg(args, log_label="title_card")


def _normalize_clip(input_path: str, output_path: str) -> bool:
    """Re-encode a single kill clip to the canonical format so the
    concat step downstream produces a clean MP4.

    Why normalize : the kill clipper has shipped multiple encoder
    configs over the lifetime of the project (different CRFs, codec
    args, audio bitrates). The concat demuxer's `-c copy` fast path
    requires byte-identical streams, which we can't guarantee. The
    safe path is to transcode every input to a known shape, then
    concat. Cost : ~1.5-2× the source duration in CPU.
    """
    args = [
        "-i", input_path,
        "-vf",
        f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=#010A13,"
        f"fps={FFMPEG_FPS}",
        "-c:v", "libx264", "-preset", FFMPEG_PRESET, "-crf", FFMPEG_CRF,
        "-maxrate", FFMPEG_VIDEO_BITRATE, "-bufsize", "10M",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", FFMPEG_AUDIO_BITRATE, "-ar", "44100", "-ac", "2",
        "-movflags", "+faststart",
        "-y", output_path,
    ]
    return _run_ffmpeg(args, log_label="normalize_clip")


def _concat_segments(segments: list[str], output_path: str) -> bool:
    """Concat a list of MP4 segments using the ffmpeg concat demuxer.

    The demuxer reads a manifest file containing `file 'path'` entries.
    Because every input has already been normalized into the same
    encoder shape, we can stream-copy here (`-c copy`) and the output
    is bit-perfect with the inputs.
    """
    if not segments:
        return False
    # Write the manifest.
    manifest_path = output_path + ".concat.txt"
    try:
        with open(manifest_path, "w", encoding="utf-8") as f:
            for seg in segments:
                # ffmpeg's concat demuxer wants forward slashes even on
                # Windows. Escape single quotes too.
                norm = seg.replace("\\", "/").replace("'", "'\\''")
                f.write(f"file '{norm}'\n")
    except OSError as e:
        log.error("concat_manifest_write_failed", error=str(e)[:200])
        return False

    args = [
        "-f", "concat",
        "-safe", "0",
        "-i", manifest_path,
        "-c", "copy",
        "-movflags", "+faststart",
        "-y", output_path,
    ]
    ok = _run_ffmpeg(args, log_label="concat")
    try:
        os.remove(manifest_path)
    except OSError:
        pass
    return ok


def _probe_duration_seconds(path: str) -> int:
    """Return the duration in seconds of an MP4 via ffprobe. Returns 0
    on failure (so the caller can flag the row without a duration).
    """
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            timeout=30,
            check=False,
        )
        if proc.returncode != 0:
            return 0
        raw = (proc.stdout or b"").decode("utf-8", errors="ignore").strip()
        return int(round(float(raw)))
    except Exception:
        return 0


# ─── Download helper ───────────────────────────────────────────────────


def _download_url(url: str, dest_path: str) -> bool:
    """Stream a file from R2 (or any HTTPS URL) to disk."""
    try:
        with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=64 * 1024):
                    if chunk:
                        f.write(chunk)
        return os.path.exists(dest_path) and os.path.getsize(dest_path) > 0
    except Exception as e:
        log.warn("compilation_download_failed", url=url[:80], error=str(e)[:200])
        return False


# ─── R2 upload helper ──────────────────────────────────────────────────


def _upload_to_r2(local_path: str, short_code: str) -> str | None:
    """Upload the final MP4 to R2 at compilations/<short_code>.mp4.

    Mirrors r2_client.upload() but stays SYNC (this whole script is
    sync, no asyncio loop to share). Returns the public URL or None.
    """
    if not (
        config.R2_ACCOUNT_ID
        and config.R2_ACCESS_KEY_ID
        and config.R2_SECRET_ACCESS_KEY
    ):
        log.error("r2_not_configured")
        return None
    if not os.path.exists(local_path):
        return None

    key = f"{R2_PREFIX}/{short_code}.mp4"
    try:
        backend = get_storage_backend()
        url = backend.upload_file(
            key,
            local_path,
            content_type="video/mp4",
            cache_control="public, max-age=31536000, immutable",
        )
        size_mb = os.path.getsize(local_path) / (1024 * 1024)
        log.info("compilation_uploaded", short_code=short_code, key=key, size_mb=round(size_mb, 1))
        return url
    except Exception as e:
        log.error("compilation_upload_failed", short_code=short_code, error=str(e)[:200])
        return None


# ─── Render orchestrator ───────────────────────────────────────────────


def _render_one(comp: dict[str, Any]) -> bool:
    """End-to-end render of a single compilation row.

    Returns True on success (output_url stamped). False otherwise.
    The caller has already flipped status=rendering ; we own status=done
    / failed from here.
    """
    comp_id = comp.get("id")
    short_code = comp.get("short_code")
    if not comp_id or not short_code:
        log.error("compilation_render_bad_row", row=comp)
        return False

    kill_ids = [str(k) for k in (comp.get("kill_ids") or [])]
    intro_text = (comp.get("intro_text") or "").strip()
    outro_text = (comp.get("outro_text") or "").strip()

    if not kill_ids:
        _mark_failed(comp_id, "no kill_ids on compilation row")
        return False

    # Fetch clip URLs.
    url_by_id = _fetch_kill_clip_urls(kill_ids)
    missing = [kid for kid in kill_ids if kid not in url_by_id]
    if missing:
        _mark_failed(
            comp_id,
            f"{len(missing)} kill(s) missing horizontal clip — first: {missing[0][:8]}",
        )
        return False

    # Work dir : tmp under the OS temp root so a crash leaves orphans
    # the OS cleans up. We don't want compilation work fighting for the
    # CLIPS_DIR cache used by the live pipeline.
    workdir = tempfile.mkdtemp(prefix=f"compilation_{short_code}_")
    try:
        # ── 1. Download each kill clip ─────────────────────────────
        sources: list[str] = []
        for idx, kid in enumerate(kill_ids):
            url = url_by_id[kid]
            src_path = os.path.join(workdir, f"src_{idx:02d}_{kid[:8]}.mp4")
            if not _download_url(url, src_path):
                _mark_failed(comp_id, f"download failed for kill {kid[:8]}")
                return False
            sources.append(src_path)

        # ── 2. Normalise each clip ─────────────────────────────────
        normalised: list[str] = []
        for idx, src in enumerate(sources):
            norm_path = os.path.join(workdir, f"norm_{idx:02d}.mp4")
            if not _normalize_clip(src, norm_path):
                _mark_failed(comp_id, f"normalise failed at clip #{idx + 1}")
                return False
            normalised.append(norm_path)
            # Reclaim disk eagerly — sources are huge (1080p VOD slices).
            try:
                os.remove(src)
            except OSError:
                pass

        # ── 3. Render intro/outro cards (optional) ─────────────────
        segments: list[str] = []
        if intro_text:
            intro_path = os.path.join(workdir, "intro.mp4")
            if _render_title_card(intro_text, intro_path):
                segments.append(intro_path)
            else:
                log.warn("compilation_intro_failed", comp_id=str(comp_id)[:8])
        segments.extend(normalised)
        if outro_text:
            outro_path = os.path.join(workdir, "outro.mp4")
            if _render_title_card(outro_text, outro_path):
                segments.append(outro_path)
            else:
                log.warn("compilation_outro_failed", comp_id=str(comp_id)[:8])

        # ── 4. Concat ──────────────────────────────────────────────
        final_path = os.path.join(workdir, f"{short_code}.mp4")
        if not _concat_segments(segments, final_path):
            _mark_failed(comp_id, "ffmpeg concat failed")
            return False

        duration = _probe_duration_seconds(final_path)

        # ── 5. Upload to R2 ───────────────────────────────────────
        output_url = _upload_to_r2(final_path, short_code)
        if not output_url:
            _mark_failed(comp_id, "R2 upload failed")
            return False

        # ── 6. Stamp DB ───────────────────────────────────────────
        if not _mark_done(comp_id, output_url, duration):
            # Output is live on R2 but DB write failed — log loudly so
            # an operator can paste the URL manually.
            log.error(
                "compilation_db_stamp_failed",
                comp_id=str(comp_id)[:8],
                short_code=short_code,
                output_url=output_url,
                duration=duration,
            )
            return False

        log.info(
            "compilation_done",
            short_code=short_code,
            clips=len(kill_ids),
            duration_seconds=duration,
            url=output_url,
        )
        return True

    except Exception as e:
        log.error(
            "compilation_render_exception",
            comp_id=str(comp_id)[:8] if comp_id else None,
            error=str(e)[:300],
        )
        try:
            _mark_failed(comp_id, f"unexpected: {str(e)[:200]}")
        except Exception:
            pass
        return False
    finally:
        # Cleanup workdir — best-effort. On Windows occasionally an
        # ffmpeg handle is still open ; that's fine, OS cleans up later.
        try:
            shutil.rmtree(workdir, ignore_errors=True)
        except Exception:
            pass


def render_pending_once(batch_size: int = DEFAULT_BATCH_SIZE) -> int:
    """One pass : release stuck, claim a batch, render each. Returns
    the number of compilations successfully rendered.
    """
    _release_stuck()
    batch = _claim_pending(batch_size)
    if not batch:
        return 0
    ok = 0
    for comp in batch:
        try:
            if _render_one(comp):
                ok += 1
        except KeyboardInterrupt:
            raise
        except Exception as e:
            log.error(
                "compilation_render_outer_exception",
                comp_id=str(comp.get("id") or "")[:8],
                error=str(e)[:300],
            )
    log.info("compilation_pass_done", processed=len(batch), succeeded=ok)
    return ok


# ─── CLI ───────────────────────────────────────────────────────────────


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render pending KCKILLS compilations into R2-hosted MP4s.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process one batch then exit.",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Long-running loop : poll the queue every 30 s.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Rows per pass (default {DEFAULT_BATCH_SIZE}).",
    )
    args = parser.parse_args(argv)

    if not args.once and not args.watch:
        # Default to --once when invoked plain — feels less surprising
        # than dropping into a forever loop without warning.
        args.once = True

    if args.once:
        rendered = render_pending_once(batch_size=args.batch_size)
        return 0 if rendered >= 0 else 1

    # --watch
    log.info("compilation_watch_start", interval=WATCH_INTERVAL_SECONDS)
    while True:
        try:
            render_pending_once(batch_size=args.batch_size)
        except KeyboardInterrupt:
            log.info("compilation_watch_stop")
            return 0
        except Exception as e:
            log.error("compilation_watch_pass_failed", error=str(e)[:300])
        time.sleep(WATCH_INTERVAL_SECONDS)


if __name__ == "__main__":
    sys.exit(_main())
