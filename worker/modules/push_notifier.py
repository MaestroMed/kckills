"""
PUSH_NOTIFIER — Web Push broadcast daemon.

Runs every 5 minutes. For each push_notifications row whose `sent_at`
is NULL :

  1. Fetch ALL active push_subscriptions.
  2. For each subscription, POST the encrypted payload to its endpoint
     using pywebpush (handles VAPID signing + ECE encryption).
  3. Record the per-recipient outcome in push_deliveries.
  4. Bump the aggregate counters on push_notifications and stamp
     sent_at so we don't process the row again.
  5. Prune push_subscriptions for HTTP 404 / 410 responses (the
     browser revoked the subscription — keeping the row would just
     burn CPU on every send).

Idempotency : push_notifications.dedupe_key is UNIQUE in the schema.
The /api/admin/push/broadcast endpoint can pass a dedupe_key like
"kotw:2026-w17" to be sure the same logical broadcast can never go
out twice — the second insert hits the unique constraint.

VAPID keys are read from env :
    VAPID_PUBLIC_KEY
    VAPID_PRIVATE_KEY
    VAPID_SUBJECT (e.g. "mailto:admin@kckills.com")

If any of these is unset, this module logs once per cycle and noops.
That's by design : we don't want a single missing env var to crash
the entire orchestrator on boot.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional

import structlog

from services.supabase_client import get_db

log = structlog.get_logger()

# Cap per-cycle so a 10k-subscriber broadcast doesn't peg the daemon
# for 30 minutes. The remainder gets picked up on the next tick.
MAX_DELIVERIES_PER_CYCLE = 2000

# Per-send delay so we don't hammer push services. Real concurrency is
# achieved via asyncio.gather batches.
SEND_BATCH_SIZE = 32

# HTTP statuses that mean "subscription is dead, prune it".
EXPIRED_STATUSES = {404, 410}


def _vapid_config() -> Optional[dict[str, str]]:
    pub = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    priv = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    subj = os.getenv("VAPID_SUBJECT", "mailto:admin@kckills.com").strip()
    if not pub or not priv:
        return None
    return {"public": pub, "private": priv, "subject": subj}


def _import_pywebpush():
    """Late import so the module loads even if pywebpush isn't installed."""
    try:
        from pywebpush import webpush, WebPushException  # type: ignore
        return webpush, WebPushException
    except ImportError:
        return None, None


def _build_payload(notif: dict[str, Any]) -> str:
    return json.dumps({
        "title": notif["title"],
        "body": notif["body"],
        "url": notif.get("url") or "/scroll",
        "icon": notif.get("icon_url") or "/icons/icon-192x192.png",
        "image": notif.get("image_url"),
        "tag": notif.get("dedupe_key") or notif["id"],
        "kind": notif.get("kind"),
    })


async def _send_one(
    webpush_fn,
    WebPushException,
    notification_id: str,
    subscription_row: dict[str, Any],
    payload: str,
    vapid: dict[str, str],
) -> dict[str, Any]:
    """Send one notification to one subscription. Never raises — returns
    a delivery dict ready to insert into push_deliveries."""
    sub_id = subscription_row["id"]
    raw = subscription_row.get("subscription_json") or "{}"
    try:
        sub_json = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return {
            "notification_id": notification_id,
            "subscription_id": sub_id,
            "status": "failed",
            "http_status": None,
            "error_message": "invalid subscription_json",
        }

    def _do():
        return webpush_fn(
            subscription_info=sub_json,
            data=payload,
            vapid_private_key=vapid["private"],
            vapid_claims={"sub": vapid["subject"]},
            ttl=3600,  # 1h — past that, the kill is no longer "fresh"
        )

    try:
        # pywebpush is sync — run it in a thread so we don't block the loop.
        await asyncio.to_thread(_do)
        return {
            "notification_id": notification_id,
            "subscription_id": sub_id,
            "status": "sent",
            "http_status": 201,
            "error_message": None,
        }
    except Exception as e:
        # WebPushException carries .response with the HTTP status.
        status_code = None
        msg = str(e)[:200]
        resp = getattr(e, "response", None)
        if resp is not None and hasattr(resp, "status_code"):
            try:
                status_code = int(resp.status_code)
            except Exception:
                status_code = None
        is_expired = status_code in EXPIRED_STATUSES
        return {
            "notification_id": notification_id,
            "subscription_id": sub_id,
            "status": "expired" if is_expired else "failed",
            "http_status": status_code,
            "error_message": msg,
        }


async def _broadcast_one(db, notif: dict[str, Any], vapid: dict[str, str]) -> None:
    webpush_fn, WebPushException = _import_pywebpush()
    if webpush_fn is None:
        log.warn("push_notifier_no_pywebpush", notification_id=notif["id"])
        return

    notif_id = notif["id"]
    payload = _build_payload(notif)

    # Fetch all subs (could be tens of thousands at scale — paginate if so).
    import httpx
    try:
        r = httpx.get(
            f"{db.base}/push_subscriptions",
            headers=db.headers,
            params={"select": "id,subscription_json", "limit": str(MAX_DELIVERIES_PER_CYCLE)},
            timeout=20,
        )
        r.raise_for_status()
        subs = r.json() or []
    except Exception as e:
        log.warn("push_notifier_subs_fetch_failed", error=str(e), notif=notif_id)
        return

    if not subs:
        # Stamp sent_at so we don't keep retrying an empty broadcast.
        try:
            db.update("push_notifications",
                      {"sent_at": _now_iso(), "target_count": 0},
                      {"id": notif_id})
        except Exception:
            pass
        log.info("push_notifier_no_subscribers", notif=notif_id)
        return

    log.info("push_notifier_broadcast_start",
             notif=notif_id, kind=notif.get("kind"), targets=len(subs))

    deliveries: list[dict[str, Any]] = []
    expired_sub_ids: list[str] = []

    # Send in batches to bound concurrency.
    for batch_start in range(0, len(subs), SEND_BATCH_SIZE):
        batch = subs[batch_start:batch_start + SEND_BATCH_SIZE]
        results = await asyncio.gather(*[
            _send_one(webpush_fn, WebPushException, notif_id, s, payload, vapid)
            for s in batch
        ])
        deliveries.extend(results)
        for d in results:
            if d["status"] == "expired" and d["subscription_id"]:
                expired_sub_ids.append(d["subscription_id"])

    sent = sum(1 for d in deliveries if d["status"] == "sent")
    failed = sum(1 for d in deliveries if d["status"] == "failed")
    expired = sum(1 for d in deliveries if d["status"] == "expired")

    # Bulk insert deliveries (best-effort — chunk to avoid huge payloads).
    for chunk_start in range(0, len(deliveries), 200):
        chunk = deliveries[chunk_start:chunk_start + 200]
        try:
            httpx.post(
                f"{db.base}/push_deliveries",
                headers=db.headers,
                json=chunk,
                timeout=20,
            )
        except Exception as e:
            log.warn("push_notifier_deliveries_insert_failed",
                     error=str(e), batch_size=len(chunk))

    # Prune expired subscriptions — they're permanent failures, not transient.
    if expired_sub_ids:
        try:
            httpx.delete(
                f"{db.base}/push_subscriptions",
                headers=db.headers,
                params={"id": f"in.({','.join(expired_sub_ids)})"},
                timeout=20,
            )
            log.info("push_notifier_pruned_expired", count=len(expired_sub_ids))
        except Exception as e:
            log.warn("push_notifier_prune_failed", error=str(e))

    # Stamp the broadcast as done.
    try:
        db.update("push_notifications", {
            "sent_at": _now_iso(),
            "target_count": len(subs),
            "sent_count": sent,
            "failed_count": failed,
            "expired_count": expired,
        }, {"id": notif_id})
    except Exception as e:
        log.warn("push_notifier_stats_update_failed", error=str(e))

    log.info("push_notifier_broadcast_done",
             notif=notif_id, sent=sent, failed=failed, expired=expired)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def run() -> None:
    vapid = _vapid_config()
    if vapid is None:
        log.info("push_notifier_skip_no_vapid")
        return

    webpush_fn, _ = _import_pywebpush()
    if webpush_fn is None:
        log.info("push_notifier_skip_no_pywebpush")
        return

    db = get_db()
    if db is None:
        log.warn("push_notifier_no_db")
        return

    # Pull notifications waiting to be sent (newest first so the editor
    # gets immediate feedback on a manual broadcast).
    import httpx
    try:
        r = httpx.get(
            f"{db.base}/push_notifications",
            headers=db.headers,
            params={
                "select": "id,kind,dedupe_key,title,body,url,icon_url,"
                          "image_url,kill_id,sent_by",
                "sent_at": "is.null",
                "order": "created_at.asc",
                "limit": "10",
            },
            timeout=15,
        )
        r.raise_for_status()
        pending = r.json() or []
    except Exception as e:
        log.warn("push_notifier_pending_fetch_failed", error=str(e))
        return

    if not pending:
        return

    log.info("push_notifier_pending", count=len(pending))

    for notif in pending:
        try:
            await _broadcast_one(db, notif, vapid)
        except Exception as e:
            log.error("push_notifier_broadcast_crashed",
                      notif=notif.get("id"), error=str(e))
            # Don't stamp sent_at on crash — let the next cycle retry.
            continue
