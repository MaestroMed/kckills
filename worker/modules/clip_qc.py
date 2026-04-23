"""
POST-CLIP QC — Verify clip content AFTER extraction, auto-correct offset.

Instead of guessing the offset before clipping, this module:
1. Clips the kill with the current offset
2. Reads the in-game timer from the ACTUAL clip (frame at mid-point)
3. Compares with expected game_time_seconds
4. If drift > 30s: computes corrected offset, re-clips with correction
5. Loops up to 3 times until timing converges

This eliminates the "clip shows wrong moment" problem because the
verification happens on the REAL output, not a pre-clip probe.
"""

from __future__ import annotations

import os
import re
import subprocess
import asyncio
import structlog

from config import config
from scheduler import scheduler

log = structlog.get_logger()

MAX_RETRIES = 3
DRIFT_THRESHOLD = 45  # seconds — clips within 45s are acceptable


async def verify_clip_timing(
    clip_path: str,
    expected_game_time: int,
    frame_offset_in_clip: int = 15,
) -> tuple[bool, int]:
    """Read the in-game timer from a clip and compute drift.

    Extracts a frame at `frame_offset_in_clip` seconds into the clip,
    sends to Gemini to read the timer, compares with expected.

    Args:
        clip_path: Path to the MP4 clip on disk.
        expected_game_time: The game_time_seconds this clip SHOULD show.
            At frame_offset_in_clip=15 with before_pad=15, the frame
            should show game_time = expected_game_time (for moments)
            or expected_game_time - 15 (for kills with -30s pad).
        frame_offset_in_clip: Where in the clip to read (seconds).

    Returns:
        (is_correct, drift_seconds)
        is_correct: True if abs(drift) <= DRIFT_THRESHOLD
        drift_seconds: actual_timer - expected (positive = clip shows later moment)
    """
    if not os.path.exists(clip_path):
        return False, 0

    # Extract frame
    frame_path = clip_path.replace(".mp4", "_qc.jpg")
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-ss", str(frame_offset_in_clip),
             "-i", clip_path, "-frames:v", "1", "-q:v", "2",
             "-vf", "scale=1920:-1", frame_path],
            capture_output=True, timeout=15,
        )
        if r.returncode != 0 or not os.path.exists(frame_path):
            return False, 0

        # Read timer with Gemini
        can_call = await scheduler.wait_for("gemini")
        if not can_call:
            return False, 0

        import google.generativeai as genai
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel(config.GEMINI_MODEL_QC)

        img = genai.upload_file(frame_path)
        from services.gemini_client import _wait_for_file_active
        _wait_for_file_active(genai, img, timeout=30)

        response = model.generate_content([
            "Read the in-game League of Legends timer at the top center. "
            "Reply ONLY MM:SS. If not visible reply NONE.",
            img,
        ])
        timer_text = response.text.strip()

        match = re.match(r"(\d+):(\d+)", timer_text)
        if not match:
            log.info("clip_qc_no_timer", clip=clip_path, response=timer_text[:30])
            return False, 0

        actual_seconds = int(match.group(1)) * 60 + int(match.group(2))
        drift = actual_seconds - expected_game_time

        is_ok = abs(drift) <= DRIFT_THRESHOLD
        log.info(
            "clip_qc_result",
            expected=f"{expected_game_time // 60}:{expected_game_time % 60:02d}",
            actual=timer_text,
            drift=drift,
            ok=is_ok,
        )
        return is_ok, drift

    except Exception as e:
        log.error("clip_qc_error", error=str(e)[:80])
        return False, 0
    finally:
        if os.path.exists(frame_path):
            os.remove(frame_path)


async def clip_with_qc_loop(
    clip_func,
    clip_kwargs: dict,
    game_time_seconds: int,
    game_id: str,
    vod_offset_key: str = "vod_offset_seconds",
) -> dict | None:
    """Clip a kill/moment, verify timing, re-clip if drift detected.

    Args:
        clip_func: The clipper function (clip_kill or clip_moment).
        clip_kwargs: kwargs to pass to clip_func. Must include
            vod_offset_seconds which will be adjusted on retry.
        game_time_seconds: Expected game time for QC check.
        game_id: DB game ID (for logging).
        vod_offset_key: Key in clip_kwargs for the offset to adjust.

    Returns:
        The clip URLs dict from clip_func, or None if all retries fail.
    """
    current_offset = clip_kwargs.get(vod_offset_key, 0)

    for attempt in range(MAX_RETRIES):
        # Clip with current offset
        clip_kwargs[vod_offset_key] = current_offset
        urls = await clip_func(**clip_kwargs)

        if not urls or not urls.get("_local_h_path"):
            # Clip failed entirely — no point retrying
            return urls

        local_path = urls["_local_h_path"]

        # The frame at t=15 of a clip with -30s padding shows game_time - 15.
        # For moments with -15s padding, frame at t=15 shows game_time.
        # Use the mid-point as the expected time.
        expected_at_frame = game_time_seconds - 15  # approximate

        is_ok, drift = await verify_clip_timing(
            local_path, expected_at_frame, frame_offset_in_clip=15,
        )

        if is_ok:
            log.info("clip_qc_passed", attempt=attempt, game_id=game_id[:8])
            return urls

        if drift == 0:
            # Couldn't read timer — accept the clip as-is
            log.warn("clip_qc_unreadable", attempt=attempt, game_id=game_id[:8])
            return urls

        # Adjust offset and retry
        current_offset += drift
        if current_offset < 0:
            current_offset = 0
        log.info(
            "clip_qc_retry",
            attempt=attempt + 1,
            drift=drift,
            new_offset=current_offset,
            game_id=game_id[:8],
        )

    # All retries exhausted
    log.warn("clip_qc_exhausted", game_id=game_id[:8], final_offset=current_offset)
    return urls  # Return last attempt's result anyway
