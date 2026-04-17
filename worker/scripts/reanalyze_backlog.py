"""
BACKFILL — re-analyze published kills that lack Scroll Vivant dimensions.

Runs the standard analyzer prompt against the clip, then persists the 6
structured pivot fields (lane_phase, fight_type, objective_context,
matchup_lane, champion_class, game_minute_bucket).

Idempotent: skips kills that already have lane_phase set.
Respects the Gemini daily quota via the shared scheduler.

Usage (from worker/):
    python scripts/reanalyze_backlog.py
    python scripts/reanalyze_backlog.py --limit 50
    python scripts/reanalyze_backlog.py --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import tempfile
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import config
from scheduler import scheduler
from services.supabase_client import safe_select, safe_update

import structlog

structlog.configure(processors=[
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()


FIELDS = (
    "id, game_id, game_time_seconds, killer_champion, victim_champion, "
    "killer_player_id, victim_player_id, confidence, assistants, multi_kill, "
    "is_first_blood, tracked_team_involvement, shutdown_bounty, "
    "clip_url_vertical, lane_phase"
)


def _load_player_names() -> dict[str, str]:
    rows = safe_select("players", "id, ign") or []
    return {r["id"]: r.get("ign") or "?" for r in rows}


def _needs_refresh(rows: list[dict]) -> list[dict]:
    return [r for r in rows if not r.get("lane_phase")]


async def _download_clip(url: str) -> str | None:
    """Stream a clip to a temp file, returning the path or None on failure."""
    try:
        fd, path = tempfile.mkstemp(suffix=".mp4", prefix="reanalyze_")
        os.close(fd)
        with httpx.stream("GET", url, follow_redirects=True, timeout=30) as r:
            r.raise_for_status()
            with open(path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        return path
    except Exception as e:
        log.warn("reanalyze_download_failed", url=url, error=str(e))
        return None


async def _process_kill(kill: dict, players: dict[str, str], dry_run: bool) -> str:
    from modules.analyzer import analyze_kill_row, _build_analysis_patch

    kill = dict(kill)  # local copy, we'll inject name hints
    kill["_killer_name_hint"] = players.get(kill.get("killer_player_id"))
    kill["_victim_name_hint"] = players.get(kill.get("victim_player_id"))

    clip_path = None
    if kill.get("clip_url_vertical"):
        clip_path = await _download_clip(kill["clip_url_vertical"])

    try:
        result = await analyze_kill_row(kill, clip_path=clip_path)
    finally:
        if clip_path and os.path.exists(clip_path):
            try:
                os.remove(clip_path)
            except OSError:
                pass

    if not result:
        return "skip_no_result"

    patch = _build_analysis_patch(result, kill)
    # Preserve the existing publication status — never demote a live kill.
    patch.pop("status", None)

    if dry_run:
        log.info("reanalyze_dry", kill=kill["id"][:8], patch=patch)
        return "dry"

    safe_update("kills", patch, "id", kill["id"])
    log.info(
        "reanalyze_patched",
        kill=kill["id"][:8],
        bucket=patch.get("game_minute_bucket"),
        fight=patch.get("fight_type"),
        lane=patch.get("matchup_lane"),
    )
    return "ok"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="max kills to process")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not config.GEMINI_API_KEY:
        log.error("reanalyze_no_gemini_key")
        return 1

    all_rows = safe_select("kills", FIELDS, status="published") or []
    todo = _needs_refresh(all_rows)
    if args.limit:
        todo = todo[: args.limit]

    log.info("reanalyze_start", total=len(all_rows), todo=len(todo))
    players = _load_player_names()

    ok = skipped = 0
    for i, kill in enumerate(todo):
        remaining = scheduler.get_remaining("gemini")
        if remaining is not None and remaining <= 0:
            log.warn("reanalyze_quota_exhausted", processed=ok, remaining_todo=len(todo) - i)
            break
        status = await _process_kill(kill, players, args.dry_run)
        if status in ("ok", "dry"):
            ok += 1
        else:
            skipped += 1

    log.info("reanalyze_done", processed=ok, skipped=skipped)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
