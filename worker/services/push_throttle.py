"""
PUSH_THROTTLE — intelligent rate-limiting + coalescing for web push.

Problem
═══════
The publisher fires one push per published kill. During a back-to-back
KC teamfight, that's 4-6 notifications in 90 seconds and the user mutes
us forever. This module enforces a defence-in-depth policy *before* the
network call to web-push is made.

Policy summary
══════════════
Per subscription, evaluated in order :

  0. Quiet hours      — between subscription.quiet_hours_start_utc and
                        quiet_hours_end_utc (default 23h-7h UTC =
                        00h-08h Paris), drop everything *except*
                        `system` (we still let downtime alerts through).
  1. De-duplication   — if the (subscription_id, dedupe_key) tuple was
                        already delivered, drop. Cheap shortcut for
                        weekly KOTW + first-blood spam.
  2. Per-kind limit   — quotas are intentionally tight for the noisy
                        kinds and absent for the rare exceptional ones.
                        See PER_KIND_QUOTA below.
  3. Global limit     — max 5 pushes per 30-minute rolling window per
                        subscription, independent of kind. The hard
                        ceiling that protects users from being spammed
                        by a kind we forgot to add to PER_KIND_QUOTA.

The publisher coalesces close-in-time kill events with
coalesce_window() *before* calling should_send() so the per-kind
counter sees one notification, not N.

Multi-kills (triple/quadra/penta) are a *different* kind from regular
kills and therefore bypass kind 1 entirely — these are the moments
worth pushing every time, and they're rare enough that the global limit
(rule 3) is the only realistic ceiling.

Backwards compatibility
═══════════════════════
If migration 042 hasn't been applied, the column probes return None
(or PostgREST 400s on the unknown column). Each guard catches the
exception and falls back to defaults — the throttle never raises,
it always returns a permissive answer when in doubt. The push then
goes out via the legacy code path.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

import structlog

log = structlog.get_logger()


# ─────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────

#: Global per-subscription rate limit (rolling window).
GLOBAL_LIMIT_COUNT = 5
GLOBAL_LIMIT_WINDOW_SECONDS = 30 * 60  # 30 min

#: Per-kind quotas. (count, window_seconds). Missing key = no per-kind cap
#: (only the global limit applies — see `kill_multi`).
#:
#: NOTE: `kill_multi` and any other "exceptional moment" kind is
#: deliberately absent from this map — those are rare-and-special, the
#: throttle should NOT muffle a pentakill push because the user already
#: saw 2 normal kills earlier in the game.
PER_KIND_QUOTA: dict[str, tuple[int, int]] = {
    "kill":             (2, 15 * 60),         # max 2 / 15 min
    "kill_of_the_week": (1, 7 * 24 * 60 * 60),  # max 1 / week
    "live_match":       (1, 4 * 60 * 60),     # max 1 / 4h (one per match start)
    "editorial_pin":    (3, 24 * 60 * 60),    # max 3 / day
    # broadcast / system / kill_multi → only global limit
}

#: Kinds that bypass quiet hours. System notifs (downtime / maintenance)
#: must always reach the user — that's literally what they're for.
QUIET_HOURS_BYPASS_KINDS: frozenset[str] = frozenset({"system"})

#: Default quiet hours when the subscription has no explicit setting
#: (NULL columns or migration 042 not yet applied). 23h-7h UTC =
#: 00h-08h Paris.
DEFAULT_QUIET_START_UTC = 23
DEFAULT_QUIET_END_UTC = 7

#: Coalescing window — kills published within this many seconds of
#: each other are batched into a single notification.
COALESCE_WINDOW_SECONDS = 60

#: Minimum number of events to trigger coalescing. 1 or 2 close-in-time
#: kills don't need to be merged — the user expects 2 notifications
#: when there are 2 kills. 3+ in a row means a teamfight and the
#: collapsed view is more useful.
COALESCE_MIN_EVENTS = 3

#: Kill bypass set — kinds that "skip" should_send when overridden by
#: env var. Used by ops for emergency unthrottling. Empty by default.
_BYPASS_ENV = "PUSH_THROTTLE_BYPASS_KINDS"


# ─────────────────────────────────────────────────────────────────────
# DATA TYPES
# ─────────────────────────────────────────────────────────────────────

@dataclass
class ThrottleDecision:
    """Outcome of should_send. False decisions carry a reason for logs."""

    allowed: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.allowed


@dataclass
class PushEvent:
    """A single about-to-be-published event passed to coalesce_window."""

    kill_id: str
    kind: str
    title: str
    body: str
    url: str
    created_at: datetime
    dedupe_key: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class CoalescedEvent:
    """Result of coalesce_window — either a passthrough single event or
    a merged batch. `count` >= 1 ; when > 1 the title/body/url have
    been rewritten to summarise the group."""

    kind: str
    title: str
    body: str
    url: str
    count: int
    dedupe_key: Optional[str]
    representative_kill_id: Optional[str]  # the most-recent kill in the batch
    member_kill_ids: list[str]
    created_at: datetime  # the most-recent timestamp in the batch


# ─────────────────────────────────────────────────────────────────────
# THE THROTTLE
# ─────────────────────────────────────────────────────────────────────

class PushThrottle:
    """Gate-keeper between the publisher and pywebpush.

    Stateless w.r.t. subscriptions — every check pulls the subscription
    metadata + recent delivery counts from Supabase. That keeps the
    throttle correct across worker restarts and across multiple worker
    processes (multi-region deployment, future).

    For tests, pass a `db_client` with the same shape as
    services.supabase_client.SupabaseRest (just `.base` + `.headers`),
    and a `now` callable to freeze time.
    """

    def __init__(
        self,
        db_client: Any | None = None,
        *,
        now: Optional[Any] = None,
        http_get: Optional[Any] = None,
    ) -> None:
        self._db = db_client
        # Inject `now` for deterministic tests. Default = real wallclock.
        self._now_fn = now or (lambda: datetime.now(timezone.utc))
        # Inject `http_get` for tests — same signature as httpx.get.
        self._http_get = http_get
        self._bypass_kinds = _parse_bypass_env()

    # ── Internal utilities ─────────────────────────────────────────

    def _now(self) -> datetime:
        n = self._now_fn()
        # Be lenient — accept naive datetimes (treat as UTC) for tests.
        if isinstance(n, datetime) and n.tzinfo is None:
            return n.replace(tzinfo=timezone.utc)
        return n

    def _get(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        """Tiny PostgREST GET helper. Returns [] on any failure so the
        throttle stays permissive when Supabase is unreachable.
        """
        if self._http_get is not None:
            try:
                r = self._http_get(path, params=params)
                if r is None:
                    return []
                if hasattr(r, "json"):
                    data = r.json()
                else:
                    data = r
                return data if isinstance(data, list) else []
            except Exception as e:
                log.warn("push_throttle_http_inject_failed", err=str(e))
                return []

        if self._db is None:
            return []
        try:
            import httpx
            r = httpx.get(
                f"{self._db.base}/{path}",
                headers=self._db.headers,
                params=params,
                timeout=5,
            )
            r.raise_for_status()
            data = r.json() or []
            return data if isinstance(data, list) else []
        except Exception as e:
            log.warn("push_throttle_db_unreachable", err=str(e), path=path)
            return []

    # ── Quiet hours ────────────────────────────────────────────────

    def _fetch_subscription(self, subscription_id: str) -> dict[str, Any]:
        rows = self._get(
            "push_subscriptions",
            {
                "select": "id,quiet_hours_start_utc,quiet_hours_end_utc",
                "id": f"eq.{subscription_id}",
                "limit": "1",
            },
        )
        return rows[0] if rows else {}

    @staticmethod
    def _is_in_quiet_hours(now_utc: datetime, start: int, end: int) -> bool:
        """True iff `now_utc.hour` falls inside [start, end) modulo 24."""
        h = now_utc.hour
        if start == end:
            # Conventional: equal start/end means "no quiet hours" — we
            # don't silence the entire day.
            return False
        if start < end:
            return start <= h < end
        # Wrap-around (e.g. 23h-7h)
        return h >= start or h < end

    def _quiet_hours_check(self, sub: dict[str, Any], kind: str) -> bool:
        """True if quiet-hours allows the push, False if it should be
        blocked. Bypass kinds always return True."""
        if kind in QUIET_HOURS_BYPASS_KINDS:
            return True
        start = sub.get("quiet_hours_start_utc")
        end = sub.get("quiet_hours_end_utc")
        if start is None:
            start = DEFAULT_QUIET_START_UTC
        if end is None:
            end = DEFAULT_QUIET_END_UTC
        # Defensive: clamp to valid range.
        try:
            start = int(start) % 24
            end = int(end) % 24
        except (TypeError, ValueError):
            return True
        return not self._is_in_quiet_hours(self._now(), start, end)

    # ── De-duplication ─────────────────────────────────────────────

    def _is_duplicate(
        self, subscription_id: str, dedupe_key: Optional[str]
    ) -> bool:
        if not dedupe_key:
            return False
        # Look up push_notifications by dedupe_key, then check if a
        # push_delivery for (notification, sub) already succeeded.
        notifs = self._get(
            "push_notifications",
            {
                "select": "id",
                "dedupe_key": f"eq.{dedupe_key}",
                "limit": "1",
            },
        )
        if not notifs:
            return False
        notif_id = notifs[0].get("id")
        if not notif_id:
            return False
        deliveries = self._get(
            "push_deliveries",
            {
                "select": "id",
                "notification_id": f"eq.{notif_id}",
                "subscription_id": f"eq.{subscription_id}",
                "status": "eq.sent",
                "limit": "1",
            },
        )
        return bool(deliveries)

    # ── Lookback counts ────────────────────────────────────────────

    def _count_in_window(
        self,
        subscription_id: str,
        window_seconds: int,
        kind: Optional[str] = None,
    ) -> int:
        cutoff = (self._now() - timedelta(seconds=window_seconds)).isoformat()
        params: dict[str, str] = {
            "select": "id",
            "subscription_id": f"eq.{subscription_id}",
            "status": "eq.sent",
            "sent_at": f"gte.{cutoff}",
        }
        if kind is not None:
            params["kind"] = f"eq.{kind}"
        rows = self._get("push_deliveries", params)
        return len(rows)

    # ── Public API ─────────────────────────────────────────────────

    def should_send(
        self,
        subscription_id: str,
        kind: str,
        dedupe_key: Optional[str] = None,
    ) -> ThrottleDecision:
        """Evaluate the policy for ONE push. Order :
            0 dedupe → 1 quiet hours → 2 per-kind quota → 3 global
        Returns a ThrottleDecision (truthy iff allowed).
        Never raises — falls back to allow-on-doubt.
        """
        # Ops-level escape hatch: PUSH_THROTTLE_BYPASS_KINDS=kill,system
        if kind in self._bypass_kinds:
            return ThrottleDecision(True, reason="bypass_env")

        try:
            # 0. de-dup
            if self._is_duplicate(subscription_id, dedupe_key):
                return ThrottleDecision(False, reason="duplicate")

            # 1. quiet hours
            sub = self._fetch_subscription(subscription_id)
            if not self._quiet_hours_check(sub, kind):
                return ThrottleDecision(False, reason="quiet_hours")

            # 2. per-kind quota
            quota = PER_KIND_QUOTA.get(kind)
            if quota is not None:
                limit, window = quota
                used = self._count_in_window(subscription_id, window, kind=kind)
                if used >= limit:
                    return ThrottleDecision(
                        False,
                        reason=f"kind_quota:{kind}:{used}/{limit}",
                    )

            # 3. global rolling limit
            global_used = self._count_in_window(
                subscription_id, GLOBAL_LIMIT_WINDOW_SECONDS, kind=None
            )
            if global_used >= GLOBAL_LIMIT_COUNT:
                return ThrottleDecision(
                    False,
                    reason=f"global_limit:{global_used}/{GLOBAL_LIMIT_COUNT}",
                )

            return ThrottleDecision(True, reason="allowed")
        except Exception as e:
            # Never block a push because the throttle crashed. Log loud
            # and let it through.
            log.error(
                "push_throttle_unexpected_error",
                error=str(e),
                subscription_id=subscription_id,
                kind=kind,
            )
            return ThrottleDecision(True, reason="error_fallthrough")


# ─────────────────────────────────────────────────────────────────────
# COALESCING
# ─────────────────────────────────────────────────────────────────────

def coalesce_window(
    events: Iterable[PushEvent],
    *,
    window_seconds: int = COALESCE_WINDOW_SECONDS,
    min_events: int = COALESCE_MIN_EVENTS,
) -> list[CoalescedEvent]:
    """Merge close-in-time `kill` events into one notification.

    Algorithm
    ─────────
    Sort by created_at. Sweep with a sliding window of `window_seconds`.
    A run of `min_events` or more `kill` events within the window
    collapses into one CoalescedEvent with count=N. Other kinds (and
    short runs of kills) pass through unchanged.

    Multi-kills, kill_of_the_week, editorial_pin, live_match,
    broadcast, system are NEVER coalesced — each one keeps its own
    notification slot.

    Returns the events in chronological order (most recent last).
    """
    sorted_events = sorted(events, key=lambda e: e.created_at)
    out: list[CoalescedEvent] = []

    i = 0
    while i < len(sorted_events):
        ev = sorted_events[i]
        # Only `kill` events are eligible for coalescing.
        if ev.kind != "kill":
            out.append(_passthrough(ev))
            i += 1
            continue

        # Greedy run: include every consecutive `kill` whose timestamp
        # is within `window_seconds` of the run's *first* event.
        run_start = ev.created_at
        run: list[PushEvent] = [ev]
        j = i + 1
        while j < len(sorted_events):
            nxt = sorted_events[j]
            if nxt.kind != "kill":
                break
            if (nxt.created_at - run_start).total_seconds() > window_seconds:
                break
            run.append(nxt)
            j += 1

        if len(run) >= min_events:
            out.append(_merge_kill_run(run))
        else:
            for x in run:
                out.append(_passthrough(x))
        i = j

    return out


def _passthrough(ev: PushEvent) -> CoalescedEvent:
    return CoalescedEvent(
        kind=ev.kind,
        title=ev.title,
        body=ev.body,
        url=ev.url,
        count=1,
        dedupe_key=ev.dedupe_key,
        representative_kill_id=ev.kill_id,
        member_kill_ids=[ev.kill_id],
        created_at=ev.created_at,
    )


def _merge_kill_run(run: list[PushEvent]) -> CoalescedEvent:
    """Build the single notification that summarises N close-in-time
    kills. French copy per CLAUDE.md §6.4 / settings UI."""
    n = len(run)
    last = run[-1]
    # Stable dedupe key so a worker restart doesn't re-fire the
    # coalesced push: hash the sorted member ids.
    members = [e.kill_id for e in run]
    members_sorted = sorted(members)
    dedupe = "kill_coalesced:" + ",".join(members_sorted[:8])  # cap len
    return CoalescedEvent(
        kind="kill",
        title=f"{n} clips KC viennent d'être publiés",
        body="Ouvre /scroll pour voir tous les clips d'un coup.",
        url="/scroll",
        count=n,
        dedupe_key=dedupe,
        representative_kill_id=last.kill_id,
        member_kill_ids=members,
        created_at=last.created_at,
    )


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _parse_bypass_env() -> frozenset[str]:
    raw = os.getenv(_BYPASS_ENV, "").strip()
    if not raw:
        return frozenset()
    return frozenset(p.strip() for p in raw.split(",") if p.strip())
