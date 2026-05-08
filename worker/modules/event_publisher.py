"""
EVENT_PUBLISHER — Bridge canonical game_events.is_publishable -> public site.

Pipeline position
─────────────────
  game_events  ──► (this module)  ──► kills.status='published'  ──► /scroll feed

The user's vision : "On doit vraiment publier rétroactivement du très bon.
Que du bon." The canonical map (game_events) tracks the QC checklist via
the GENERATED column is_publishable. This module reads "rows where
is_publishable=TRUE AND published_at IS NULL", and :
  1. flips kills.status to 'published' (so the existing /scroll RPC and
     legacy admin queries pick it up)
  2. relies on the BEFORE UPDATE trigger on game_events to auto-stamp
     published_at via the helper logic in migration 014's
     fn_touch_game_event() function

Conversely, if is_publishable goes back to FALSE (admin marks
qc_human_approved=FALSE, or clip_qc finds drift > 30s), this module
flips kills.status back to 'analyzed' so the public surface drops the
clip without re-running the entire pipeline. published_at on the event
stays as a permanent record of "this WAS published, then pulled back".

Daemon interval : 300s (5 min). The cycle is :
  * Discovery : enqueue `publish.check` jobs for events that became
    publishable since last run.
  * Process : claim those jobs from the queue. publish.check is a
    fast operation (1 row update) so we run discovery + process in
    the same daemon tick — no need to split.
  * Retract : flip back kills that lost their publishable status. This
    stays direct (not queue-driven) since it's a tiny set per cycle.

Idempotency : every operation is keyed off is_publishable + status, so
re-runs are no-ops once consistent.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

import httpx
import structlog

from services import job_queue, team_config  # noqa: F401 — exposes tracked-team context to publish gates
from services.observability import run_logged
from services.supabase_client import get_db, safe_update

log = structlog.get_logger()


# Cap how many events we touch per cycle. Keeps egress predictable and
# bounds the worst case if a bug elsewhere mass-flips is_publishable.
PUBLISH_BATCH = 100
RETRACT_BATCH = 50


# PR-loltok DH (migration 045) : column was renamed
# game_events.kc_involvement → game_events.tracked_team_involvement.
# We try the new name first and fall back to the legacy name on
# PostgREST 42703 ("column does not exist") so the worker keeps
# publishing even if the operator restarts before applying migration
# 045. Once migration is applied, the fallback path never fires.
_INVOLVEMENT_COL_NEW = "tracked_team_involvement"
_INVOLVEMENT_COL_LEGACY = "kc_involvement"


def _involvement_value(ev: dict) -> str | None:
    """Return the involvement classification regardless of which column
    name is in play (pre/post migration 045)."""
    if _INVOLVEMENT_COL_NEW in ev:
        return ev.get(_INVOLVEMENT_COL_NEW)
    return ev.get(_INVOLVEMENT_COL_LEGACY)


async def _fetch_publishable(db) -> list[dict]:
    """Get events that should now appear on the site but haven't been
    flipped to status='published' yet.

    is_publishable=TRUE means all hard gates green + no permissive gate
    explicitly FALSE (see migration 014). published_at IS NULL means the
    BEFORE UPDATE trigger hasn't fired yet — i.e., no module has bumped
    any column on this row since it became publishable.

    We additionally filter on kill_id IS NOT NULL to avoid trying to
    publish moment-only events (no kills row to flip yet).

    Tries the post-migration-045 column name first, falls back to the
    legacy name on PostgREST 42703 so this code is forward+backward
    compatible across the migration boundary.
    """
    for col in (_INVOLVEMENT_COL_NEW, _INVOLVEMENT_COL_LEGACY):
        try:
            # Wave 27.10 — offloaded so the publish loop doesn't freeze
            # the event loop on every per-cycle scan.
            r = await asyncio.to_thread(
                httpx.get,
                f"{db.base}/game_events",
                headers=db.headers,
                params={
                    "select": f"id,kill_id,event_type,{col}",
                    "is_publishable": "eq.true",
                    "published_at": "is.null",
                    "kill_id": "not.is.null",
                    "limit": PUBLISH_BATCH,
                },
                timeout=15.0,
            )
            if r.status_code == 200:
                return r.json() or []
            # 42703 = undefined_column. Fall through to the legacy name
            # only if we just tried the new one. Otherwise log + bail.
            if col == _INVOLVEMENT_COL_NEW and "42703" in r.text:
                log.info(
                    "event_publisher_publishable_pre_migration_045_fallback",
                    note="game_events.tracked_team_involvement absent, "
                         "falling back to kc_involvement",
                )
                continue
            log.warn(
                "event_publisher_publishable_query_failed",
                status=r.status_code,
                body=r.text[:200],
            )
            return []
        except Exception as e:
            log.warn("event_publisher_publishable_query_threw", error=str(e)[:120])
            return []
    return []


async def _fetch_retractable(db) -> list[dict]:
    """Get events whose is_publishable just went FALSE while their kill
    is still surfaced as status='published'. The ones to pull back.

    Cross-table filter (kills.status='published' AND game_events.is_publishable=FALSE)
    isn't a single PostgREST query — we approximate by fetching events
    where is_publishable=FALSE AND published_at IS NOT NULL (i.e., they
    WERE published before). Callers re-check the kill row's status.
    """
    try:
        # Wave 27.10 — offloaded.
        r = await asyncio.to_thread(
            httpx.get,
            f"{db.base}/game_events",
            headers=db.headers,
            params={
                "select": "id,kill_id,publish_blocked_reason",
                "is_publishable": "eq.false",
                "published_at": "not.is.null",
                "kill_id": "not.is.null",
                "limit": RETRACT_BATCH,
            },
            timeout=15.0,
        )
        if r.status_code != 200:
            log.warn(
                "event_publisher_retract_query_failed",
                status=r.status_code,
                body=r.text[:200],
            )
            return []
        return r.json() or []
    except Exception as e:
        log.warn("event_publisher_retract_query_threw", error=str(e)[:120])
        return []


def _flip_kill_published(kill_id: str) -> bool:
    """Set kills.status='published'. Idempotent — safe_update is a no-op
    if status is already 'published'.
    """
    return bool(safe_update("kills", {"status": "published"}, "id", kill_id))


def _flip_kill_retracted(kill_id: str) -> bool:
    """Pull a kill back from the public surface by setting status='analyzed'.

    'analyzed' is the right rest state because it preserves all the
    AI metadata + clip URLs but won't be picked up by /scroll RPC
    (which filters on status='published').
    """
    return bool(safe_update("kills", {"status": "analyzed"}, "id", kill_id))


def _stamp_event_published(event_id: str) -> bool:
    """Force published_at update on the event in case the trigger
    didn't fire (e.g. legacy rows where published_at was already set).

    The fn_touch_game_event trigger handles the auto-stamp on update,
    but only when one of the qc_* columns changes. A pure publish
    flip won't touch those columns, so we set published_at explicitly.
    """
    return bool(
        safe_update(
            "game_events",
            {"published_at": datetime.now(timezone.utc).isoformat()},
            "id",
            event_id,
        )
    )


# ─── Discovery + queue-driven processing ──────────────────────────────

async def _discover_and_enqueue(db) -> int:
    """Scan game_events for newly-publishable rows and enqueue
    `publish.check` jobs for each one.

    The unique index on (type, entity_type, entity_id) WHERE active makes
    this idempotent — re-discovery on the next tick won't double-enqueue.
    """
    publishable = await _fetch_publishable(db)
    enqueued = 0
    for ev in publishable:
        ev_id = ev.get("id")
        if not ev_id:
            continue
        # entity_type='event' so the unique index distinguishes
        # publish.check on a kill vs on a game_event row.
        jid = await asyncio.to_thread(
            job_queue.enqueue,
            "publish.check", "event", ev_id,
            None, 60, None, 3,  # priority 60 — above default 50 so publish lands quick
        )
        if jid:
            enqueued += 1
    return enqueued


def _process_publish_check(job: dict) -> bool:
    """Execute one publish.check job. Returns True on successful publish."""
    event_id = job.get("entity_id")
    if not event_id:
        return False

    db = get_db()
    if db is None:
        return False

    # Re-fetch the event row — its is_publishable may have flipped
    # back to FALSE between enqueue and process (e.g. clip_qc just
    # caught drift). We don't want to publish a now-failing kill.
    #
    # Same migration-045 fallback dance as _fetch_publishable : try
    # the new column name first, fall through to the legacy name on
    # 42703 (column doesn't exist).
    ev: dict | None = None
    for col in (_INVOLVEMENT_COL_NEW, _INVOLVEMENT_COL_LEGACY):
        try:
            # NOTE : the entire _process_publish_check function runs
            # inside asyncio.to_thread (see caller at line ~340) so
            # this sync httpx.get is already offloaded from the event
            # loop. Don't wrap it in another to_thread or it'd recurse
            # into another thread for nothing.
            r = httpx.get(
                f"{db.base}/game_events",
                headers=db.headers,
                params={
                    "select": f"id,kill_id,event_type,{col},is_publishable,published_at",
                    "id": f"eq.{event_id}",
                    "limit": 1,
                },
                timeout=15.0,
            )
            if r.status_code == 200:
                rows = r.json() or []
                if not rows:
                    return False
                ev = rows[0]
                break
            if col == _INVOLVEMENT_COL_NEW and "42703" in r.text:
                continue
            r.raise_for_status()
        except Exception as e:
            log.warn("publish_check_fetch_failed",
                     event_id=event_id[:8], error=str(e)[:120])
            return False
    if ev is None:
        return False

    # No-op cases — return True so the job marks succeeded.
    if not ev.get("is_publishable"):
        log.info("publish_check_no_longer_publishable",
                 event_id=event_id[:8])
        return True
    if ev.get("published_at"):
        return True

    kill_id = ev.get("kill_id")
    if not kill_id:
        return True

    ok_kill = _flip_kill_published(kill_id)
    ok_event = _stamp_event_published(event_id)
    if ok_kill and ok_event:
        # Migration 045 renamed kc_involvement → tracked_team_involvement
        # to match kills.tracked_team_involvement. _involvement_value()
        # pulls the value regardless of which name is current on this
        # worker (pre/post-restart on the new code).
        involvement = _involvement_value(ev)
        log.info(
            "event_published",
            event_id=event_id[:8],
            kill_id=kill_id[:8],
            type=ev.get("event_type"),
            tracked_team_involvement=involvement,
        )
        return True
    return False


# ─── Daemon entry point ──────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """Publish newly-publishable events + retract those that became
    unpublishable. Queue-driven for the publish path, direct for the
    retract path (small per-cycle batch). Returns the number of state
    transitions made.
    """
    log.info("event_publisher_start")

    db = get_db()
    if not db:
        return 0

    # ─── Discovery + claim + process for publish.check ─────────────
    discovered = await _discover_and_enqueue(db)

    worker_id = f"event_publisher-{os.getpid()}"
    claimed = await asyncio.to_thread(
        job_queue.claim,
        worker_id,
        ["publish.check"],
        PUBLISH_BATCH,
        120,  # 2 min lease — publish.check is fast
    )
    published_count = 0
    for job in claimed:
        try:
            ok = await asyncio.to_thread(_process_publish_check, job)
        except Exception as e:
            log.error(
                "event_publish_error",
                job_id=job.get("id", "")[:8],
                event_id=(job.get("entity_id") or "")[:8],
                error=str(e)[:200],
            )
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                f"publish_check_exception: {type(e).__name__}",
                300, "publish_exception",
            )
            continue
        if ok:
            published_count += 1
            await asyncio.to_thread(
                job_queue.succeed, job["id"], {"event_id": job.get("entity_id")},
            )
        else:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                "publish_check returned false", 300, "publish_failed",
            )

    # ─── Retract phase (direct, not queue-driven) ───────────────────
    retractable = await _fetch_retractable(db)
    retracted_count = 0
    for ev in retractable:
        kill_id = ev.get("kill_id")
        if not kill_id:
            continue
        try:
            if _flip_kill_retracted(kill_id):
                retracted_count += 1
                log.info(
                    "event_retracted",
                    event_id=ev["id"][:8],
                    kill_id=kill_id[:8],
                    reason=(ev.get("publish_blocked_reason") or "auto_qc_fail")[:80],
                )
        except Exception as e:
            log.error(
                "event_retract_error",
                event_id=ev.get("id", "")[:8],
                error=str(e)[:200],
            )

    log.info(
        "event_publisher_done",
        discovered=discovered,
        claimed=len(claimed),
        published=published_count,
        retracted=retracted_count,
        retract_pool=len(retractable),
    )
    return published_count + retracted_count
