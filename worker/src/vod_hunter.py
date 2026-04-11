"""
VOD HUNTER — Finds YouTube VODs for completed games and calibrates time offsets.

For each game that has kills but no VOD URL:
1. Search YouTube for the corresponding VOD
2. Download a segment to calibrate the game start offset via OCR
3. Update the game record with VOD URL and offset
"""

import re
import subprocess
import httpx
from datetime import datetime
from .config import config
from .db import get_db, log


# LoL Esports YouTube channels
LOL_ESPORTS_CHANNELS = [
    "UCzAypSoOFKCZUts3ULtVT_g",  # LoL Esports
    "UCVHkgOqHzfFaGv6YR0aykrQ",  # LoL Esports FR (LFL)
]


def search_youtube_vod(match_slug: str, match_date: str, teams: tuple[str, str]) -> str | None:
    """Search for a VOD on YouTube using the API or yt-dlp."""
    team_a, team_b = teams

    # Try YouTube Data API first
    if config.YOUTUBE_API_KEY:
        vod_url = _search_youtube_api(team_a, team_b, match_date)
        if vod_url:
            return vod_url

    # Fallback: yt-dlp search
    return _search_ytdlp(team_a, team_b, match_date)


def _search_youtube_api(team_a: str, team_b: str, match_date: str) -> str | None:
    """Search YouTube Data API for the VOD."""
    query = f"{team_a} vs {team_b} LEC"
    date = datetime.fromisoformat(match_date.replace("Z", "+00:00"))

    url = "https://www.googleapis.com/youtube/v3/search"
    params = {
        "part": "snippet",
        "q": query,
        "type": "video",
        "order": "date",
        "publishedAfter": date.strftime("%Y-%m-%dT00:00:00Z"),
        "publishedBefore": (date.replace(day=date.day + 2)).strftime("%Y-%m-%dT00:00:00Z"),
        "maxResults": 5,
        "key": config.YOUTUBE_API_KEY,
    }

    try:
        resp = httpx.get(url, params=params, timeout=30)
        resp.raise_for_status()
        items = resp.json().get("items", [])

        for item in items:
            title = item["snippet"]["title"].lower()
            if team_a.lower() in title and team_b.lower() in title:
                video_id = item["id"]["videoId"]
                return f"https://www.youtube.com/watch?v={video_id}"

        # Return first result as best guess
        if items:
            video_id = items[0]["id"]["videoId"]
            return f"https://www.youtube.com/watch?v={video_id}"
    except Exception as e:
        log("warn", "vod_hunter", f"YouTube API search failed: {e}")

    return None


def _search_ytdlp(team_a: str, team_b: str, match_date: str) -> str | None:
    """Use yt-dlp to search YouTube."""
    query = f"{team_a} vs {team_b} LEC full game"

    try:
        result = subprocess.run(
            ["yt-dlp", "--flat-playlist", "--print", "url", f"ytsearch5:{query}"],
            capture_output=True, text=True, timeout=60,
        )
        urls = result.stdout.strip().split("\n")
        return urls[0] if urls and urls[0] else None
    except Exception as e:
        log("warn", "vod_hunter", f"yt-dlp search failed: {e}")
        return None


def calibrate_vod_offset(vod_url: str, game_number: int) -> float | None:
    """
    Determine the game start offset in the VOD.

    Strategy:
    1. Download low-res frames at regular intervals
    2. Use OCR to detect the in-game timer showing "0:00" or "0:15"
    3. Return the VOD timestamp where the game starts

    For multi-game VODs (Bo3/Bo5), we need to find game N specifically.
    """
    try:
        # First, get the VOD duration
        result = subprocess.run(
            ["yt-dlp", "--print", "duration", vod_url],
            capture_output=True, text=True, timeout=30,
        )
        duration = float(result.stdout.strip())
    except Exception as e:
        log("warn", "vod_hunter", f"Could not get VOD duration: {e}")
        return None

    # For Game 1, the game typically starts 5-20 minutes in
    # For Game 2+, it's further in
    # We'll scan in 30-second intervals looking for the game start
    try:
        import easyocr
        reader = easyocr.Reader(["en"], gpu=False)
    except Exception:
        log("warn", "vod_hunter", "EasyOCR not available, using manual offset")
        return None

    # Estimate search range based on game number
    if game_number == 1:
        search_start = 300   # 5 min
        search_end = min(1800, duration)  # up to 30 min
    elif game_number == 2:
        search_start = max(1800, duration * 0.3)
        search_end = min(duration * 0.6, duration)
    else:
        search_start = max(duration * 0.5, 3600)
        search_end = min(duration * 0.8, duration)

    log("info", "vod_hunter",
        f"Scanning VOD for game {game_number} start between {search_start:.0f}s and {search_end:.0f}s")

    # Sample frames every 30 seconds
    sample_interval = 30
    current_time = search_start

    while current_time < search_end:
        frame_path = f"/tmp/kckills_frame_{current_time:.0f}.jpg"

        try:
            # Extract a single frame using ffmpeg
            subprocess.run([
                "ffmpeg", "-y", "-ss", str(current_time),
                "-i", vod_url,
                "-vframes", "1",
                "-q:v", "2",
                frame_path,
            ], capture_output=True, timeout=30)

            # OCR the frame — look for game timer region (top center)
            results = reader.readtext(frame_path)

            for (bbox, text, confidence) in results:
                # Look for timer pattern like "0:00", "0:15", "1:00"
                text_clean = text.strip()
                if re.match(r"^[0-2]:[0-5]\d$", text_clean) and confidence > 0.5:
                    # Found the game timer!
                    timer_parts = text_clean.split(":")
                    game_seconds = int(timer_parts[0]) * 60 + int(timer_parts[1])

                    # The offset is: vod_time - game_time
                    offset = current_time - game_seconds
                    log("info", "vod_hunter",
                        f"Found game {game_number} timer '{text_clean}' at VOD {current_time:.0f}s, offset={offset:.0f}s")
                    return offset

        except Exception:
            pass

        current_time += sample_interval

    log("warn", "vod_hunter", f"Could not auto-calibrate offset for game {game_number}")
    return None


def run():
    """Process all games that need VOD hunting."""
    db = get_db()

    # Find games without VOD URL that have kills
    games = db.table("games").select(
        "id, riot_game_id, game_number, match_id, vod_url, vod_offset_calibrated"
    ).is_("vod_url", "null").execute()

    for game in games.data or []:
        # Get match info for search
        match = db.table("matches").select(
            "slug, match_date, team_blue_id, team_red_id"
        ).eq("id", game["match_id"]).single().execute()

        if not match.data:
            continue

        # Get team names
        blue_team = db.table("teams").select("short_name").eq("id", match.data["team_blue_id"]).single().execute()
        red_team = db.table("teams").select("short_name").eq("id", match.data["team_red_id"]).single().execute()

        if not blue_team.data or not red_team.data:
            continue

        blue_name = blue_team.data["short_name"]
        red_name = red_team.data["short_name"]

        log("info", "vod_hunter", f"Searching VOD for {blue_name} vs {red_name} Game {game['game_number']}")

        # Search for VOD
        vod_url = search_youtube_vod(
            match.data["slug"],
            match.data["match_date"],
            (blue_name, red_name),
        )

        if not vod_url:
            log("warn", "vod_hunter", f"No VOD found for {blue_name} vs {red_name}")
            # Update kills to no_vod status
            db.table("kills").update({"status": "no_vod"}).eq("game_id", game["id"]).eq("status", "pending").execute()
            continue

        # Try to calibrate offset
        offset = calibrate_vod_offset(vod_url, game["game_number"])

        # Update game record
        db.table("games").update({
            "vod_url": vod_url,
            "vod_platform": "youtube",
            "vod_offset_seconds": offset,
            "vod_offset_calibrated": offset is not None,
        }).eq("id", game["id"]).execute()

        # Update kill statuses
        new_status = "vod_found" if offset is not None else "vod_searching"
        db.table("kills").update({"status": new_status}).eq("game_id", game["id"]).eq("status", "pending").execute()

        log("info", "vod_hunter",
            f"VOD found for {blue_name} vs {red_name}: {vod_url} (offset: {offset})")
