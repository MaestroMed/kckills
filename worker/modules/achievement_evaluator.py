"""
ACHIEVEMENT_EVALUATOR — Wave 31a (2026-05-14)

Daemon module that hands out badges. Runs alongside the rest of the
worker on the same supervised-task pattern as analyzer / quote_extractor.

Cycle (default 300s) :
    1. Ask the DB for users active in the last 7 days
       (fn_users_with_recent_activity).
    2. For each user, call fn_evaluate_user_achievements(user_id). The
       SECURITY DEFINER RPC computes the counters bundle once and INSERTs
       newly-earned rows into user_achievements, returning their slugs.
    3. For each newly-earned slug, log `achievement_unlocked` so the
       structured-logging pipeline picks it up.
    4. If push notifications are configured (VAPID env vars present), fan
       out a push notification per unlock — using the existing
       push_notifications + push_subscriptions tables so the same
       worker module (push_notifier.py) does the actual sending. We never
       call pywebpush from here directly ; we just enqueue the row.

The module is idempotent : the UNIQUE (user_id, achievement_slug) index
prevents double-awards, so the worker can over-run without spamming
unlocks.

Tuning :
    Defaults via runtime_tuning :
        parallel = 1           (single user at a time — the RPC is cheap)
        interval = 300         (5 min)
        batch    = 500         (max users per cycle)
    Override per env :
        KCKILLS_INTERVAL_ACHIEVEMENT_EVALUATOR=600
        KCKILLS_BATCH_ACHIEVEMENT_EVALUATOR=200

Cost :
    One RPC per active user. With ~500 active users / cycle the load is
    bounded by Supabase free-tier egress (each call is <2KB of returned
    JSON). At 5-min cadence over 24h that's ~144k calls/day = still well
    inside the free-tier write/read budget.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import structlog

from services.observability import run_logged
from services.runtime_tuning import get_batch_size, get_parallelism
from services.supabase_client import get_db

log = structlog.get_logger()


# ─── Tunables ──────────────────────────────────────────────────────────
BATCH_SIZE = get_batch_size("achievement_evaluator")
PARALLELISM = get_parallelism("achievement_evaluator")

# Look-back window — users who didn't touch anything in this many days
# don't get re-evaluated. Mirrors the "activity = recent activity" rule
# from fn_users_with_recent_activity.
LOOKBACK_DAYS = 7


# ─── Helpers ───────────────────────────────────────────────────────────

def _post_rpc(db, name: str, body: dict[str, Any]) -> Any:
    """POST /rpc/<name>. Returns parsed JSON or None on failure.

    Errors are logged but never raised — a single bad RPC must not crash
    the daemon (the supervised wrapper would restart us, but burning a
    restart on a transient 5xx is wasteful).
    """
    if db is None:
        return None
    try:
        client = db._get_client()
        r = client.post(f"{db.base}/rpc/{name}", json=body)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        log.warn(
            "achievement_rpc_http_error",
            rpc=name,
            status=e.response.status_code,
            body=(e.response.text or "")[:200],
        )
        return None
    except Exception as e:
        log.warn("achievement_rpc_failed", rpc=name, error=str(e)[:200])
        return None


def _list_recent_active_users(db) -> list[dict[str, Any]]:
    """Return [{user_id, last_active_at}, ...] for users active in the
    LOOKBACK_DAYS window. Empty list on RPC failure.
    """
    rows = _post_rpc(
        db,
        "fn_users_with_recent_activity",
        {"p_lookback_days": LOOKBACK_DAYS, "p_limit": BATCH_SIZE},
    )
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        uid = row.get("user_id")
        if not uid:
            continue
        out.append({"user_id": str(uid), "last_active_at": row.get("last_active_at")})
    return out


def _evaluate_one(db, user_id: str) -> list[dict[str, Any]]:
    """Run fn_evaluate_user_achievements for one user. Returns the list
    of newly-earned slugs (may be empty)."""
    rows = _post_rpc(db, "fn_evaluate_user_achievements", {"p_user_id": user_id})
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug = row.get("slug")
        if not slug:
            continue
        out.append({
            "slug":   str(slug),
            "name":   str(row.get("name") or slug),
            "rarity": str(row.get("rarity") or "common"),
            "points": int(row.get("points") or 0),
        })
    return out


# ─── Push notification enqueueing ─────────────────────────────────────
#
# We DO NOT call pywebpush here. Instead we INSERT a row into
# push_notifications scoped to the user via metadata. push_notifier.py
# (the existing daemon) reads that table, queries the matching
# push_subscriptions, and sends the actual notifications.
#
# The dedupe_key is "achievement:<user_id>:<slug>" so a re-run of the
# evaluator can never double-notify even if the user_achievements row
# was re-created (e.g. after a manual deletion).

def _enqueue_push(db, user_id: str, ach: dict[str, Any]) -> None:
    if db is None:
        return
    slug = ach["slug"]
    dedupe = f"achievement:{user_id}:{slug}"

    rarity = ach.get("rarity") or "common"
    rarity_label = {
        "common":    "Badge",
        "rare":      "Badge rare",
        "epic":      "Badge épique",
        "legendary": "Badge légendaire",
    }.get(rarity, "Badge")

    payload = {
        "title": f"{rarity_label} débloqué",
        "body":  f"Tu as obtenu : {ach['name']}",
        "url":   "/achievements",
        "kind":  "achievement_unlocked",
        "dedupe_key": dedupe,
        "metadata": {
            "user_id":          user_id,
            "achievement_slug": slug,
            "rarity":           rarity,
            "points":           ach.get("points", 0),
        },
    }

    try:
        client = db._get_client()
        # Use a plain INSERT — the dedupe_key UNIQUE constraint catches
        # repeats. We swallow 409 specifically because that's the
        # expected "already enqueued" outcome.
        r = client.post(
            f"{db.base}/push_notifications",
            json=payload,
        )
        if r.status_code in (200, 201):
            return
        if r.status_code == 409:
            return
        log.warn(
            "achievement_push_enqueue_http_error",
            status=r.status_code,
            body=(r.text or "")[:200],
            slug=slug,
        )
    except Exception as e:
        log.warn(
            "achievement_push_enqueue_failed",
            slug=slug,
            error=str(e)[:200],
        )


# ─── Per-user pipeline ────────────────────────────────────────────────

async def _process_user(
    db,
    user: dict[str, Any],
    counters: dict[str, int],
    push_enabled: bool,
) -> None:
    user_id = user["user_id"]

    # RPC call is sync (uses the pooled httpx.Client) — run in a thread
    # so we don't block the asyncio event loop. Cheap enough to wrap.
    newly_earned = await asyncio.to_thread(_evaluate_one, db, user_id)

    counters["users_processed"] += 1
    if not newly_earned:
        return

    counters["unlocks_total"] += len(newly_earned)

    for ach in newly_earned:
        log.info(
            "achievement_unlocked",
            user_id=user_id,
            slug=ach["slug"],
            name=ach["name"],
            rarity=ach["rarity"],
            points=ach["points"],
        )
        # Bump per-rarity counter (helps the daily report).
        counters[f"rarity_{ach['rarity']}"] = counters.get(f"rarity_{ach['rarity']}", 0) + 1

        if push_enabled:
            await asyncio.to_thread(_enqueue_push, db, user_id, ach)


# ─── Daemon entrypoint ────────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """One pass : evaluate every active user, return total unlocks emitted."""
    db = get_db()
    if db is None:
        log.warn("achievement_evaluator_no_db")
        return 0

    log.info("achievement_evaluator_scan_start", batch=BATCH_SIZE, lookback_days=LOOKBACK_DAYS)

    users = await asyncio.to_thread(_list_recent_active_users, db)
    if not users:
        log.info("achievement_evaluator_idle")
        return 0

    # Push enablement is a soft check — push_notifier itself will no-op
    # if VAPID isn't configured, but skipping the enqueue saves rows in
    # push_notifications when we know nothing will be sent anyway.
    import os
    push_enabled = bool(
        os.environ.get("VAPID_PUBLIC_KEY") and os.environ.get("VAPID_PRIVATE_KEY")
    )

    counters: dict[str, int] = {
        "users_processed": 0,
        "unlocks_total":   0,
    }

    # PARALLELISM gates concurrent users — defaults to 1 because the RPC
    # is fast (single round trip) and we want predictable load. Bumping
    # via env to e.g. 4 only matters when the active-user count spikes.
    sem = asyncio.Semaphore(max(1, PARALLELISM))

    async def _worker(u: dict[str, Any]) -> None:
        async with sem:
            await _process_user(db, u, counters, push_enabled)

    await asyncio.gather(*[_worker(u) for u in users])

    log.info(
        "achievement_evaluator_scan_done",
        users_processed=counters["users_processed"],
        unlocks_total=counters["unlocks_total"],
        rarity_common=counters.get("rarity_common", 0),
        rarity_rare=counters.get("rarity_rare", 0),
        rarity_epic=counters.get("rarity_epic", 0),
        rarity_legendary=counters.get("rarity_legendary", 0),
        push_enabled=push_enabled,
    )
    return counters["unlocks_total"]


if __name__ == "__main__":
    asyncio.run(run())
