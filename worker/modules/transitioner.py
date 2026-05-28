"""
TRANSITIONER — Bridges status='raw' kills to the queue.

Pre-queue model : flipped raw → vod_found so the legacy clipper scan
would pick them up. Post-queue model (PR with migration 024) : ALSO
enqueues a `clip.create` job into pipeline_jobs so the new clipper
claim path gets work even before the legacy scan runs again.

The `kills.status` flip is preserved because :
  * /admin/clips and a few backfill scripts still filter on it
  * legacy fallback path inside clipper.run() still scans for it
    when the queue is empty

Runs every 5 min in the daemon. Cheap query — small kill set per pass.

Team-agnostic note (PR-loltok BA, Apr 2026)
───────────────────────────────────────────
This module is already team-agnostic at the SQL level — it operates on
`kills.status='raw'` regardless of which team the kill belongs to. The
team filter is applied upstream by the harvester/sentinel via
services.team_config.is_tracked. We import the module here as a
compile-time signal that this code path is part of the LoLTok foundation
(downstream filtering decisions should also flow through team_config).
"""
from __future__ import annotations

import asyncio

import structlog

from services import job_queue, team_config  # noqa: F401 — imported for team-aware ecosystem
from services.observability import run_logged
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


@run_logged()
async def run() -> int:
    """Discovery phase :
      1. Scan kills.status='raw' WHERE games.vod_youtube_id IS NOT NULL
      2. For each : enqueue a `clip.create` job (entity_type='kill')
      3. Flip kills.status='vod_found' for back-compat with the legacy
         clipper scan + admin views.
    """
    # Team-aware observability — log how many teams this worker tracks so
    # operators can spot the difference between pilot mode (1 team = KC)
    # and LoLTok mode (50+ teams) at a glance.
    tracked = team_config.load_tracked_teams()
    log.info(
        "transitioner_start",
        tracked_teams=len(tracked),
        primary_team=tracked[0].slug if tracked else None,
    )

    # Wave 35 #6 — bug critique : raw_kills was unbounded, hitting the
    # PostgREST default 1000-row silent cap. With 7K kills stuck in `raw`,
    # the visible 1000-row window was dominated by kills attached to
    # VOD-less games (filtered out below at line 76) so they'd keep
    # cycling without ever flipping → backlog effectively invisible.
    # Investigation : daemon-wave35.log showed `raw_remaining=1000`
    # repeating exactly, confirming the cap.
    #
    # Fix : explicit _limit=500 per cycle + _order=event_epoch.desc to
    # process RECENT kills first (user-requested priority — newly-played
    # KC matches land on /scroll ASAP). Old backlog still drains via
    # subsequent cycles.
    raw_kills = safe_select(
        "kills",
        "id, game_id, event_epoch",
        status="raw",
        _order="event_epoch.desc.nullslast",
        _limit=500,
    ) or []
    if not raw_kills:
        log.info("transitioner_no_raw")
        return 0

    # Games with a VOD ready. Wave 35 #6 — bump limit explicitly above
    # the games table size (~534 today, ~2-3K at end-of-pilot) so the
    # 1000-row cap doesn't silently truncate the dict and cause some
    # VOD-ready raws to look orphaned. safe_select wraps filters as
    # `eq.X` so we can't push `not.is.null` server-side from here ;
    # client-side dict filter below stays the source of truth.
    games = safe_select(
        "games",
        "id, vod_youtube_id, vod_offset_seconds",
        _limit=5000,
    ) or []
    games_with_vod = {
        g["id"]: g for g in games if g.get("vod_youtube_id")
    }

    # ─── Wave 35 #12 — BACKPRESSURE GATE ───────────────────────────────
    # THE fix for the runaway. Before flooding the queue with clip.create
    # jobs, check how many are already pending. If the clipper can't keep
    # up (queue at/over MAX_PENDING_PER_TYPE), SKIP this cycle entirely —
    # leave the kills as 'raw', they'll transition once the queue drains.
    # Without this, the transitioner enqueued 500/cycle regardless of
    # clipper throughput → pipeline_jobs ballooned to 20K+ → claim RPC
    # statement-timeout → DB DoS. Bounded producer = bounded queue.
    if job_queue.should_throttle_enqueue("clip.create"):
        log.info("transitioner_backpressure_skip", raw_available=len(raw_kills))
        return 0

    transitioned = 0
    enqueued = 0

    for kill in raw_kills:
        gid = kill.get("game_id")
        if gid not in games_with_vod:
            continue

        # Flip status (back-compat). safe_update is idempotent.
        safe_update("kills", {"status": "vod_found"}, "id", kill["id"])
        transitioned += 1

        # Enqueue clip.create. The unique index on (type, entity_type,
        # entity_id) WHERE active makes this a no-op if the kill was
        # already enqueued by another module (e.g. the legacy fallback
        # path inside clipper.run, or job_dispatcher).
        jid = await asyncio.to_thread(
            job_queue.enqueue,
            "clip.create", "kill", kill["id"],
            None, 50, None, 3,
        )
        if jid:
            enqueued += 1

    log.info(
        "transitioner_done",
        transitioned=transitioned,
        enqueued=enqueued,
        raw_remaining=len(raw_kills) - transitioned,
    )
    return transitioned
