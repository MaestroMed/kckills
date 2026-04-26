"""
JOB_DISPATCHER — Bridge legacy kills.status → pipeline_jobs queue.

Migration helper module. Scans the existing kills table for rows whose
status indicates "needs work" but for which no active queue job exists,
and enqueues the appropriate next-step job. This guarantees that during
the queue rollout :

  * No kill gets stuck because its status flipped before the queue knew
    about it (e.g. clipper marked status='clipped' but the analyzer
    never claimed because nobody enqueued a clip.analyze job).
  * Backfill scripts that bypass the queue and write status directly
    still get picked up by the new pipeline.
  * If the queue table is wiped or the worker is rebuilt, this module
    re-derives all the in-flight work from the kills.status snapshot.

Mapping :
  kills.status='vod_found'  -> enqueue clip.create
  kills.status='clipped'    -> enqueue clip.analyze
  kills.status='analyzed'   -> enqueue publish.check (via game_events)

Idempotency : enqueue() is a no-op if an active job already exists for
the same (type, entity_type, entity_id) — guaranteed by the unique
partial index in migration 024.

Runs every 60s (cheap : up to 3 indexed status= queries + small
PostgREST count for active jobs).
"""

from __future__ import annotations

import asyncio

import httpx
import structlog

from services import job_queue
from services.observability import run_logged
from services.supabase_client import get_db, safe_select

log = structlog.get_logger()


# Cap how many kills we enqueue per state transition per pass. The
# unique index dedupes anyway, so this is a soft bound to keep the
# httpx round-trips per dispatcher tick small.
DISPATCH_BATCH = 200


def _scan_status(status: str, columns: str = "id") -> list[dict]:
    """Scan kills with a given status. Pushes the limit through PostgREST
    to bypass the default 1000-row cap.
    """
    db = get_db()
    if db is None:
        return []
    try:
        r = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={
                "select": columns,
                "status": f"eq.{status}",
                "order": "updated_at.asc",
                "limit": str(DISPATCH_BATCH),
            },
            timeout=20.0,
        )
        if r.status_code != 200:
            log.warn(
                "job_dispatcher_scan_failed",
                status=status, http=r.status_code,
                body=r.text[:200],
            )
            return []
        return r.json() or []
    except Exception as e:
        log.warn("job_dispatcher_scan_threw",
                 status=status, error=str(e)[:200])
        return []


async def _bridge_kill_status_to_job(
    kill_status: str, job_type: str, priority: int = 50,
) -> tuple[int, int]:
    """For each kill in the given status, enqueue a job of the given type.

    Returns (scanned, enqueued). enqueued < scanned means the unique
    constraint already had jobs for those rows — totally fine, that's
    the dedup working.
    """
    rows = _scan_status(kill_status, "id")
    if not rows:
        return 0, 0
    enqueued = 0
    for r in rows:
        kid = r.get("id")
        if not kid:
            continue
        jid = await asyncio.to_thread(
            job_queue.enqueue,
            job_type, "kill", kid,
            None, priority, None, 3,
        )
        if jid:
            enqueued += 1
    return len(rows), enqueued


async def _bridge_publishable_to_job() -> tuple[int, int]:
    """Bridge from game_events.is_publishable -> publish.check jobs.

    Mirrors the discovery loop inside event_publisher.run() but runs at
    a higher cadence (60s vs 300s) so a freshly-publishable event lands
    in the queue within a minute. event_publisher.run() also discovers,
    but the unique index dedupes so doing it twice is harmless.
    """
    db = get_db()
    if db is None:
        return 0, 0
    try:
        r = httpx.get(
            f"{db.base}/game_events",
            headers=db.headers,
            params={
                "select": "id,kill_id",
                "is_publishable": "eq.true",
                "published_at": "is.null",
                "kill_id": "not.is.null",
                "limit": str(DISPATCH_BATCH),
            },
            timeout=15.0,
        )
        if r.status_code != 200:
            log.warn(
                "job_dispatcher_publishable_scan_failed",
                http=r.status_code, body=r.text[:200],
            )
            return 0, 0
        rows = r.json() or []
    except Exception as e:
        log.warn("job_dispatcher_publishable_scan_threw", error=str(e)[:200])
        return 0, 0

    enqueued = 0
    for ev in rows:
        eid = ev.get("id")
        if not eid:
            continue
        jid = await asyncio.to_thread(
            job_queue.enqueue,
            "publish.check", "event", eid,
            None, 60, None, 3,
        )
        if jid:
            enqueued += 1
    return len(rows), enqueued


# ─── Daemon entry point ────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """Bridge all in-flight legacy state → queue jobs. Returns the total
    number of jobs enqueued this pass (excluding dedup hits).
    """
    log.info("job_dispatcher_start")

    # vod_found -> clip.create
    s1, e1 = await _bridge_kill_status_to_job("vod_found", "clip.create", 50)
    # clipped -> clip.analyze
    s2, e2 = await _bridge_kill_status_to_job("clipped", "clip.analyze", 50)
    # analyzed -> downstream finalisation. Three downstream jobs since
    # the analyzer pre-queue model didn't enqueue them either.
    s3a, e3a = await _bridge_kill_status_to_job("analyzed", "og.generate", 50)
    s3b, e3b = await _bridge_kill_status_to_job("analyzed", "embedding.compute", 50)
    s3c, e3c = await _bridge_kill_status_to_job("analyzed", "event.map", 50)
    # Publishable game_events -> publish.check
    s4, e4 = await _bridge_publishable_to_job()

    total_enqueued = e1 + e2 + e3a + e3b + e3c + e4

    log.info(
        "job_dispatcher_done",
        clip_create_scanned=s1, clip_create_enqueued=e1,
        clip_analyze_scanned=s2, clip_analyze_enqueued=e2,
        og_enqueued=e3a, embedding_enqueued=e3b, event_map_enqueued=e3c,
        publishable_scanned=s4, publish_check_enqueued=e4,
        total_enqueued=total_enqueued,
    )
    return total_enqueued
