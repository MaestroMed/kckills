"""
QC — Clip quality control via Gemini timer reading.

The lolesports API returns vod_offset=0 for most games, but the YouTube VOD
typically starts with 3-10 minutes of broadcast intro (analyst desk, draft,
sponsor screens) before actual gameplay. This module calibrates the offset
by asking Gemini to read the in-game timer from a probe clip, then computes
the drift and returns a correction.

Strategy:
1. Download a 12s probe clip at the current computed vod_time for one kill.
2. Send to Gemini: "Read the LoL in-game timer". Returns mm:ss or null.
3. Compare Gemini's reading to the expected game_time_seconds.
4. drift = gemini_timer - expected. If drift > 30s → offset needs correction.
5. correction = -drift (we need to shift later in the VOD to find the right moment).

The calibration is PER GAME, not per kill: one probe calibrates all kills of
that game because they share the same VOD + offset.

If Gemini can't read the timer (analyst desk, break screen, etc.), we
progressively scan forward in 60s increments until we find gameplay.
"""

from __future__ import annotations

import os
import structlog
from dataclasses import dataclass

from services import gemini_client
from modules.clipper import _run_ytdlp, _safe_remove

log = structlog.get_logger()


@dataclass
class QCResult:
    is_gameplay: bool
    timer_reading: str | None  # "mm:ss" or None
    expected_game_time: int    # seconds
    actual_game_time: int | None  # seconds parsed from timer
    drift_seconds: int         # actual - expected (positive = clip is too late)
    valid: bool                # drift < threshold


async def validate_clip(
    local_path: str,
    expected_game_time_seconds: int,
    threshold_seconds: int = 45,
) -> QCResult:
    """Send a clip to Gemini and check the in-game timer matches expectations."""
    if not os.path.exists(local_path):
        return QCResult(
            is_gameplay=False,
            timer_reading=None,
            expected_game_time=expected_game_time_seconds,
            actual_game_time=None,
            drift_seconds=0,
            valid=False,
        )

    result = await gemini_client.analyze(
        prompt=(
            "Look at this League of Legends gameplay clip. "
            "Read the in-game clock timer visible at the top-center of the HUD. "
            "Return ONLY valid JSON, nothing else: "
            '{"is_gameplay": true/false, "timer": "mm:ss" or null if not visible}'
        ),
        video_path=local_path,
    )

    is_gameplay = bool(result and result.get("is_gameplay"))
    timer_str = (result or {}).get("timer")
    actual_gt = _parse_timer(timer_str) if timer_str else None
    drift = (actual_gt - expected_game_time_seconds) if actual_gt is not None else 0

    valid = is_gameplay and abs(drift) < threshold_seconds

    log.info(
        "qc_validate",
        is_gameplay=is_gameplay,
        timer=timer_str,
        expected=expected_game_time_seconds,
        actual=actual_gt,
        drift=drift,
        valid=valid,
    )

    return QCResult(
        is_gameplay=is_gameplay,
        timer_reading=timer_str,
        expected_game_time=expected_game_time_seconds,
        actual_game_time=actual_gt,
        drift_seconds=drift,
        valid=valid,
    )


async def calibrate_game_offset(
    youtube_id: str,
    current_offset: int,
    probe_game_times: list[int] | int = 0,
    max_scan_minutes: int = 10,
    local_vod_path: str | None = None,
) -> int:
    """Calibrate the VOD offset for a game using MULTI-PROBE median strategy.

    Takes up to 3 probe positions (different game_time_seconds), reads the
    in-game timer at each via Gemini, computes `game_start_in_vod` for each,
    and returns the MEDIAN. This eliminates Gemini misreads which caused
    offset errors of several minutes on single-probe runs.

    If only one probe_game_time is provided (or int), falls back to single
    probe. If none of the probes yield gameplay, scans forward in 60s steps.

    Args:
        youtube_id: YouTube video ID of the VOD.
        current_offset: Current computed vod_offset_seconds for this game.
        probe_game_times: List of game_time_seconds to probe (up to 3),
            or a single int for backward compat. Spread them across
            early/mid/late game for robustness.
        max_scan_minutes: Forward scan range if no probe finds gameplay.
    """
    if isinstance(probe_game_times, int):
        probe_game_times = [probe_game_times]

    vod_url = f"https://www.youtube.com/watch?v={youtube_id}"
    probe_path = os.path.join(
        os.path.dirname(__file__), "..", "clips", f"qc_probe_{youtube_id}.mp4"
    )
    os.makedirs(os.path.dirname(probe_path), exist_ok=True)

    # Helper: extract probe from local VOD (fast, no YouTube call) or fall back to yt-dlp
    async def _download_probe(start: int, end: int) -> bool:
        if local_vod_path and os.path.exists(local_vod_path):
            from modules.clipper import _ffmpeg
            return await _ffmpeg([
                "-ss", str(start),
                "-i", local_vod_path,
                "-t", str(end - start),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                "-c:a", "aac", "-b:a", "64k",
                "-y", probe_path,
            ])
        return await _run_ytdlp(vod_url, probe_path, start, end)

    log.info(
        "qc_calibrate_start",
        youtube_id=youtube_id,
        current_offset=current_offset,
        probe_count=len(probe_game_times),
        probes=probe_game_times,
    )

    # ─── Multi-probe: read timer at each position, compute game_start ──
    game_start_estimates: list[int] = []

    try:
        for probe_gt in probe_game_times:
            if probe_gt < 60:
                continue  # too early, timer hard to read

            vod_time = current_offset + probe_gt
            clip_start = max(0, vod_time - 5)
            clip_end = vod_time + 7

            _safe_remove(probe_path)
            ok = await _download_probe(clip_start, clip_end)
            if not ok or not os.path.exists(probe_path):
                log.warn("qc_probe_download_failed", probe_gt=probe_gt)
                continue

            qc = await validate_clip(probe_path, probe_gt)

            if qc.is_gameplay and qc.actual_game_time is not None:
                estimate = vod_time - qc.actual_game_time
                game_start_estimates.append(estimate)
                log.info(
                    "qc_probe_reading",
                    probe_gt=probe_gt,
                    timer=qc.timer_reading,
                    actual_gt=qc.actual_game_time,
                    estimated_start=estimate,
                )

        # ─── Compute median of all estimates ──────────────────────────
        if game_start_estimates:
            game_start_estimates.sort()
            median_idx = len(game_start_estimates) // 2
            corrected_offset = game_start_estimates[median_idx]

            log.info(
                "qc_calibrate_done",
                estimates=game_start_estimates,
                median=corrected_offset,
                old_offset=current_offset,
                new_offset=corrected_offset,
                probe_count=len(game_start_estimates),
            )
            return corrected_offset

        # ─── No gameplay found at any probe — scan forward ────────────
        log.info("qc_all_probes_failed_scanning_forward")
        base_vod_time = current_offset + (probe_game_times[0] if probe_game_times else 300)
        for extra in range(60, max_scan_minutes * 60 + 1, 60):
            _safe_remove(probe_path)
            scan_start = base_vod_time + extra
            ok = await _download_probe(scan_start, scan_start + 7)
            if not ok or not os.path.exists(probe_path):
                continue
            probe_gt = (probe_game_times[0] if probe_game_times else 300) + extra
            qc = await validate_clip(probe_path, probe_gt)
            if qc.is_gameplay and qc.actual_game_time is not None:
                game_start_in_vod = scan_start - qc.actual_game_time
                log.info(
                    "qc_calibrate_scanned",
                    scanned_to=scan_start,
                    timer=qc.timer_reading,
                    game_start_in_vod=game_start_in_vod,
                )
                return game_start_in_vod

        log.warn("qc_calibrate_failed", youtube_id=youtube_id)
        return current_offset

    finally:
        _safe_remove(probe_path)


def _parse_timer(timer_str: str) -> int | None:
    """Parse 'mm:ss' or 'm:ss' into total seconds."""
    try:
        parts = timer_str.strip().split(":")
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        pass
    return None
