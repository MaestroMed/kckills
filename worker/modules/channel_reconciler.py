"""
CHANNEL_RECONCILER — Match channel_videos rows to (match_external_id, game_number).

Pipeline position : channel_discoverer (K-Phase 0) inserted unmatched
videos. This module (K-Phase 1) reads those rows in `status='classified'`
and links each one to a real KC match via the parsed title.

Reconciliation strategy :
  1. Parse title regex → (team_a, team_b, week, day, [game_n])
  2. Find candidates in `matches` table where :
        - both teams match (KC + opp), in any order
        - scheduled_at within the broadcast window (last 7 days for
          "HIGHLIGHTS" type, < 24h for live "LIVE/Game N" type)
  3. If exactly 1 candidate → matched, store match_external_id +
     game_number, status='matched'
  4. If 0 → status='manual_review' (no fixable hit)
  5. If 2+ ambiguous → status='manual_review' too (race vs schedule
     drift — let admin pick)

Daemon interval : 1h. Job is idempotent — re-running only touches rows
still in 'classified' status.

When a video is matched, downstream CLIPPER can use its YouTube ID as
an alternative VOD source via `game_vod_sources` table (migration 001).
The matched videos give us COMPLETE coverage for LEC 2024+ via @LEC
official, without depending on lolesports.com `vod.parameter` which is
sometimes empty / wrong / locale-mismatched.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta

import httpx
import structlog

from services.supabase_client import get_db, safe_update

log = structlog.get_logger()


# Re-use the same regex as channel_discoverer for consistency.
# Team codes can contain digits (G2, T1, 100T, FLY). Allow [A-Z0-9].
LEC_HIGHLIGHTS_RE = re.compile(
    r"^([A-Z0-9]{2,4})\s*vs\.?\s*([A-Z0-9]{2,4})\s*\|\s*HIGHLIGHTS",
    re.IGNORECASE,
)
LIVE_GAME_RE = re.compile(
    r"^([A-Z0-9]{2,4})\s*vs\.?\s*([A-Z0-9]{2,4})\s*Game\s*(\d)",
    re.IGNORECASE,
)
WEEK_DAY_RE = re.compile(r"Week\s*(\d+)\s*Day\s*(\d+)", re.IGNORECASE)


def parse_title_for_match(title: str) -> dict | None:
    """Extract structured match info from a channel video title.

    Returns dict with team codes + optional game_n + week/day, OR None
    if the title doesn't fit a known format.
    """
    out: dict = {}
    m = LEC_HIGHLIGHTS_RE.search(title)
    if m:
        out["team_a"] = m.group(1).upper()
        out["team_b"] = m.group(2).upper()
        out["video_type"] = "highlights"
    m2 = LIVE_GAME_RE.search(title)
    if m2:
        out["team_a"] = m2.group(1).upper()
        out["team_b"] = m2.group(2).upper()
        out["game_n"] = int(m2.group(3))
        out["video_type"] = "live_game"
    if not out:
        return None
    m3 = WEEK_DAY_RE.search(title)
    if m3:
        out["week"] = int(m3.group(1))
        out["day"] = int(m3.group(2))
    return out


async def find_match_candidates(
    db,
    parsed: dict,
    published_at: datetime | None,
) -> list[dict]:
    """Look up `matches` table for KC matches matching the parsed
    title's teams + a sensible date window around `published_at`.

    For HIGHLIGHTS videos posted within ~7d of the match, scheduled_at
    must be within [published-7d, published+1d].
    For LIVE/GAME videos posted within ~24h, scheduled_at must be
    within [published-2d, published+12h].

    KC must be one of the two teams (we're filtering KC-only).
    """
    teams = {parsed["team_a"], parsed["team_b"]}
    if "KC" not in teams and "KCB" not in teams:
        return []  # not a KC video, can't match
    opp = next(iter(teams - {"KC", "KCB"}), None)
    if not opp:
        return []  # both teams are KC? impossible

    # Compute date window
    if published_at is None:
        # No publish date → search a wide window (past 30d)
        window_start = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        window_end = datetime.now(timezone.utc).isoformat()
    else:
        is_live = parsed.get("video_type") == "live_game"
        if is_live:
            window_start = (published_at - timedelta(days=2)).isoformat()
            window_end = (published_at + timedelta(hours=12)).isoformat()
        else:
            window_start = (published_at - timedelta(days=7)).isoformat()
            window_end = (published_at + timedelta(days=1)).isoformat()

    # Query matches table — join with teams to filter by opponent code
    # PostgREST: nested resource expand
    r = httpx.get(
        f"{db.base}/matches",
        headers=db.headers,
        params={
            "select": (
                "id,external_id,scheduled_at,"
                "team_blue:teams!matches_team_blue_id_fkey(code),"
                "team_red:teams!matches_team_red_id_fkey(code)"
            ),
            "scheduled_at": [
                f"gte.{window_start}",
                f"lte.{window_end}",
            ],
            "limit": 50,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("reconciler_match_query_failed", status=r.status_code)
        return []
    candidates = r.json() or []

    # Client-side filter for the opponent code (Postgres OR on join
    # would need an RPC — easier to filter here on the small candidate set)
    matched = []
    for m in candidates:
        codes = {
            (m.get("team_blue") or {}).get("code"),
            (m.get("team_red") or {}).get("code"),
        }
        codes.discard(None)
        if "KC" not in codes and "KCB" not in codes:
            continue
        if opp not in codes:
            continue
        matched.append(m)
    return matched


async def reconcile_one(db, video: dict) -> str:
    """Reconcile a single channel_video row. Returns the new status."""
    parsed = parse_title_for_match(video.get("title") or "")
    if not parsed:
        return "manual_review"  # unparseable

    published_at = None
    if video.get("published_at"):
        try:
            published_at = datetime.fromisoformat(
                video["published_at"].replace("Z", "+00:00"),
            )
        except (ValueError, AttributeError):
            published_at = None

    candidates = await find_match_candidates(db, parsed, published_at)

    if len(candidates) == 0:
        log.info(
            "reconcile_no_match",
            video_id=video["id"],
            title=(video.get("title") or "")[:60],
        )
        # Update with match info anyway for future retry
        safe_update(
            "channel_videos",
            {
                "status": "manual_review",
                "notes": f"No match found for teams {parsed.get('team_a')}/{parsed.get('team_b')}",
            },
            "id",
            video["id"],
        )
        return "manual_review"

    if len(candidates) > 1:
        log.info(
            "reconcile_ambiguous",
            video_id=video["id"],
            count=len(candidates),
            title=(video.get("title") or "")[:60],
        )
        safe_update(
            "channel_videos",
            {
                "status": "manual_review",
                "notes": f"Ambiguous: {len(candidates)} candidates",
            },
            "id",
            video["id"],
        )
        return "manual_review"

    # Exactly 1 candidate → matched
    cand = candidates[0]
    safe_update(
        "channel_videos",
        {
            "status": "matched",
            "matched_match_external_id": cand["external_id"],
            "matched_game_number": parsed.get("game_n"),  # NULL for highlights compilations
            "matched_at": datetime.now(timezone.utc).isoformat(),
        },
        "id",
        video["id"],
    )
    log.info(
        "reconcile_matched",
        video_id=video["id"],
        match_ext_id=cand["external_id"],
        game_n=parsed.get("game_n"),
    )
    return "matched"


# ─── Daemon loop ──────────────────────────────────────────────────────

async def run() -> int:
    """Reconcile all channel_videos rows in status='classified'."""
    log.info("channel_reconciler_start")

    db = get_db()
    if not db:
        return 0

    r = httpx.get(
        f"{db.base}/channel_videos",
        headers=db.headers,
        params={
            "select": "id,channel_id,title,published_at",
            "status": "eq.classified",
            "limit": 50,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("reconciler_fetch_failed", status=r.status_code)
        return 0

    rows = r.json() or []
    if not rows:
        log.info("channel_reconciler_no_pending")
        return 0

    matched_count = 0
    for row in rows:
        try:
            new_status = await reconcile_one(db, row)
            if new_status == "matched":
                matched_count += 1
        except Exception as e:
            log.error(
                "reconcile_error",
                video_id=row.get("id"),
                error=str(e)[:200],
            )

    log.info(
        "channel_reconciler_done",
        processed=len(rows),
        matched=matched_count,
    )
    return matched_count
