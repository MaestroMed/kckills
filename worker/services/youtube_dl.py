"""yt-dlp wrapper with retry and backoff.

PR24 — All yt-dlp invocations now thread through `youtube_cookies.cli_args()`
which injects `--cookies <path>` when a YouTube Premium session is
configured (KCKILLS_YT_COOKIES_FILE or KCKILLS_YT_COOKIES_CHROME_PROFILE).
With Premium auth :
  * 429s drop sharply (Premium accounts get priority)
  * 1080p+ formats unlocked
  * Age-gates bypassed
"""

import subprocess
import asyncio
import structlog
from scheduler import scheduler
from services import youtube_cookies

log = structlog.get_logger()

MAX_RETRIES = 5
BACKOFF_BASE = 60  # seconds


async def download_segment(
    url: str,
    output_path: str,
    start_seconds: float,
    end_seconds: float,
    max_height: int = 720,
) -> bool:
    """Download a segment from a YouTube video. Returns True on success."""
    for attempt in range(MAX_RETRIES):
        can_dl = await scheduler.wait_for("ytdlp")
        if not can_dl:
            return False

        try:
            result = subprocess.run([
                "yt-dlp",
                *youtube_cookies.cli_args(),
                "--download-sections", f"*{start_seconds}-{end_seconds}",
                "--force-keyframes-at-cuts",
                "-f", f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]",
                "--merge-output-format", "mp4",
                "-o", output_path,
                "--no-playlist",
                url,
            ], capture_output=True, text=True, timeout=120)

            if result.returncode == 0:
                log.info("ytdlp_download_ok", url=url[:50], attempt=attempt + 1)
                return True

            if "429" in result.stderr or "too many" in result.stderr.lower():
                backoff = BACKOFF_BASE * (2 ** attempt)
                log.warn("ytdlp_throttled", backoff=backoff, attempt=attempt + 1)
                await asyncio.sleep(backoff)
                continue

            log.warn("ytdlp_error", stderr=result.stderr[:300], attempt=attempt + 1)

        except subprocess.TimeoutExpired:
            log.warn("ytdlp_timeout", attempt=attempt + 1)
        except Exception as e:
            log.error("ytdlp_exception", error=str(e), attempt=attempt + 1)

    return False


async def search(query: str, max_results: int = 5) -> list[dict]:
    """Search YouTube via yt-dlp."""
    can_search = await scheduler.wait_for("youtube_search")
    if not can_search:
        return []

    try:
        result = subprocess.run(
            [
                "yt-dlp",
                *youtube_cookies.cli_args(),
                "--flat-playlist",
                "--print", "%(id)s\t%(title)s",
                f"ytsearch{max_results}:{query}",
            ],
            capture_output=True, text=True, timeout=30,
        )
        videos = []
        for line in result.stdout.strip().split("\n"):
            parts = line.split("\t", 1)
            if len(parts) >= 2:
                videos.append({"id": parts[0], "title": parts[1]})
        return videos
    except Exception as e:
        log.warn("ytdlp_search_error", error=str(e))
        return []
