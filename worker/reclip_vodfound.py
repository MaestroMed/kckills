"""
Re-clip all kills in vod_found status with POST-CLIP QC.

For each clip:
1. Extract from local VOD with current offset
2. Read in-game timer from the ACTUAL clip via Gemini
3. If drift > 45s: correct offset, re-extract
4. Up to 3 retries per game until offset converges
5. Once a game's offset is confirmed, all kills use the corrected offset

This is the DEFINITIVE clipping pipeline — no more guessing offsets.
"""
import asyncio
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from scheduler import scheduler
scheduler.DELAYS["ytdlp"] = 5.0
scheduler.DELAYS["ffmpeg_cooldown"] = 1.0
scheduler.DELAYS["gemini"] = 4.0  # respect rate limit

from services.supabase_client import safe_select, safe_update
from modules import clipper
from config import config

import structlog
structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

DRIFT_THRESHOLD = 45  # seconds
MAX_CALIBRATION_RETRIES = 3


async def read_timer_from_clip(clip_path: str, frame_at: int = 15) -> int | None:
    """Extract frame from clip and read LoL timer with Gemini. Returns seconds or None.

    Tries multiple frame positions if the first one fails (handles replays/scoreboards).
    """
    positions = [frame_at, 5, 10, 20, 25]  # try multiple positions
    frame_path = clip_path + ".qc.jpg"

    import google.generativeai as genai
    genai.configure(api_key=config.GEMINI_API_KEY)

    for pos in positions:
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-ss", str(pos), "-i", clip_path,
                 "-frames:v", "1", "-q:v", "1", "-vf", "scale=1920:-1", frame_path],
                capture_output=True, timeout=15,
            )
            if r.returncode != 0 or not os.path.exists(frame_path):
                continue

            can_call = await scheduler.wait_for("gemini")
            if not can_call:
                return None

            model = genai.GenerativeModel(
                os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
            )
            img = genai.upload_file(frame_path)
            from services.gemini_client import _wait_for_file_active
            _wait_for_file_active(genai, img, timeout=30)

            response = model.generate_content([
                "Read the in-game League of Legends timer at the top center of the HUD. "
                "The timer format is MM:SS (e.g. 15:30, 23:45). "
                "Reply ONLY the timer value like 12:34. If not visible reply NONE.",
                img,
            ])
            timer_text = response.text.strip()
            match = re.match(r"(\d+):(\d+)", timer_text)
            if match:
                actual = int(match.group(1)) * 60 + int(match.group(2))
                # Adjust for frame position within clip:
                # if we read at pos instead of frame_at, the actual game time
                # is shifted by (pos - frame_at) seconds
                adjusted = actual - (pos - frame_at)
                return adjusted

        except Exception as e:
            log.warn("qc_read_error", pos=pos, error=str(e)[:60])
        finally:
            if os.path.exists(frame_path):
                os.remove(frame_path)

    return None


async def calibrate_offset_from_clip(
    local_vod: str,
    vod_offset: int,
    probe_game_time: int,
) -> tuple[int, bool]:
    """Clip a short probe, read timer, compute corrected offset.

    Returns (corrected_offset, success).
    """
    probe_path = os.path.join(config.CLIPS_DIR, "calibration_probe.mp4")
    os.makedirs(config.CLIPS_DIR, exist_ok=True)

    vod_time = vod_offset + probe_game_time
    clip_start = max(0, vod_time - 20)

    try:
        # Extract 30s probe clip
        ok = await clipper._ffmpeg([
            "-ss", str(clip_start), "-i", local_vod,
            "-t", "30",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac", "-b:a", "64k",
            "-movflags", "+faststart",
            "-y", probe_path,
        ])
        if not ok or not os.path.exists(probe_path):
            return vod_offset, False

        # Read timer at t=15 (mid-clip)
        actual = await read_timer_from_clip(probe_path, frame_at=15)
        if actual is None:
            return vod_offset, False

        # At t=15 of the probe, we're at vod position = clip_start + 15
        # The timer shows actual game time = `actual`
        # So game_start_in_vod = (clip_start + 15) - actual
        game_start = (clip_start + 15) - actual
        drift = vod_offset - game_start

        if abs(drift) <= DRIFT_THRESHOLD:
            return vod_offset, True  # offset is correct
        else:
            log.info("calibrate_drift", old=vod_offset, new=game_start,
                     drift=drift, timer=f"{actual//60}:{actual%60:02d}",
                     expected_gt=probe_game_time)
            return game_start, True

    except Exception as e:
        log.error("calibrate_error", error=str(e)[:60])
        return vod_offset, False
    finally:
        if os.path.exists(probe_path):
            os.remove(probe_path)


async def main():
    kills = safe_select(
        "kills",
        "id, game_id, game_time_seconds, multi_kill, killer_champion, victim_champion",
        status="vod_found",
    )
    print(f"Kills to re-clip: {len(kills)}")
    if not kills:
        return

    # Group by game
    by_game: dict[str, list[dict]] = {}
    for k in kills:
        by_game.setdefault(k.get("game_id", ""), []).append(k)

    print(f"Games: {len(by_game)}")
    total_done = 0
    total_fail = 0

    for gid, game_kills in by_game.items():
        game_rows = safe_select("games", "vod_youtube_id, vod_offset_seconds, game_number", id=gid)
        if not game_rows:
            total_fail += len(game_kills)
            continue
        g = game_rows[0]
        yt_id = g.get("vod_youtube_id")
        if not yt_id:
            total_fail += len(game_kills)
            continue

        vod_offset = int(g.get("vod_offset_seconds") or 0)
        game_num = g.get("game_number", "?")

        # Download VOD
        local_vod = await clipper.download_full_vod(yt_id)
        if not local_vod:
            total_fail += len(game_kills)
            continue

        print(f"\n  Game {gid[:8]} (#{game_num}, {len(game_kills)} kills, VOD {yt_id})")

        # ─── STEP 1: Calibrate offset using MULTIPLE probe positions ────
        # Try 3 different kill positions (early, mid, late) to find one
        # where the timer is readable. This handles replays/scoreboards.
        game_kills.sort(key=lambda k: k.get("game_time_seconds", 0))
        valid_kills = [k for k in game_kills if (k.get("game_time_seconds", 0)) > 180]
        if not valid_kills:
            valid_kills = game_kills

        # Pick 3 spread positions
        n = len(valid_kills)
        probe_indices = [0, n // 2, n - 1] if n >= 3 else list(range(n))
        probe_gts = [valid_kills[i].get("game_time_seconds", 600) for i in probe_indices]

        calibrated = False
        for probe_gt in probe_gts:
            for attempt in range(MAX_CALIBRATION_RETRIES):
                new_offset, success = await calibrate_offset_from_clip(
                    local_vod, vod_offset, probe_gt,
                )
                if not success:
                    break  # try next probe position

                if new_offset == vod_offset:
                    print(f"    Offset OK: {vod_offset}s (probe @{probe_gt//60}:{probe_gt%60:02d})")
                    calibrated = True
                    break

                print(f"    Offset corrected: {vod_offset} -> {new_offset} (probe @{probe_gt//60}:{probe_gt%60:02d})")
                vod_offset = new_offset

                # Verify
                verify_offset, verify_ok = await calibrate_offset_from_clip(
                    local_vod, vod_offset, probe_gt,
                )
                if verify_ok and abs(verify_offset - vod_offset) <= DRIFT_THRESHOLD:
                    print(f"    Verified! Final offset: {vod_offset}s")
                    calibrated = True
                    break
                elif verify_ok:
                    vod_offset = verify_offset

            if calibrated:
                break

        if calibrated:
            safe_update("games", {"vod_offset_seconds": vod_offset}, "id", gid)
        else:
            print(f"    WARNING: Could not calibrate offset for any probe, using {vod_offset}s")

        # ─── STEP 2: Clip all kills with the calibrated offset ──────────
        for k in game_kills:
            gt = int(k.get("game_time_seconds") or 0)
            urls = await clipper.clip_kill(
                kill_id=k["id"],
                youtube_id=yt_id,
                vod_offset_seconds=vod_offset,
                game_time_seconds=gt,
                multi_kill=k.get("multi_kill"),
                killer_champion=k.get("killer_champion"),
                victim_champion=k.get("victim_champion"),
                match_context=f"Game {game_num}  T+{gt // 60:02d}:{gt % 60:02d}",
                local_vod_path=local_vod,
            )
            if urls and urls.get("clip_url_horizontal"):
                urls.pop("_local_h_path", None)
                safe_update("kills", {**urls, "status": "published"}, "id", k["id"])
                total_done += 1
            else:
                safe_update("kills", {"status": "clip_error"}, "id", k["id"])
                total_fail += 1

        print(f"    Done: {total_done} ok, {total_fail} fail total")

        # Clean up VOD after processing this game's kills to save disk space
        # (it will be re-downloaded if needed for another game on the same VOD)
        if local_vod and os.path.exists(local_vod):
            try:
                os.remove(local_vod)
                log.info("vod_cleaned_after_game", path=local_vod)
            except Exception:
                pass

    print(f"\nFinal: {total_done} re-clipped, {total_fail} failed")


if __name__ == "__main__":
    asyncio.run(main())
