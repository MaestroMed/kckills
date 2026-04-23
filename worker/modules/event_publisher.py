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
  * publishable & not yet flipped to status='published'  -> publish
  * not publishable any more & status='published'        -> retract

Idempotency : every operation is keyed off is_publishable + status, so
re-runs are no-ops once consistent.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from services.supabase_client import get_db, safe_update

log = structlog.get_logger()


# Cap how many events we touch per cycle. Keeps egress predictable and
# bounds the worst case if a bug elsewhere mass-flips is_publishable.
PUBLISH_BATCH = 100
RETRACT_BATCH = 50


async def _fetch_publishable(db) -> list[dict]:
    """Get events that should now appear on the site but haven't been
    flipped to status='published' yet.

    is_publishable=TRUE means all hard gates green + no permissive gate
    explicitly FALSE (see migration 014). published_at IS NULL means the
    BEFORE UPDATE trigger hasn't fired yet — i.e., no module has bumped
    any column on this row since it became publishable.

    We additionally filter on kill_id IS NOT NULL to avoid trying to
    publish moment-only events (no kills row to flip yet).
    """
    try:
        r = httpx.get(
            f"{db.base}/game_events",
            headers=db.headers,
            params={
                "select": "id,kill_id,event_type,kc_involvement",
                "is_publishable": "eq.true",
                "published_at": "is.null",
                "kill_id": "not.is.null",
                "limit": PUBLISH_BATCH,
            },
            timeout=15.0,
        )
        if r.status_code != 200:
            log.warn(
                "event_publisher_publishable_query_failed",
                status=r.status_code,
                body=r.text[:200],
            )
            return []
        return r.json() or []
    except Exception as e:
        log.warn("event_publisher_publishable_query_threw", error=str(e)[:120])
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
        r = httpx.get(
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


# ─── Daemon entry point ──────────────────────────────────────────────

async def run() -> int:
    """Publish newly-publishable events + retract those that became
    unpublishable. Returns the number of state transitions made.
    """
    log.info("event_publisher_start")

    db = get_db()
    if not db:
        return 0

    # PUBLISH PHASE
    publishable = await _fetch_publishable(db)
    published_count = 0
    for ev in publishable:
        kill_id = ev.get("kill_id")
        if not kill_id:
            continue
        try:
            ok_kill = _flip_kill_published(kill_id)
            ok_event = _stamp_event_published(ev["id"])
            if ok_kill and ok_event:
                published_count += 1
                log.info(
                    "event_published",
                    event_id=ev["id"][:8],
                    kill_id=kill_id[:8],
                    type=ev.get("event_type"),
                    kc=ev.get("kc_involvement"),
                )
        except Exception as e:
            log.error(
                "event_publish_error",
                event_id=ev.get("id", "")[:8],
                error=str(e)[:200],
            )

    # RETRACT PHASE
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
        published=published_count,
        retracted=retracted_count,
        publishable_pool=len(publishable),
        retract_pool=len(retractable),
    )
    return published_count + retracted_count
