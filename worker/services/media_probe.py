"""ffprobe wrapper — extract width / height / duration / codec / bitrate.

Used by the clipper to populate `kill_assets.{width,height,duration_ms,codec,
bitrate_kbps}` for each artefact uploaded to R2. Probing is best-effort —
if ffprobe is missing or the file is unreadable we return `{}` and the
clipper still inserts the asset row (with NULL media metadata).

Why a thin wrapper instead of opencv / pymediainfo :
    * ffprobe is already a hard dependency for the worker (ships with ffmpeg)
    * Zero new Python deps
    * JSON output is stable across ffmpeg 4.x / 5.x / 6.x
    * Cross-platform (no native bindings to install on Windows)
"""

from __future__ import annotations

import json
import os
import subprocess

import structlog

log = structlog.get_logger()


_FFPROBE_TIMEOUT_SEC = 15


def probe_video(path: str) -> dict:
    """Return a dict of media metadata for `path`. Empty dict on failure.

    Returned shape (all keys optional — caller must tolerate missing) :
        {
            "width":         int,
            "height":        int,
            "duration_ms":   int,
            "codec":         str,         # e.g. 'h264'
            "bitrate_kbps":  int,
        }

    Best-effort. Logs a single warn on failure, never raises.
    """
    if not path or not os.path.exists(path):
        return {}

    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-show_format",
        path,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=_FFPROBE_TIMEOUT_SEC,
            text=True,
        )
    except FileNotFoundError:
        log.warn("ffprobe_not_installed", path=path)
        return {}
    except subprocess.TimeoutExpired:
        log.warn("ffprobe_timeout", path=path)
        return {}
    except Exception as e:
        log.warn("ffprobe_threw", path=path, error=str(e)[:200])
        return {}

    if proc.returncode != 0:
        log.warn("ffprobe_nonzero", path=path, rc=proc.returncode)
        return {}

    try:
        data = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as e:
        log.warn("ffprobe_bad_json", path=path, error=str(e))
        return {}

    out: dict = {}
    streams = data.get("streams") or []
    fmt = data.get("format") or {}

    # Pick the first video stream — the clipper only ever produces single-
    # video-stream MP4s (audio is a separate stream we don't read here).
    video_stream = next(
        (s for s in streams if s.get("codec_type") == "video"),
        None,
    )
    if video_stream is not None:
        try:
            w = video_stream.get("width")
            h = video_stream.get("height")
            if isinstance(w, int) and w > 0:
                out["width"] = w
            if isinstance(h, int) and h > 0:
                out["height"] = h
        except Exception:
            pass

        codec = video_stream.get("codec_name")
        if codec:
            out["codec"] = str(codec)

        # Stream-level bit_rate is per-stream ; format-level is container.
        # Prefer stream because it excludes audio bytes.
        br_str = video_stream.get("bit_rate") or fmt.get("bit_rate")
        if br_str:
            try:
                out["bitrate_kbps"] = max(1, int(int(br_str) / 1000))
            except (ValueError, TypeError):
                pass

    # Duration is on the format block (container) — more reliable than the
    # per-stream duration which is sometimes 'N/A' for fragmented MP4s.
    dur_str = fmt.get("duration") or (video_stream.get("duration") if video_stream else None)
    if dur_str:
        try:
            out["duration_ms"] = max(0, int(float(dur_str) * 1000))
        except (ValueError, TypeError):
            pass

    return out
