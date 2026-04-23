"""
MATCH_PLANNER — Pre-schedules sentinel/harvester boost runs around
upcoming KC matches.

Reads the LEC schedule (3 weeks ahead), filters KC matches, and
records them in `scheduled_matches`. The daemon's sentinel + harvester
read this table to decide whether the current period is "calm" (idle
defaults: 5min / 10min) or "live" (boost: 30s / 60s).

Why this matters:
  - Default sentinel interval = 5min. If a KC game starts at 18:00:30
    and our last sentinel ran at 18:00:00, we miss the first 5 min of
    kills until 18:05:00. With pre-scheduling we know to ramp up at
    17:55:00, scanning every 30s for the first kill_inserted.
  - Same logic for harvester (livestats feed): the 10s frame cadence
    means we want to fetch every 30-60s during a live game, vs 10min
    when nothing's happening.

Design choice: pre-schedule via `worker_jobs` queue (migration 009)
rather than monkey-patching the daemon intervals. Each worker_jobs row
is a one-shot trigger ("at 17:55:00 run sentinel + harvester for
match_id X"). The job_runner picks them up at 30s cadence, fires the
module call directly, marks the job done.

Daemon interval: 1h. The schedule doesn't move minute by minute —
hourly refresh catches any postpone / reschedule comfortably.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

import httpx
import structlog

from services import lolesports_api
from services.supabase_client import get_db, safe_upsert

log = structlog.get_logger()


# How far ahead to plan. The user wants visibility on the next 3 weeks
# so 21 days is the natural window.
LOOKAHEAD_DAYS = 21

# How early to fire the boost run BEFORE scheduled match start.
# 5 minutes is enough buffer for the LEC analyst desk + draft phase
# without firing too early when nothing's happening yet.
BOOST_LEAD_MINUTES = 5


async def run() -> int:
    """Refresh the next 21 days of KC matches + queue boost jobs.

    Returns the number of new scheduled_matches rows inserted (0 if
    everything was already known)."""
    log.info("match_planner_start")

    db = get_db()
    if not db:
        log.warn("match_planner_no_db")
        return 0

    # Pull 21 days from the LolEsports schedule. The API paginates by
    # ~10 events at a time — we walk forward via the `next` page token
    # until we exhaust the window.
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=LOOKAHEAD_DAYS)

    upcoming: list[dict] = []
    next_token = None
    page_count = 0
    max_pages = 10  # safety cap — schedule API rarely > 50 events for 21d
    while page_count < max_pages:
        events, next_token = await lolesports_api.get_schedule(page_token=next_token)
        page_count += 1
        if not events:
            break
        for event in events:
            if event.get("type") != "match":
                continue
            start_iso = event.get("startTime")
            if not start_iso:
                continue
            try:
                start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
            except ValueError:
                continue
            # Skip past matches — they'll be picked by sentinel instead
            if start_dt < now:
                continue
            # Stop once we cross the horizon (schedule is chronological)
            if start_dt > horizon:
                next_token = None  # stop walking
                break
            match = event.get("match") or {}
            teams = match.get("teams") or []
            if len(teams) < 2:
                continue
            if not any(lolesports_api.is_kc(t) for t in teams):
                continue
            opp = next((t for t in teams if not lolesports_api.is_kc(t)), None)
            upcoming.append(
                {
                    "external_id": match.get("id", ""),
                    "scheduled_at": start_dt.isoformat(),
                    "state": event.get("state", "unstarted"),
                    "opponent_code": (opp or {}).get("code"),
                    "opponent_name": (opp or {}).get("name"),
                    "league": (event.get("league") or {}).get("name", "LEC"),
                    "block_name": event.get("blockName"),
                    "best_of": (match.get("strategy") or {}).get("count", 1),
                }
            )
        if not next_token:
            break

    if not upcoming:
        log.info("match_planner_no_upcoming")
        return 0

    # Upsert each row into scheduled_matches.
    inserted = 0
    for m in upcoming:
        result = safe_upsert(
            "scheduled_matches",
            m,
            on_conflict="external_id",
        )
        if result is not None:
            inserted += 1

    # Queue boost jobs for matches that fire within the next 24h.
    # job_runner will pick these up at 30s cadence and execute right
    # at the boost-lead-minutes mark.
    next_24h_window = now + timedelta(hours=24)
    boost_count = 0
    for m in upcoming:
        try:
            start_dt = datetime.fromisoformat(m["scheduled_at"])
        except ValueError:
            continue
        if start_dt > next_24h_window:
            continue
        boost_at = start_dt - timedelta(minutes=BOOST_LEAD_MINUTES)
        if boost_at <= now:
            # Already past the boost moment — fire immediately by
            # leaving scheduled_for=now (job_runner picks it up).
            boost_at = now + timedelta(seconds=10)
        # Idempotent enqueue — worker_jobs row keyed on (kind, payload.match_id)
        job = safe_upsert(
            "worker_jobs",
            {
                "kind": "sentinel.boost",
                "payload": {
                    "match_external_id": m["external_id"],
                    "until_seconds": 7200,  # boost for 2h max
                },
                "scheduled_for": boost_at.isoformat(),
                "status": "pending",
            },
            on_conflict="kind,scheduled_for",
        )
        if job is not None:
            boost_count += 1

    log.info(
        "match_planner_done",
        upcoming=len(upcoming),
        inserted=inserted,
        boost_jobs_queued=boost_count,
    )
    # Pretty log the next 5 KC matches for human visibility.
    if upcoming:
        log.info(
            "next_kc_matches",
            matches=[
                f"{m['scheduled_at'][:16]} vs {m.get('opponent_code') or '?'} ({m.get('league')})"
                for m in sorted(upcoming, key=lambda x: x["scheduled_at"])[:5]
            ],
        )
    return inserted
