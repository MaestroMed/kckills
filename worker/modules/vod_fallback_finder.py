"""
VOD_FALLBACK_FINDER — Cross-reference reconciled channel_videos with
games that still have no vod_youtube_id, and populate game_vod_sources.

Why this exists :
  - Games created from a fixture import (LFL 2021, EUM 2022, etc.) often
    have no Riot-side VOD because getEventDetails returns nothing for
    long-archived matches.
  - But the channel_reconciler may have already linked a YouTube highlights
    video (matched_match_external_id) to the parent match.
  - This module bridges that gap : if a match has a reconciled video but
    its games still have vod_youtube_id IS NULL, register the video as a
    game_vod_sources entry and (best candidate only) promote it onto
    games.vod_youtube_id so the downstream clipper / vod_offset_finder /
    HLS pipeline pick it up.

Source priority (best first) :
  1. official Riot channels (role='lec_highlights') -> source_type=official_lec, priority=100
  2. team official            (role='team_official') -> source_type=other,        priority=50
  3. streamer clips/vod       (role='streamer_*'   ) -> source_type=kameto,       priority=25

If a video's title carries "Game N", it's matched to that game number;
otherwise it's offered to ALL games in the match (priority lowered).

Idempotent : the (game_id, source_type) UNIQUE constraint in
game_vod_sources stops duplicate inserts. We use safe_upsert so re-runs
just refresh the row instead of erroring.

Daemon interval : 30 minutes. The bottleneck is reconciler completion
(1h cycle), not this module.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

import httpx
import structlog

from services.observability import note, run_logged
from services.supabase_client import get_db, safe_select, safe_update, safe_upsert

log = structlog.get_logger()


# Maximum number of games to scan per cycle. Keeps Supabase egress sane
# even if the historical backlog suddenly grows.
GAMES_PER_CYCLE = 200

GAME_N_RE = re.compile(r"\bGame\s*(\d)\b", re.IGNORECASE)


def _role_to_source(role: str | None) -> tuple[str, int]:
    """Map a channel role to (source_type, priority).

    `source_type` MUST be one of the CHECK constraint values on
    game_vod_sources : ('official_lec','kameto','etostark','other').
    """
    if role == "lec_highlights":
        return ("official_lec", 100)
    if role == "team_official":
        return ("other", 50)
    if role in ("streamer_clips", "streamer_vod"):
        return ("kameto", 25)
    if role == "lfl_highlights":
        return ("official_lec", 80)  # Riot-adjacent, treat as primary
    return ("other", 10)


async def _games_missing_vod(db, limit: int) -> list[dict]:
    """Pull games where vod_youtube_id IS NULL, with parent match info.

    Wave 27.5 — async + asyncio.to_thread so the sync httpx.get doesn't
    block the event loop while the fallback finder waits on PostgREST.
    """
    params: list[tuple[str, str]] = [
        ("select",
         "id,external_id,game_number,vod_youtube_id,"
         "match:matches!games_match_id_fkey(external_id,scheduled_at)"),
        ("vod_youtube_id", "is.null"),
        ("order", "created_at.desc"),
        ("limit", str(limit)),
    ]
    r = await asyncio.to_thread(
        httpx.get,
        f"{db.base}/games",
        headers=db.headers,
        params=params,
        timeout=20.0,
    )
    if r.status_code != 200:
        log.warn(
            "vod_fallback_games_fetch_failed",
            status=r.status_code,
            body=r.text[:200],
        )
        return []
    return r.json() or []


async def _videos_for_match(db, match_external_id: str) -> list[dict]:
    """Pull all reconciled videos linked to a match (with channel role).

    Wave 27.5 — async + asyncio.to_thread (same rationale as
    _games_missing_vod above).
    """
    params: list[tuple[str, str]] = [
        ("select",
         "id,channel_id,title,published_at,duration_seconds,"
         "matched_game_number,kc_relevance_score,"
         "channels!inner(role,handle,display_name)"),
        ("matched_match_external_id", f"eq.{match_external_id}"),
        ("status", "eq.matched"),
    ]
    r = await asyncio.to_thread(
        httpx.get,
        f"{db.base}/channel_videos",
        headers=db.headers,
        params=params,
        timeout=20.0,
    )
    if r.status_code != 200:
        log.warn(
            "vod_fallback_videos_fetch_failed",
            status=r.status_code,
            body=r.text[:200],
            match=match_external_id,
        )
        return []
    return r.json() or []


def _pick_for_game(
    videos: list[dict],
    game_number: int | None,
) -> list[tuple[dict, str, int]]:
    """Filter + score videos for one game.

    Returns a list of (video, source_type, priority) tuples sorted by
    descending priority.
    """
    chosen: list[tuple[dict, str, int]] = []
    for v in videos:
        title = v.get("title") or ""
        # If the video carries a "Game N" tag and we know the game number,
        # filter strictly. If neither has a game tag, it's a free-for-all.
        v_game = v.get("matched_game_number")
        if v_game is None:
            m = GAME_N_RE.search(title)
            if m:
                try:
                    v_game = int(m.group(1))
                except ValueError:
                    v_game = None
        if v_game is not None and game_number is not None and v_game != game_number:
            continue

        ch = v.get("channels") or {}
        role = ch.get("role")
        source_type, base_pri = _role_to_source(role)

        # Multi-game compilations (no Game N tag, but match-wide) get a
        # priority haircut so a per-game upload always wins when both
        # are available.
        if v_game is None and game_number is not None:
            base_pri = max(1, base_pri - 30)

        chosen.append((v, source_type, base_pri))

    chosen.sort(key=lambda t: -t[2])
    return chosen


def _upsert_source(
    game_id: str,
    video_id: str,
    source_type: str,
    priority: int,
) -> bool:
    """Best-effort upsert into game_vod_sources. Returns True on success."""
    try:
        safe_upsert(
            "game_vod_sources",
            {
                "game_id": game_id,
                "source_type": source_type,
                "platform": "youtube",
                "video_id": video_id,
                "sync_validated": False,
                "priority": priority,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="game_id,source_type",
        )
        return True
    except Exception as e:
        log.warn(
            "vod_fallback_upsert_failed",
            game_id=game_id,
            error=str(e)[:120],
        )
        return False


def _promote_to_games(game_id: str, video_id: str) -> bool:
    """Set games.vod_youtube_id when it was NULL. Idempotent — we filter
    by the empty value to avoid clobbering a Riot-supplied id."""
    try:
        # PostgREST PATCH with `vod_youtube_id=is.null` filter so we ONLY
        # write when the column is still empty.
        db = get_db()
        if not db:
            return False
        params: list[tuple[str, str]] = [
            ("id", f"eq.{game_id}"),
            ("vod_youtube_id", "is.null"),
        ]
        r = db._get_client().patch(
            f"{db.base}/games",
            json={"vod_youtube_id": video_id, "state": "vod_found"},
            params=params,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.warn(
            "vod_fallback_promote_failed",
            game_id=game_id,
            error=str(e)[:120],
        )
        return False


@run_logged()
async def run() -> int:
    """Scan games missing a VOD, attach reconciled videos, return count."""
    log.info("vod_fallback_finder_start")

    db = get_db()
    if not db:
        log.warn("vod_fallback_no_db")
        return 0

    games = await _games_missing_vod(db, GAMES_PER_CYCLE)
    if not games:
        log.info("vod_fallback_no_games_pending")
        return 0

    # Cache videos per match — multiple games of the same series share
    # the same video pool.
    video_cache: dict[str, list[dict]] = {}

    sources_inserted = 0
    games_promoted = 0

    for g in games:
        match = g.get("match") or {}
        match_ext = match.get("external_id")
        if not match_ext:
            continue

        if match_ext not in video_cache:
            video_cache[match_ext] = await _videos_for_match(db, match_ext)
        videos = video_cache[match_ext]
        if not videos:
            continue

        scored = _pick_for_game(videos, g.get("game_number"))
        if not scored:
            continue

        # Insert ALL candidates as game_vod_sources (one row per
        # source_type ; the UNIQUE (game_id, source_type) keeps the
        # table clean).
        seen_types: set[str] = set()
        for v, src_type, prio in scored:
            if src_type in seen_types:
                continue  # only the highest-priority video per source_type
            seen_types.add(src_type)
            if _upsert_source(g["id"], v["id"], src_type, prio):
                sources_inserted += 1

        # Promote the SINGLE highest-priority candidate to games.vod_youtube_id
        # (only if still NULL — _promote_to_games filters server-side).
        best_video = scored[0][0]
        if _promote_to_games(g["id"], best_video["id"]):
            games_promoted += 1
            log.info(
                "vod_fallback_promoted",
                game_id=g["id"],
                game_number=g.get("game_number"),
                match=match_ext,
                video_id=best_video["id"],
                source_type=scored[0][1],
                priority=scored[0][2],
            )

    note(
        items_scanned=len(games),
        items_processed=games_promoted,
        sources_inserted=sources_inserted,
    )

    log.info(
        "vod_fallback_finder_done",
        games_scanned=len(games),
        sources_inserted=sources_inserted,
        games_promoted=games_promoted,
    )
    return games_promoted
