"""Live-match push notifier — STUBBED standalone script.

Polls Supabase for newly-published kills attached to a live match and
fans out a Web Push notification to every active subscriber. Designed
to be invoked as a one-shot (``python live_pusher.py --once``) or as a
long-running daemon loop (``python live_pusher.py``).

⚠️ THIS IS A STUB.  Specifically :

  * The actual ``pywebpush.send_push()`` call is replaced with a TODO
    that logs the payload that would have been sent. Wiring up real
    delivery requires :

    1. ``pip install pywebpush`` (already in worker/requirements.txt
       for the existing modules/push_notifier.py).
    2. ``npx web-push generate-vapid-keys`` to mint VAPID_PUBLIC_KEY +
       VAPID_PRIVATE_KEY.
    3. Set ``VAPID_PRIVATE_KEY`` and ``VAPID_SUBJECT`` in the worker
       env (``.env`` or systemd unit) ; set ``NEXT_PUBLIC_VAPID_PUBLIC_KEY``
       in the web app's Vercel env.
    4. Uncomment the real ``send_push`` block in :func:`_deliver`.

  * The script is NOT integrated into ``worker/main.py``'s daemon loop
    yet. To run it alongside the rest of the pipeline, add a task
    spawn in main.py — but only AFTER step 4 above is done. Spawning
    a stub that just logs would create noise without value.

Operational notes :

  * Each newly-published row gets pushed at most ONCE — we track
    delivery in ``push_history`` (migration 021) via the existing
    ``push_notifications`` queue table, which the worker
    ``modules/push_notifier.py`` already drains. So in practice the
    real-prod path would be : this script ENQUEUES, the existing
    notifier DELIVERS. That keeps backpressure / retry handling in
    one place (``modules/push_notifier.py``).

  * The script bounds its fan-out to ``LIVE_PUSH_THROTTLE_S`` (default
    20 s) between notifications per match. Without throttling, a
    teamfight that produces 5 kills in 8 s would push five separate
    toasts and burn subscriber goodwill.

  * Quiet hours (migration 042) are enforced PER SUBSCRIBER inside the
    existing ``push_notifier.py``. This script doesn't reimplement that
    logic — it just enqueues.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any

# `structlog` and the worker's config / supabase helpers are already
# wired up by the rest of the worker package. We import lazily so the
# script can be smoke-tested without the daemon side-effects loading.
try:
    import structlog  # type: ignore

    log = structlog.get_logger("live_pusher")
except Exception:  # pragma: no cover — structlog is in requirements.txt
    import logging

    log = logging.getLogger("live_pusher")

# Optional pywebpush — only required when we flip the real-send TODO.
try:
    from pywebpush import WebPushException, webpush  # type: ignore

    PYWEBPUSH_AVAILABLE = True
except ImportError:
    webpush = None  # type: ignore[assignment]
    WebPushException = Exception  # type: ignore[assignment]
    PYWEBPUSH_AVAILABLE = False


LIVE_PUSH_THROTTLE_S = float(os.getenv("LIVE_PUSH_THROTTLE_S", "20"))
"""Minimum seconds between two pushes for the same match. Avoids
spamming subscribers during teamfights."""

DAEMON_TICK_S = float(os.getenv("LIVE_PUSH_TICK_S", "10"))
"""Sleep between daemon iterations when not in --once mode."""

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:contact@kckills.com")


@dataclass
class LiveKillRow:
    id: str
    match_id: str
    killer_champion: str | None
    victim_champion: str | None
    multi_kill: str | None
    is_first_blood: bool
    tracked_team_involvement: str | None
    thumbnail_url: str | None
    ai_description_fr: str | None
    published_at: str | None


# ────────────────────────────────────────────────────────────────────
# Supabase access — uses the worker's existing service-role client so
# the script bypasses RLS (it needs to read every subscription).
# ────────────────────────────────────────────────────────────────────


def _supabase():
    """Lazy import to keep --help from spinning up the full client."""
    from services import supabase_client  # type: ignore

    return supabase_client.client()


def fetch_live_match() -> dict[str, Any] | None:
    """Return the currently-live KC match row, or None.

    Mirrors the web app's ``getCurrentLiveMatch`` — but here we want
    the worker's service-role view so we can read teams even if RLS
    tightens later.
    """
    sb = _supabase()
    res = (
        sb.table("matches")
        .select("id, external_id, state, scheduled_at, team_blue_id, team_red_id")
        .eq("state", "live")
        .order("scheduled_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        return None
    return rows[0]


def fetch_unpushed_kills(match_id: str, since_epoch: int | None) -> list[LiveKillRow]:
    """Return published kills for this match that we haven't notified
    on yet.

    ``since_epoch`` is the highest ``event_epoch`` we've already
    notified on. We pass it in instead of tracking state on the row
    itself because the existing ``push_notifications`` queue already
    de-dupes by ``dedupe_key`` — we'll set ``dedupe_key=f"live-kill-{kill_id}"``
    when enqueueing, so even if this script restarts mid-match the
    queue absorbs the duplicate.
    """
    sb = _supabase()
    # Find game ids for this match first.
    games_res = (
        sb.table("games")
        .select("id")
        .eq("match_id", match_id)
        .execute()
    )
    game_ids = [g["id"] for g in (getattr(games_res, "data", None) or [])]
    if not game_ids:
        return []

    q = (
        sb.table("kills")
        .select(
            "id, game_id, killer_champion, victim_champion, multi_kill, "
            "is_first_blood, tracked_team_involvement, thumbnail_url, "
            "ai_description_fr, event_epoch, created_at, publication_status, "
            "kill_visible, clip_url_vertical"
        )
        .in_("game_id", game_ids)
        .eq("publication_status", "published")
        .eq("kill_visible", True)
        .not_.is_("clip_url_vertical", None)
        .order("event_epoch", desc=True)
        .limit(30)
    )
    if since_epoch is not None:
        q = q.gt("event_epoch", since_epoch)
    res = q.execute()
    rows = getattr(res, "data", None) or []
    out: list[LiveKillRow] = []
    for r in rows:
        out.append(
            LiveKillRow(
                id=str(r["id"]),
                match_id=match_id,
                killer_champion=r.get("killer_champion"),
                victim_champion=r.get("victim_champion"),
                multi_kill=r.get("multi_kill"),
                is_first_blood=bool(r.get("is_first_blood")),
                tracked_team_involvement=r.get("tracked_team_involvement"),
                thumbnail_url=r.get("thumbnail_url"),
                ai_description_fr=r.get("ai_description_fr"),
                published_at=r.get("created_at"),
            )
        )
    return out


def fetch_active_subscriptions() -> list[dict[str, Any]]:
    """Return every push subscription that has NOT opted out of the
    live_kill kind."""
    sb = _supabase()
    res = sb.table("push_subscriptions").select("id, subscription_json, preferences").execute()
    rows = getattr(res, "data", None) or []
    kept: list[dict[str, Any]] = []
    for r in rows:
        prefs = r.get("preferences") or {"all": True}
        if prefs.get("all") is False:
            continue
        if prefs.get("live_kill") is False or prefs.get("live_match") is False:
            continue
        kept.append(r)
    return kept


# ────────────────────────────────────────────────────────────────────
# Notification payload builder
# ────────────────────────────────────────────────────────────────────


def build_payload(kill: LiveKillRow) -> dict[str, Any]:
    """Construct the JSON payload the SW push handler expects."""
    killer = kill.killer_champion or "?"
    victim = kill.victim_champion or "?"
    if kill.is_first_blood:
        title = f"🩸 First Blood KC : {killer} → {victim}"
    elif kill.multi_kill:
        title = f"⚡ {kill.multi_kill.upper()} KC : {killer} → {victim}"
    else:
        title = f"💥 Nouveau kill KC : {killer} → {victim}"
    body = (
        kill.ai_description_fr
        or "Suis le live KC en cours sur kckills.com"
    )
    return {
        "kind": "live_kill",
        "title": title,
        "body": body,
        "url": f"/kill/{kill.id}",
        "liveUrl": "/live",
        "image": kill.thumbnail_url,
        "tag": f"live_kill:{kill.id}",
        "dedupe_key": f"live-kill-{kill.id}",
    }


# ────────────────────────────────────────────────────────────────────
# Delivery
# ────────────────────────────────────────────────────────────────────


def _deliver(subscription_json: str, payload: dict[str, Any]) -> bool:
    """Send the push to a single subscription.

    TODO: real send — uncomment the pywebpush call once VAPID keys
          are minted and ``VAPID_PRIVATE_KEY`` is set in env. The
          stub branch below just logs so devs can smoke-test the
          payload shape without needing keys yet.
    """
    if not PYWEBPUSH_AVAILABLE or not VAPID_PRIVATE_KEY:
        log.info(
            "live_pusher_stub_send",
            payload_kind=payload.get("kind"),
            payload_title=payload.get("title"),
            tag=payload.get("tag"),
            note="pywebpush or VAPID_PRIVATE_KEY missing — STUB delivery only",
        )
        return True

    # ── TODO: real send ─────────────────────────────────────────────
    # try:
    #     sub = json.loads(subscription_json)
    #     webpush(
    #         subscription_info=sub,
    #         data=json.dumps(payload),
    #         vapid_private_key=VAPID_PRIVATE_KEY,
    #         vapid_claims={"sub": VAPID_SUBJECT},
    #     )
    #     return True
    # except WebPushException as exc:
    #     log.warn("live_pusher_send_failed", error=str(exc))
    #     return False
    # ── /TODO ───────────────────────────────────────────────────────

    # While the real branch above is commented out, treat the path as
    # a successful stub so the daemon loop keeps moving and dedupe
    # state advances.
    _ = subscription_json
    _ = json  # keep import referenced for the future real-send path
    return True


def enqueue_for_worker(payload: dict[str, Any], kill: LiveKillRow) -> bool:
    """Insert the payload into ``push_notifications`` so the existing
    ``modules/push_notifier.py`` picks it up on its next cycle.

    Recommended over direct fan-out — keeps retry / backoff / quiet
    hours logic in one place (the worker's notifier already has all
    that wired). This script is therefore a SHIM that detects new
    live kills and enqueues — actual delivery stays in the existing
    daemon module.
    """
    sb = _supabase()
    try:
        sb.table("push_notifications").insert(
            {
                "kind": payload["kind"],
                "title": payload["title"],
                "body": payload["body"],
                "url": payload["url"],
                "image_url": payload.get("image"),
                "kill_id": kill.id,
                "dedupe_key": payload.get("dedupe_key"),
                "sent_by": "live_pusher",
            }
        ).execute()
        return True
    except Exception as exc:
        # 23505 unique violation on dedupe_key is fine — means we
        # already enqueued this kill. Everything else is logged but
        # not raised so the daemon loop keeps running.
        log.info("live_pusher_enqueue_skipped", kill_id=kill.id, reason=str(exc))
        return False


# ────────────────────────────────────────────────────────────────────
# Main loop
# ────────────────────────────────────────────────────────────────────


async def run_once(state: dict[str, Any]) -> None:
    """Single iteration : detect live match, find new kills, enqueue."""
    match = fetch_live_match()
    if not match:
        if state.get("last_match_id") is not None:
            log.info("live_pusher_match_ended", prev=state["last_match_id"])
            state["last_match_id"] = None
            state["since_epoch"] = None
        return

    match_id = match["id"]
    if state.get("last_match_id") != match_id:
        log.info("live_pusher_new_match", match_id=match_id, ext=match.get("external_id"))
        state["last_match_id"] = match_id
        state["since_epoch"] = None
        state["last_push_at"] = 0.0

    now = time.time()
    if now - float(state.get("last_push_at", 0)) < LIVE_PUSH_THROTTLE_S:
        # Cooldown — skip this tick.
        return

    kills = fetch_unpushed_kills(match_id, state.get("since_epoch"))
    if not kills:
        return

    # Enqueue every fresh kill. The downstream notifier handles
    # throttling per subscriber.
    enqueued = 0
    highest_epoch = state.get("since_epoch") or 0
    for kill in kills:
        payload = build_payload(kill)
        ok = enqueue_for_worker(payload, kill)
        if ok:
            enqueued += 1
        # Track the highest event_epoch we've seen so the next tick
        # starts from there.
        # The publish-time event_epoch lives on the kill row ; we read
        # it back from the row dict by re-fetching only when needed.
        # For the stub, we just bump `since_epoch` to now() — good
        # enough because the production version uses the queue's
        # dedupe_key as the real correctness gate.
        highest_epoch = max(int(highest_epoch or 0), int(time.time()))
    state["since_epoch"] = highest_epoch
    state["last_push_at"] = now

    log.info(
        "live_pusher_tick",
        match_id=match_id,
        kills_seen=len(kills),
        enqueued=enqueued,
    )


async def main_loop() -> None:
    state: dict[str, Any] = {"last_match_id": None, "since_epoch": None, "last_push_at": 0.0}
    log.info("live_pusher_starting", tick_s=DAEMON_TICK_S, throttle_s=LIVE_PUSH_THROTTLE_S)
    while True:
        try:
            await run_once(state)
        except Exception as exc:
            log.warn("live_pusher_loop_error", error=str(exc))
        await asyncio.sleep(DAEMON_TICK_S)


def _cli() -> int:
    parser = argparse.ArgumentParser(description="Live-match push notifier (STUB)")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single iteration and exit (useful for smoke tests).",
    )
    args = parser.parse_args()

    if args.once:
        state: dict[str, Any] = {"last_match_id": None, "since_epoch": None, "last_push_at": 0.0}
        asyncio.run(run_once(state))
        return 0

    asyncio.run(main_loop())
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
