"""
local_paths.py — Central path resolver for the LoLTok worker.

Why this exists
---------------
The worker writes a LOT of bytes to local disk : VOD downloads (yt-dlp
cache, ~80MB/match), 1080p clips (4 artefacts × 5-25MB), HLS .ts
segments (one ladder per clip, ~40-80MB), thumbnails, OG images, the
SQLite local cache, and the YouTube cookies file.

For Mehdi's KC pilot, every one of these lived under a hardcoded
`D:/kckills_worker/...` because his C:/ drive was tight on space and
D:/ is a Gen5 NVMe with 975GB free. That's perfect on his rig and
catastrophic on a Linux container : `D:/` doesn't exist, the fallback
written into D:/kckills_worker would land somewhere unwritable, etc.

This module is the ONE place every path is computed. Every consumer
(config.py, modules/clipper.py, modules/hls_packager.py, ...) calls
into LocalPaths. Each path :

  * Honors a per-path env var (e.g. KCKILLS_VODS_DIR)
  * Falls back to a Linux-friendly cache dir on POSIX
  * Falls back to D:/kckills_worker/<sub> on Windows when D:/ exists
  * Falls back to <worker_root>/<sub> as last resort

Net effect : on Mehdi's machine, EVERY path resolves to exactly the
same value as before this refactor. In a container with KCKILLS_*
env vars set, the same paths land on the mounted volume.

Design rules
------------
1. Pure functions. No side effects (no mkdir on import).
2. Idempotent : `mkdir(parents=True, exist_ok=True)` everywhere.
3. Cross-platform : never assume `/` vs `\\` — let `os.path.join`
   handle it. Return forward-slash strings (Python file APIs accept
   them on Windows).
4. Return `str` not `Path` — keep the surface compatible with the
   existing `config.CLIPS_DIR` etc. consumers that do `os.path.join`.
5. `ensure_writable()` probes each path with a real write+delete to
   surface permission errors at startup, not three hours into a
   pipeline run.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Worker source root (the directory containing config.py + main.py).
# We compute it from this file's location : services/local_paths.py
# → ../  is the worker root.
_WORKER_ROOT = Path(__file__).resolve().parent.parent


def _is_windows() -> bool:
    return sys.platform == "win32"


def _has_d_drive() -> bool:
    """True if D:/ is a real, writable mount on this Windows box.

    On Linux containers this returns False instantly (no D:/ drive).
    On Mehdi's machine it returns True (his Gen5 NVMe).
    """
    if not _is_windows():
        return False
    try:
        return os.path.isdir("D:/")
    except OSError:
        return False


def _default_data_root() -> str:
    """Pick a sensible base directory for cache + media files.

    Priority :
      1. $KCKILLS_DATA_ROOT (if set)
      2. D:/kckills_worker on Windows when D:/ exists (Mehdi's setup)
      3. /var/cache/kckills on Linux (FHS standard for app caches)
      4. <worker_source_root> as last resort (dev machines, CI)
    """
    env_root = os.getenv("KCKILLS_DATA_ROOT", "").strip()
    if env_root:
        return env_root

    if _has_d_drive():
        return "D:/kckills_worker"

    if not _is_windows():
        # FHS: /var/cache for app caches that survive reboots.
        # Containers typically mount a volume at /cache or /data.
        # We pick /var/cache/kckills because it's the well-known
        # path and the operator can override via env var anyway.
        return "/var/cache/kckills"

    # Windows fallback (no D:/ — e.g. laptop, CI runner).
    return str(_WORKER_ROOT)


# Compute once on import — cheap, deterministic, side-effect-free.
_DATA_ROOT = _default_data_root()


class LocalPaths:
    """Central path resolver. All members are @staticmethod : no
    instance needed. Existing code does `LocalPaths.clips_dir()`."""

    # ── Hot paths (large I/O — should land on SSD if possible) ──

    @staticmethod
    def vods_dir() -> str:
        """Where yt-dlp caches downloaded VOD segments."""
        return os.getenv(
            "KCKILLS_VODS_DIR",
            os.path.join(_DATA_ROOT, "vods"),
        )

    @staticmethod
    def clips_dir() -> str:
        """Where ffmpeg writes the four per-kill artefacts before
        upload to R2 (h.mp4, v.mp4, v_low.mp4, thumb.jpg)."""
        return os.getenv(
            "KCKILLS_CLIPS_DIR",
            os.path.join(_DATA_ROOT, "clips"),
        )

    @staticmethod
    def thumbnails_dir() -> str:
        """Where thumbnail JPGs are written before upload to R2."""
        return os.getenv(
            "KCKILLS_THUMBNAILS_DIR",
            os.path.join(_DATA_ROOT, "thumbnails"),
        )

    @staticmethod
    def hls_temp_dir() -> str:
        """Where the HLS packager writes .m3u8 + .ts segments
        before upload. Hot path — 40-80MB per clip."""
        return os.getenv(
            "KCKILLS_HLS_DIR",
            os.path.join(_DATA_ROOT, "hls_temp"),
        )

    # ── Cool paths (small files, low churn) ──

    @staticmethod
    def cache_dir() -> str:
        """Generic worker cache (schedules, schema cache, golgg HTML
        snapshots, etc.). Inside the source tree by default — these
        files are SMALL and we want them version-able alongside the
        source for dev convenience."""
        return os.getenv(
            "KCKILLS_CACHE_DIR",
            str(_WORKER_ROOT / "cache"),
        )

    @staticmethod
    def cookies_file() -> str:
        """Path to the Netscape cookies.txt yt-dlp uses for YouTube
        Premium auth. Inside the source tree by default (gitignored)
        because it's tiny and Mehdi's existing setup already lives
        there. Containers should override via env var to point at a
        secret-mounted file."""
        return os.getenv(
            "KCKILLS_COOKIES_FILE",
            str(_WORKER_ROOT / ".youtube_cookies.txt"),
        )

    @staticmethod
    def cache_db() -> str:
        """SQLite local-cache DB (Supabase write buffer). Tiny
        (~10MB max). Defaults to the source tree so it survives
        worker code redeploys but is co-located with the rest."""
        return os.getenv(
            "KCKILLS_CACHE_DB",
            str(_WORKER_ROOT / "local_cache.db"),
        )

    @staticmethod
    def logs_dir() -> str:
        """Per-role child logs from the orchestrator."""
        return os.getenv(
            "KCKILLS_LOGS_DIR",
            os.path.join(_DATA_ROOT, "logs"),
        )

    @staticmethod
    def status_file() -> str:
        """Orchestrator status JSON (atomically written for `manager.py
        status` to read)."""
        return os.getenv(
            "KCKILLS_ORCHESTRATOR_STATUS_FILE",
            os.path.join(_DATA_ROOT, "orchestrator_status.json"),
        )

    @staticmethod
    def data_root() -> str:
        """The base directory chosen by the resolver. Useful for
        diagnostics and for code that needs to drop a one-off file
        next to the rest."""
        return _DATA_ROOT

    # ── Health / diagnostics ──

    @staticmethod
    def all_paths() -> dict[str, str]:
        """Snapshot of every path resolved by the resolver. Used by
        the startup health check + `python -m worker.scripts.queue_status`
        (when wired up)."""
        return {
            "data_root":      LocalPaths.data_root(),
            "vods_dir":       LocalPaths.vods_dir(),
            "clips_dir":      LocalPaths.clips_dir(),
            "thumbnails_dir": LocalPaths.thumbnails_dir(),
            "hls_temp_dir":   LocalPaths.hls_temp_dir(),
            "cache_dir":      LocalPaths.cache_dir(),
            "cache_db":       LocalPaths.cache_db(),
            "cookies_file":   LocalPaths.cookies_file(),
            "logs_dir":       LocalPaths.logs_dir(),
            "status_file":    LocalPaths.status_file(),
        }

    @staticmethod
    def ensure_writable() -> dict[str, bool]:
        """Probe each *directory* path for write access by creating
        and immediately removing a temp file. Returns a per-path
        bool dict.

        Files (cookies_file, cache_db, status_file) are NOT probed
        because they may not exist yet — we only test their parent
        directory's writability via the dir entries above.

        Used by main.py / orchestrator.py at startup to bail loudly
        if the operator gave us paths we can't write to (instead of
        crashing on the first ffmpeg call 20 minutes in).
        """
        results: dict[str, bool] = {}
        dir_paths = {
            "vods_dir":       LocalPaths.vods_dir(),
            "clips_dir":      LocalPaths.clips_dir(),
            "thumbnails_dir": LocalPaths.thumbnails_dir(),
            "hls_temp_dir":   LocalPaths.hls_temp_dir(),
            "cache_dir":      LocalPaths.cache_dir(),
            "logs_dir":       LocalPaths.logs_dir(),
        }
        for name, path in dir_paths.items():
            results[name] = _probe_writable(path)
        return results


def _probe_writable(path: str) -> bool:
    """Best-effort probe. Creates the dir if missing, drops a temp
    file, deletes it. Any failure → False. NEVER raises (the caller
    decides what to do)."""
    try:
        os.makedirs(path, exist_ok=True)
        # Use NamedTemporaryFile inside the target dir so we test
        # the actual filesystem perms (not /tmp's).
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path,
            prefix=".kckills_probe_",
            delete=True,
        ) as f:
            f.write(b"ok")
            f.flush()
        return True
    except (OSError, PermissionError):
        return False


if __name__ == "__main__":
    # CLI : print every resolved path + writability. Useful for
    # debugging deployment configs.
    print(f"data_root       : {LocalPaths.data_root()}")
    print(f"is_windows      : {_is_windows()}")
    print(f"has_d_drive     : {_has_d_drive()}")
    print()
    print("Resolved paths :")
    for name, value in LocalPaths.all_paths().items():
        print(f"  {name:<16} {value}")
    print()
    print("Writability probe (dirs only) :")
    for name, ok in LocalPaths.ensure_writable().items():
        marker = "OK " if ok else "FAIL"
        print(f"  [{marker}] {name}")
