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
    probe_game_time: int,
    max_scan_minutes: int = 10,
) -> int:
    """Calibrate the VOD offset for a game by probing with Gemini.

    Downloads a short clip at the expected position, asks Gemini to read
    the in-game timer, and computes how many seconds the offset needs to
    shift. Returns the CORRECTED offset (not just the delta).

    Args:
        youtube_id: YouTube video ID of the VOD.
        current_offset: Current computed vod_offset_seconds for this game.
        probe_game_time: game_time_seconds of the kill to use as probe.
        max_scan_minutes: If the first probe isn't gameplay, scan forward
            this many minutes in 60s steps looking for gameplay.
    """
    vod_url = f"https://www.youtube.com/watch?v={youtube_id}"
    probe_path = os.path.join(
        os.path.dirname(__file__), "..", "clips", f"qc_probe_{youtube_id}.mp4"
    )
    os.makedirs(os.path.dirname(probe_path), exist_ok=True)

    vod_time = current_offset + probe_game_time
    clip_start = max(0, vod_time - 5)
    clip_end = vod_time + 7

    log.info(
        "qc_calibrate_start",
        youtube_id=youtube_id,
        current_offset=current_offset,
        probe_game_time=probe_game_time,
        vod_probe_at=clip_start,
    )

    try:
        ok = await _run_ytdlp(vod_url, probe_path, clip_start, clip_end)
        if not ok or not os.path.exists(probe_path):
            log.warn("qc_probe_download_failed")
            return current_offset

        qc = await validate_clip(probe_path, probe_game_time)

        if qc.is_gameplay and qc.actual_game_time is not None:
            # We know at vod_time the game is at qc.actual_game_time.
            # We wanted it to be at probe_game_time.
            # correction = (actual - expected) seconds: how much the VOD is "ahead"
            # of what we computed. We need to shift the offset forward.
            correction = qc.drift_seconds
            corrected_offset = current_offset + correction

            log.info(
                "qc_calibrate_done",
                correction=correction,
                old_offset=current_offset,
                new_offset=corrected_offset,
                timer=qc.timer_reading,
            )
            return corrected_offset

        # Not gameplay at expected position — scan forward
        log.info("qc_probe_not_gameplay", vod_time=vod_time)
        for extra in range(60, max_scan_minutes * 60 + 1, 60):
            _safe_remove(probe_path)
            scan_start = vod_time + extra
            ok = await _run_ytdlp(vod_url, probe_path, scan_start, scan_start + 7)
            if not ok or not os.path.exists(probe_path):
                continue
            qc = await validate_clip(probe_path, probe_game_time + extra)
            if qc.is_gameplay and qc.actual_game_time is not None:
                # Found gameplay at scan_start. The game timer reads qc.actual_game_time.
                # Real game start in VOD = scan_start - qc.actual_game_time
                real_game_start = scan_start - qc.actual_game_time
                corrected_offset = real_game_start
                log.info(
                    "qc_calibrate_scanned",
                    scanned_to=scan_start,
                    timer=qc.timer_reading,
                    real_game_start=real_game_start,
                    old_offset=current_offset,
                    new_offset=corrected_offset,
                )
                return corrected_offset

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
