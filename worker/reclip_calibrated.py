"""
MULTI-POINT VOD CALIBRATION + RE-CLIP

Instead of 1 offset per game, probe every 5 minutes of game time,
build a piecewise time map, then interpolate for each kill.

This fixes clips that show analyst desk/replays instead of gameplay.
"""
import asyncio
import json
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
scheduler.DELAYS["gemini"] = 4.0

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

PROBE_INTERVAL = 300   # seconds (5 min)
TIME_MAPS_FILE = os.path.join(os.path.dirname(__file__), "vod_time_maps.json")


# ═══════════════════════════════════════════════════════════════════
# STEP 1: Read timer from a single VOD frame (no clip extraction)
# ═══════════════════════════════════════════════════════════════════

async def read_timer_from_frame(vod_path: str, vod_pos: int) -> tuple[int | None, bool]:
    """Extract 1 JPEG frame at vod_pos, read timer with Gemini.

    Returns (game_time_seconds, success).
    Tries 3 positions: exact, +15s, -15s to skip replays.
    """
    # Wave 13f migration — moved off `google.generativeai`
    # (deprecated) onto `google.genai`.
    from services.gemini_client import get_client, _wait_for_file_active
    from google.genai import types
    client = get_client()
    if client is None:
        return None, False

    for offset in [0, 15, -15]:
        pos = max(0, vod_pos + offset)
        frame_path = vod_path + f".probe_{pos}.jpg"
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-ss", str(pos), "-i", vod_path,
                 "-frames:v", "1", "-q:v", "1", "-vf", "scale=1920:-1", frame_path],
                capture_output=True, timeout=15,
            )
            if r.returncode != 0 or not os.path.exists(frame_path):
                continue

            can_call = await scheduler.wait_for("gemini")
            if not can_call:
                return None, False

            model_name = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")
            img = client.files.upload(
                file=frame_path,
                config=types.UploadFileConfig(mime_type="image/jpeg"),
            )
            _wait_for_file_active(client, img, timeout=30)

            response = client.models.generate_content(
                model=model_name,
                contents=[
                    "Read the in-game League of Legends timer at the top center of the HUD. "
                    "The timer shows elapsed game time in MM:SS format (e.g. 15:30, 23:45). "
                    "Reply ONLY the timer value like 12:34. If no LoL game timer is visible "
                    "(e.g. analyst desk, champion select, replay overlay, scoreboard) reply NONE.",
                    img,
                ],
            )
            timer_text = (response.text or "").strip()
            match = re.match(r"(\d+):(\d+)", timer_text)
            if match:
                game_time = int(match.group(1)) * 60 + int(match.group(2))
                actual_vod_pos = pos  # where we actually read the frame
                log.info("timer_read", vod_pos=pos, game_time=f"{game_time//60}:{game_time%60:02d}", offset_tried=offset)
                return game_time, True

            log.debug("timer_not_visible", vod_pos=pos, response=timer_text[:30])

        except Exception as e:
            log.warn("frame_read_error", pos=pos, error=str(e)[:60])
        finally:
            if os.path.exists(frame_path):
                os.remove(frame_path)

    return None, False


# ═══════════════════════════════════════════════════════════════════
# STEP 2: Build a time map for one game
# ═══════════════════════════════════════════════════════════════════

async def build_time_map(
    vod_path: str,
    vod_offset: int,
    game_duration: int,
) -> list[dict]:
    """Probe every 5 minutes of game time, return list of {game_time, vod_time} anchors."""

    if game_duration <= 0:
        # Estimate 30 minutes if unknown
        game_duration = 1800

    # Generate probe points: every 5 min from 2:00 to end
    probe_game_times = list(range(120, game_duration, PROBE_INTERVAL))
    if not probe_game_times:
        probe_game_times = [300]  # at least one probe at 5:00

    # Add a late-game probe if the last one is far from the end
    if game_duration - probe_game_times[-1] > 180:
        probe_game_times.append(game_duration - 60)

    anchors = []

    for probe_gt in probe_game_times:
        # Estimate where this game_time should be in the VOD
        estimated_vod_pos = vod_offset + probe_gt

        game_time_read, success = await read_timer_from_frame(vod_path, estimated_vod_pos)

        if success and game_time_read is not None:
            # The frame at estimated_vod_pos shows game_time_read
            # So: vod_time for game_time_read = estimated_vod_pos
            anchors.append({
                "game_time": game_time_read,
                "vod_time": estimated_vod_pos,
            })

    # Validate: sort by vod_time, ensure game_times are monotonically increasing
    anchors.sort(key=lambda a: a["vod_time"])
    validated = []
    last_gt = -1
    for a in anchors:
        if a["game_time"] > last_gt:
            validated.append(a)
            last_gt = a["game_time"]
        else:
            log.warn("anchor_dropped_non_monotonic", anchor=a, last_gt=last_gt)

    # Add anchor at game_time=0 (extrapolated from first anchor)
    if len(validated) >= 1:
        first = validated[0]
        t0_vod = first["vod_time"] - first["game_time"]  # vod position at game start
        validated.insert(0, {"game_time": 0, "vod_time": t0_vod})

    log.info("time_map_built", anchors=len(validated),
             range=f"{validated[0]['game_time']//60}:{validated[0]['game_time']%60:02d}-{validated[-1]['game_time']//60}:{validated[-1]['game_time']%60:02d}" if validated else "empty")

    return validated


# ═══════════════════════════════════════════════════════════════════
# STEP 3: Interpolate VOD time for any game_time
# ═══════════════════════════════════════════════════════════════════

def interpolate_vod_time(game_time: int, time_map: list[dict]) -> int | None:
    """Piecewise linear interpolation from game_time to vod_time."""
    if not time_map or len(time_map) < 2:
        return None

    anchors = sorted(time_map, key=lambda a: a["game_time"])

    # Before first anchor: extrapolate
    if game_time <= anchors[0]["game_time"]:
        gt0, vt0 = anchors[0]["game_time"], anchors[0]["vod_time"]
        gt1, vt1 = anchors[1]["game_time"], anchors[1]["vod_time"]
        rate = (vt1 - vt0) / (gt1 - gt0) if gt1 != gt0 else 1.0
        return int(vt0 + rate * (game_time - gt0))

    # After last anchor: extrapolate
    if game_time >= anchors[-1]["game_time"]:
        gt0, vt0 = anchors[-2]["game_time"], anchors[-2]["vod_time"]
        gt1, vt1 = anchors[-1]["game_time"], anchors[-1]["vod_time"]
        rate = (vt1 - vt0) / (gt1 - gt0) if gt1 != gt0 else 1.0
        return int(vt1 + rate * (game_time - gt1))

    # Between anchors: interpolate
    for i in range(len(anchors) - 1):
        if anchors[i]["game_time"] <= game_time <= anchors[i + 1]["game_time"]:
            gt0, vt0 = anchors[i]["game_time"], anchors[i]["vod_time"]
            gt1, vt1 = anchors[i + 1]["game_time"], anchors[i + 1]["vod_time"]
            if gt1 == gt0:
                return vt0
            frac = (game_time - gt0) / (gt1 - gt0)
            return int(vt0 + frac * (vt1 - vt0))

    return int(anchors[-1]["vod_time"])


# ═══════════════════════════════════════════════════════════════════
# MAIN LOOP
# ═══════════════════════════════════════════════════════════════════

async def main():
    print("=== MULTI-POINT VOD CALIBRATION ===\n")

    # Load saved time maps if resuming
    saved_maps: dict[str, list[dict]] = {}
    if os.path.exists(TIME_MAPS_FILE):
        with open(TIME_MAPS_FILE) as f:
            saved_maps = json.load(f)
        print(f"Loaded {len(saved_maps)} saved time maps from previous run\n")

    # Fetch all published kills grouped by game
    kills = safe_select(
        "kills",
        "id, game_id, game_time_seconds, killer_champion, victim_champion, "
        "multi_kill, tracked_team_involvement, clip_url_vertical",
        status="published",
    )
    print(f"Published kills: {len(kills)}")

    # Group by game_id
    games_kills: dict[str, list] = {}
    for k in kills:
        gid = k["game_id"]
        games_kills.setdefault(gid, []).append(k)

    # Fetch game data
    games_data: dict[str, dict] = {}
    for gid in games_kills:
        rows = safe_select("games", "id, game_number, vod_youtube_id, vod_offset_seconds, duration_seconds", id=gid)
        if rows:
            games_data[gid] = rows[0]

    # Group games by VOD YouTube ID
    vod_games: dict[str, list[str]] = {}
    for gid, gdata in games_data.items():
        yt_id = gdata.get("vod_youtube_id")
        if yt_id:
            vod_games.setdefault(yt_id, []).append(gid)

    print(f"Games: {len(games_data)}")
    print(f"Unique VODs: {len(vod_games)}\n")

    total_done = 0
    total_fail = 0

    for yt_id, game_ids in vod_games.items():
        print(f"\n{'='*60}")
        print(f"VOD: {yt_id} ({len(game_ids)} games)")
        print(f"{'='*60}")

        # Download VOD once
        local_vod = await clipper.download_full_vod(yt_id)
        if not local_vod:
            print(f"  SKIP: could not download VOD {yt_id}")
            total_fail += sum(len(games_kills.get(gid, [])) for gid in game_ids)
            continue

        for gid in sorted(game_ids, key=lambda g: games_data[g].get("game_number", 0)):
            gdata = games_data[gid]
            gnum = gdata.get("game_number", "?")
            vod_offset = gdata.get("vod_offset_seconds") or 0
            duration = gdata.get("duration_seconds") or 0
            gkills = games_kills.get(gid, [])

            print(f"\n  Game #{gnum} ({len(gkills)} kills, offset={vod_offset}s, dur={duration}s)")

            # ─── PHASE 1: Build or load time map ────────────────
            if gid in saved_maps and len(saved_maps[gid]) >= 2:
                time_map = saved_maps[gid]
                print(f"    Time map loaded from cache ({len(time_map)} anchors)")
            else:
                time_map = await build_time_map(local_vod, vod_offset, duration)
                if len(time_map) >= 2:
                    saved_maps[gid] = time_map
                    # Save incrementally
                    with open(TIME_MAPS_FILE, "w") as f:
                        json.dump(saved_maps, f, indent=2)
                    print(f"    Time map built: {len(time_map)} anchors")
                    for a in time_map:
                        gt = a["game_time"]
                        vt = a["vod_time"]
                        print(f"      GT {gt//60}:{gt%60:02d} -> VOD {vt//60}:{vt%60:02d}")
                else:
                    print(f"    WARNING: only {len(time_map)} anchors, falling back to single offset")
                    # Use single offset as fallback
                    time_map = [
                        {"game_time": 0, "vod_time": vod_offset},
                        {"game_time": 1800, "vod_time": vod_offset + 1800},
                    ]

            # ─── PHASE 2: Re-clip kills with interpolated offsets ────
            gkills.sort(key=lambda k: k.get("game_time_seconds", 0))

            for i, kill in enumerate(gkills):
                gt = kill.get("game_time_seconds") or 0
                kid = kill["id"]

                # Interpolate the correct VOD time
                interpolated_vod_time = interpolate_vod_time(gt, time_map)
                if interpolated_vod_time is None:
                    interpolated_vod_time = vod_offset + gt  # fallback

                # Compute synthetic offset for the clipper formula
                synthetic_offset = interpolated_vod_time - gt

                old_vod_time = vod_offset + gt
                drift = interpolated_vod_time - old_vod_time

                try:
                    result = await clipper.clip_kill(
                        kill_id=kid,
                        youtube_id=yt_id,
                        vod_offset_seconds=synthetic_offset,
                        game_time_seconds=gt,
                        multi_kill=kill.get("multi_kill"),
                        killer_champion=kill.get("killer_champion"),
                        victim_champion=kill.get("victim_champion"),
                        local_vod_path=local_vod,
                    )
                    if result:
                        patch = {}
                        if result.get("clip_h"):
                            patch["clip_url_horizontal"] = result["clip_h"]
                        if result.get("clip_v"):
                            patch["clip_url_vertical"] = result["clip_v"]
                        if result.get("clip_vl"):
                            patch["clip_url_vertical_low"] = result["clip_vl"]
                        if result.get("thumb"):
                            patch["thumbnail_url"] = result["thumb"]
                        if patch:
                            safe_update("kills", patch, "id", kid)
                        total_done += 1
                        drift_str = f" drift={drift:+d}s" if abs(drift) > 5 else ""
                        print(f"    [{i+1}/{len(gkills)}] OK {kid[:8]} GT={gt//60}:{gt%60:02d}{drift_str}")
                    else:
                        total_fail += 1
                        print(f"    [{i+1}/{len(gkills)}] FAIL {kid[:8]}")
                except Exception as e:
                    total_fail += 1
                    log.error("clip_error", kill_id=kid[:8], error=str(e)[:60])

        # Clean up VOD
        if local_vod and os.path.exists(local_vod):
            try:
                os.remove(local_vod)
                log.info("vod_cleaned", path=local_vod)
            except Exception:
                pass

    print(f"\n{'='*60}")
    print(f"DONE: {total_done} re-clipped, {total_fail} failed")
    print(f"Time maps saved to {TIME_MAPS_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
