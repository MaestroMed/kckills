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
"""
from __future__ import annotations

import asyncio

import structlog

from services import job_queue
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
    log.info("transitioner_start")

    # All raw kills (small set in steady state — only kills not yet
    # transitioned). PostgREST default 1000-row cap is fine here.
    raw_kills = safe_select("kills", "id, game_id", status="raw") or []
    if not raw_kills:
        log.info("transitioner_no_raw")
        return 0

    # Games with a VOD ready. Small table (< few thousand games), fine
    # to fetch and dict-index. We could push the join into a SQL view
    # but the simpler approach scales easily up to mid-five-figure rows.
    games = safe_select("games", "id, vod_youtube_id, vod_offset_seconds") or []
    games_with_vod = {
        g["id"]: g for g in games if g.get("vod_youtube_id")
    }

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
