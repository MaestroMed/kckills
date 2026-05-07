"""disk_hygiene.py — Periodic GC of local artefact directories.

Wave 14 (2026-05-07) — addresses STOP item #2 from the architecture
audit : worker/{clips,vods,hls,thumbnails}/ grow without bound. The
clipper deletes successful artefacts inline, but crashes / aborted
downloads / interrupted encodes leave orphans. At 50 kills/day with
~80 MB/clip across all variants, the host fills in ~3 months on a
fresh 230 GB allocation.

This module exposes :

  * `usage_stats()`              — fast snapshot for the watchdog
                                   daily report (no I/O on individual
                                   files, just os.path.getsize on the
                                   directory total).
  * `purge_aged(max_age_days)`   — delete files older than N days.
                                   Safe : every file we touch here is
                                   on R2 (clip.create + hls_packager
                                   upload before local cleanup).
  * `disk_free_pct()`            — alarm when local disk approaches
                                   the gaming/idle threshold.

Designed to be called from `watchdog.run()` once per cycle. No async
needed — file system enumeration is fast enough for the volumes we
deal with (~1 K-10 K files).
"""
from __future__ import annotations

import os
import shutil
import time
from typing import Optional

import structlog

from services.local_paths import LocalPaths

log = structlog.get_logger()

# Default retention. Operator override via env vars below.
DEFAULT_MAX_AGE_DAYS = 7

# Per-directory retention overrides (env vars take precedence).
_DIR_AGE_OVERRIDE_ENV = {
    "vods":      "KCKILLS_VODS_RETENTION_DAYS",
    "clips":     "KCKILLS_CLIPS_RETENTION_DAYS",
    "hls":       "KCKILLS_HLS_RETENTION_DAYS",
    "thumbs":    "KCKILLS_THUMBNAILS_RETENTION_DAYS",
}


def _all_dirs() -> dict[str, str]:
    """Map of logical name → absolute path. Resolved via LocalPaths so
    operator overrides (KCKILLS_VODS_DIR etc.) apply transparently."""
    return {
        "vods":   LocalPaths.vods_dir(),
        "clips":  LocalPaths.clips_dir(),
        "hls":    LocalPaths.hls_temp_dir(),
        "thumbs": LocalPaths.thumbnails_dir(),
    }


def _retention_days(name: str) -> int:
    env = os.getenv(_DIR_AGE_OVERRIDE_ENV.get(name, ""), "")
    try:
        return max(1, int(env)) if env else DEFAULT_MAX_AGE_DAYS
    except ValueError:
        return DEFAULT_MAX_AGE_DAYS


def _dir_size_bytes(path: str) -> int:
    """Recursive size of a directory. ENOENT is silently 0."""
    if not os.path.isdir(path):
        return 0
    total = 0
    try:
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    except OSError:
        pass
    return total


def usage_stats() -> dict:
    """Per-directory size + total + host disk free pct.

    Pure read-only ; safe to call every watchdog cycle. Returns
    everything the daily report needs in a single dict.
    """
    dirs = _all_dirs()
    sizes = {name: _dir_size_bytes(path) for name, path in dirs.items()}
    total = sum(sizes.values())

    # Host-level free space (anchored to the clips dir's drive).
    free_bytes = 0
    total_bytes = 0
    free_pct = 0.0
    try:
        anchor = dirs.get("clips") or os.getcwd()
        if not os.path.isdir(anchor):
            anchor = os.path.dirname(anchor) or os.getcwd()
        usage = shutil.disk_usage(anchor)
        total_bytes = usage.total
        free_bytes = usage.free
        free_pct = (usage.free / usage.total * 100) if usage.total else 0.0
    except OSError:
        pass

    return {
        "per_dir_bytes":   sizes,
        "managed_total_bytes": total,
        "host_total_bytes": total_bytes,
        "host_free_bytes":  free_bytes,
        "host_free_pct":    round(free_pct, 1),
    }


def purge_aged(max_age_days: Optional[int] = None) -> dict:
    """Delete files older than max_age_days from every managed dir.

    Returns counts + bytes freed per directory. Idempotent : the same
    file can't be deleted twice and missing dirs are silently zero.

    Why we can purge aggressively : every artefact in these dirs has
    already been uploaded to R2 before the local cleanup pass in
    `clipper.py` / `hls_packager.py`. Files that linger here are by
    definition orphans (failed run, crash mid-pipeline, etc.). The
    canonical copy is on R2 ; if a downstream module asks for a
    local file that's gone, the clipper re-downloads from R2.
    """
    cutoff = time.time() - (
        (max_age_days if max_age_days is not None else DEFAULT_MAX_AGE_DAYS) * 86400
    )

    summary = {
        "files_deleted":  0,
        "bytes_freed":    0,
        "errors":         0,
        "per_dir":        {},
    }

    for name, path in _all_dirs().items():
        per_dir_age = max_age_days if max_age_days is not None else _retention_days(name)
        per_dir_cutoff = time.time() - per_dir_age * 86400
        deleted = 0
        freed = 0
        errors = 0
        if not os.path.isdir(path):
            summary["per_dir"][name] = {
                "files_deleted": 0, "bytes_freed": 0, "errors": 0,
                "retention_days": per_dir_age,
            }
            continue
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                try:
                    st = os.stat(fp)
                except OSError:
                    errors += 1
                    continue
                if st.st_mtime > per_dir_cutoff:
                    continue
                try:
                    os.remove(fp)
                    deleted += 1
                    freed += st.st_size
                except OSError:
                    errors += 1
        summary["per_dir"][name] = {
            "files_deleted": deleted,
            "bytes_freed":   freed,
            "errors":        errors,
            "retention_days": per_dir_age,
        }
        summary["files_deleted"] += deleted
        summary["bytes_freed"] += freed
        summary["errors"] += errors

    log.info(
        "disk_purge_done",
        files_deleted=summary["files_deleted"],
        bytes_freed_mb=round(summary["bytes_freed"] / 1024 / 1024, 1),
        errors=summary["errors"],
    )
    return summary


def disk_free_pct() -> float:
    """Convenience for alerting — host free space % anchored on the
    clips directory's drive."""
    stats = usage_stats()
    return stats["host_free_pct"]
