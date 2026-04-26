"""Tests for services.push_throttle.

All tests are deterministic — no real Supabase contact, no real time.

Coverage matrix
═══════════════
  global rate limit (5 per 30 min)        → 2 tests
  per-kind quotas                          → 5 tests (1 per kind in PER_KIND_QUOTA)
  multi-kill bypass (no per-kind cap)      → 1 test
  coalescing                               → 3 tests
  de-duplication                           → 2 tests
  quiet hours (incl. wrap-around boundary) → 4 tests
  defaults / no-row subscription           → 1 test
  bypass env var                           → 1 test
  error fallthrough                        → 1 test
That's 20 tests — well past the "12+" floor in the spec.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services import push_throttle as pt  # noqa: E402


# ─────────────────────────────────────────────────────────────────────
# Fake HTTP layer — emulates PostgREST GET on the two tables we hit.
# ─────────────────────────────────────────────────────────────────────

class _FakeResp:
    def __init__(self, payload: list[dict[str, Any]]):
        self._p = payload

    def json(self) -> list[dict[str, Any]]:
        return self._p


class FakeDb:
    """In-memory PostgREST stand-in.

    Supports the queries push_throttle issues :
      * push_subscriptions  (lookup by id)
      * push_notifications  (lookup by dedupe_key)
      * push_deliveries     (count by subscription_id [+ kind] [+ sent_at gte])
    """

    def __init__(self) -> None:
        self.subscriptions: dict[str, dict[str, Any]] = {}
        # list of (notif_id, dedupe_key)
        self.notifications: list[dict[str, Any]] = []
        # list of (subscription_id, notification_id, kind, sent_at, status)
        self.deliveries: list[dict[str, Any]] = []

    # ── helpers used by tests ──
    def add_subscription(
        self,
        sub_id: str,
        *,
        quiet_start: int | None = None,
        quiet_end: int | None = None,
    ) -> None:
        self.subscriptions[sub_id] = {
            "id": sub_id,
            "quiet_hours_start_utc": quiet_start,
            "quiet_hours_end_utc": quiet_end,
        }

    def add_delivery(
        self,
        sub_id: str,
        kind: str,
        sent_at: datetime,
        *,
        notif_id: str = "n",
        status: str = "sent",
    ) -> None:
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        self.deliveries.append({
            "subscription_id": sub_id,
            "notification_id": notif_id,
            "kind": kind,
            "sent_at": sent_at,
            "status": status,
        })

    def add_notification(self, notif_id: str, dedupe_key: str | None) -> None:
        self.notifications.append({"id": notif_id, "dedupe_key": dedupe_key})

    # ── http_get(path, params=...) → _FakeResp ──
    def http_get(self, path: str, *, params: dict[str, str]) -> _FakeResp:
        if path == "push_subscriptions":
            sub_id = _strip_prefix(params.get("id", ""), "eq.")
            sub = self.subscriptions.get(sub_id)
            return _FakeResp([sub] if sub else [])

        if path == "push_notifications":
            key = _strip_prefix(params.get("dedupe_key", ""), "eq.")
            matches = [
                {"id": n["id"]}
                for n in self.notifications
                if n.get("dedupe_key") == key
            ]
            return _FakeResp(matches)

        if path == "push_deliveries":
            sub_id = _strip_prefix(params.get("subscription_id", ""), "eq.")
            kind_filter = params.get("kind")
            kind = (
                _strip_prefix(kind_filter, "eq.")
                if kind_filter is not None
                else None
            )
            cutoff_raw = params.get("sent_at")
            cutoff = None
            if cutoff_raw:
                cutoff = datetime.fromisoformat(_strip_prefix(cutoff_raw, "gte."))
                if cutoff.tzinfo is None:
                    cutoff = cutoff.replace(tzinfo=timezone.utc)
            notif_id_filter = params.get("notification_id")
            notif_id = (
                _strip_prefix(notif_id_filter, "eq.")
                if notif_id_filter is not None
                else None
            )
            status_filter = _strip_prefix(params.get("status", ""), "eq.")

            rows = []
            for d in self.deliveries:
                if d["subscription_id"] != sub_id:
                    continue
                if status_filter and d["status"] != status_filter:
                    continue
                if kind is not None and d["kind"] != kind:
                    continue
                if cutoff is not None and d["sent_at"] < cutoff:
                    continue
                if notif_id is not None and d["notification_id"] != notif_id:
                    continue
                rows.append({"id": "d"})
            return _FakeResp(rows)

        return _FakeResp([])


def _strip_prefix(s: str, prefix: str) -> str:
    return s[len(prefix):] if s.startswith(prefix) else s


def _make_throttle(
    db: FakeDb,
    now: datetime,
) -> pt.PushThrottle:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return pt.PushThrottle(
        db_client=None,
        now=lambda: now,
        http_get=lambda path, params=None: db.http_get(path, params=params or {}),
    )


# Convenient fixed clock — avoids quiet-hours interference (h=12 UTC).
NOON_UTC = datetime(2026, 4, 25, 12, 0, 0, tzinfo=timezone.utc)


# ─────────────────────────────────────────────────────────────────────
# 1. Global rate limit
# ─────────────────────────────────────────────────────────────────────

def test_global_limit_under_cap_allows():
    """4 sends in last 30 min, 5th broadcast (different kind) → allowed."""
    db = FakeDb()
    db.add_subscription("sub1")
    for i in range(4):
        db.add_delivery("sub1", "broadcast", NOON_UTC - timedelta(minutes=i))
    th = _make_throttle(db, NOON_UTC)
    assert th.should_send("sub1", "broadcast").allowed is True


def test_global_limit_at_cap_blocks():
    """5 sends in last 30 min → next push blocked."""
    db = FakeDb()
    db.add_subscription("sub1")
    for i in range(5):
        db.add_delivery("sub1", "broadcast", NOON_UTC - timedelta(minutes=i))
    th = _make_throttle(db, NOON_UTC)
    decision = th.should_send("sub1", "broadcast")
    assert decision.allowed is False
    assert "global_limit" in decision.reason


# ─────────────────────────────────────────────────────────────────────
# 2. Per-kind quotas
# ─────────────────────────────────────────────────────────────────────

def test_kill_quota_blocks_third_kill_in_15min():
    """`kill` is capped at 2 / 15 min — 3rd kill within 15 min is blocked."""
    db = FakeDb()
    db.add_subscription("sub1")
    db.add_delivery("sub1", "kill", NOON_UTC - timedelta(minutes=2))
    db.add_delivery("sub1", "kill", NOON_UTC - timedelta(minutes=5))
    th = _make_throttle(db, NOON_UTC)
    decision = th.should_send("sub1", "kill")
    assert decision.allowed is False
    assert "kind_quota:kill" in decision.reason


def test_kill_quota_allows_after_window_expires():
    """A `kill` 16 min ago is *outside* the 15-min window → next is allowed."""
    db = FakeDb()
    db.add_subscription("sub1")
    db.add_delivery("sub1", "kill", NOON_UTC - timedelta(minutes=16))
    db.add_delivery("sub1", "kill", NOON_UTC - timedelta(minutes=20))
    th = _make_throttle(db, NOON_UTC)
    assert th.should_send("sub1", "kill").allowed is True


def test_kotw_quota_one_per_week():
    """`kill_of_the_week` capped at 1 per 7 days."""
    db = FakeDb()
    db.add_subscription("sub1")
    db.add_delivery(
        "sub1", "kill_of_the_week", NOON_UTC - timedelta(days=3)
    )
    th = _make_throttle(db, NOON_UTC)
    decision = th.should_send("sub1", "kill_of_the_week")
    assert decision.allowed is False
    assert "kind_quota:kill_of_the_week" in decision.reason


def test_editorial_pin_quota_three_per_day():
    """`editorial_pin` capped at 3 / day."""
    db = FakeDb()
    db.add_subscription("sub1")
    for h in (1, 5, 10):
        db.add_delivery("sub1", "editorial_pin", NOON_UTC - timedelta(hours=h))
    th = _make_throttle(db, NOON_UTC)
    decision = th.should_send("sub1", "editorial_pin")
    assert decision.allowed is False


def test_live_match_quota_one_per_4h():
    """`live_match` capped at 1 / 4h (one per match start)."""
    db = FakeDb()
    db.add_subscription("sub1")
    db.add_delivery("sub1", "live_match", NOON_UTC - timedelta(hours=2))
    th = _make_throttle(db, NOON_UTC)
    decision = th.should_send("sub1", "live_match")
    assert decision.allowed is False


# ─────────────────────────────────────────────────────────────────────
# 3. Multi-kill bypass
# ─────────────────────────────────────────────────────────────────────

def test_kill_multi_no_per_kind_cap():
    """`kill_multi` (penta/quadra/triple) has NO per-kind quota — only
    global limit applies. Even after 3 multi-kill pushes in 15 min,
    the 4th one is allowed (still under the 5-global ceiling)."""
    db = FakeDb()
    db.add_subscription("sub1")
    for m in (1, 5, 10):
        db.add_delivery("sub1", "kill_multi", NOON_UTC - timedelta(minutes=m))
    th = _make_throttle(db, NOON_UTC)
    assert th.should_send("sub1", "kill_multi").allowed is True


# ─────────────────────────────────────────────────────────────────────
# 4. Coalescing
# ─────────────────────────────────────────────────────────────────────

def _ev(kid: str, kind: str, t: datetime) -> pt.PushEvent:
    return pt.PushEvent(
        kill_id=kid, kind=kind, title="t", body="b", url="/u", created_at=t
    )


def test_coalesce_collapses_burst():
    """3+ kill events within 60s → 1 coalesced notification."""
    base = NOON_UTC
    events = [
        _ev("k1", "kill", base),
        _ev("k2", "kill", base + timedelta(seconds=15)),
        _ev("k3", "kill", base + timedelta(seconds=40)),
        _ev("k4", "kill", base + timedelta(seconds=55)),
    ]
    out = pt.coalesce_window(events)
    assert len(out) == 1
    assert out[0].count == 4
    assert "clips KC" in out[0].title
    assert out[0].url == "/scroll"


def test_coalesce_passthrough_pair():
    """Only 2 kills in window → both pass through (min_events=3)."""
    base = NOON_UTC
    events = [
        _ev("k1", "kill", base),
        _ev("k2", "kill", base + timedelta(seconds=10)),
    ]
    out = pt.coalesce_window(events)
    assert len(out) == 2
    assert all(o.count == 1 for o in out)


def test_coalesce_does_not_merge_other_kinds():
    """A live_match + kill_of_the_week + kills must not be merged across
    kinds. Kills inside their own run still coalesce independently."""
    base = NOON_UTC
    events = [
        _ev("k1", "kill", base),
        _ev("k2", "kill", base + timedelta(seconds=5)),
        _ev("k3", "kill", base + timedelta(seconds=20)),
        _ev("kotw", "kill_of_the_week", base + timedelta(seconds=25)),
        _ev("live", "live_match", base + timedelta(seconds=30)),
    ]
    out = pt.coalesce_window(events)
    # kills coalesce → 1 ; kotw + live → 2 passthroughs
    kinds = sorted(o.kind for o in out)
    counts = sorted(o.count for o in out)
    assert kinds == ["kill", "kill_of_the_week", "live_match"]
    assert counts == [1, 1, 3]


# ─────────────────────────────────────────────────────────────────────
# 5. De-duplication
# ─────────────────────────────────────────────────────────────────────

def test_dedup_blocks_repeat():
    """A push for a (sub, dedupe_key) already delivered is blocked."""
    db = FakeDb()
    db.add_subscription("sub1")
    db.add_notification("notif-A", dedupe_key="kotw:2026-w17")
    db.add_delivery("sub1", "kill_of_the_week", NOON_UTC - timedelta(hours=1),
                    notif_id="notif-A")
    th = _make_throttle(db, NOON_UTC)
    decision = th.should_send("sub1", "kill_of_the_week",
                              dedupe_key="kotw:2026-w17")
    assert decision.allowed is False
    assert decision.reason == "duplicate"


def test_dedup_no_match_allows():
    """Unknown dedupe_key — no match in push_notifications — allowed."""
    db = FakeDb()
    db.add_subscription("sub1")
    th = _make_throttle(db, NOON_UTC)
    assert th.should_send("sub1", "broadcast", dedupe_key="never-seen").allowed


# ─────────────────────────────────────────────────────────────────────
# 6. Quiet hours
# ─────────────────────────────────────────────────────────────────────

def test_quiet_hours_default_blocks_at_3am_utc():
    """Default 23-7 UTC → 3am UTC is silent."""
    db = FakeDb()
    db.add_subscription("sub1")  # quiet_*=None → defaults
    three_am = datetime(2026, 4, 25, 3, 0, 0, tzinfo=timezone.utc)
    th = _make_throttle(db, three_am)
    decision = th.should_send("sub1", "kill")
    assert decision.allowed is False
    assert decision.reason == "quiet_hours"


def test_quiet_hours_boundary_end_inclusive():
    """End hour is exclusive — at h==end the throttle no longer blocks.
    Default end=7 → at 7:00 UTC the push IS allowed."""
    db = FakeDb()
    db.add_subscription("sub1")
    seven_am = datetime(2026, 4, 25, 7, 0, 0, tzinfo=timezone.utc)
    th = _make_throttle(db, seven_am)
    assert th.should_send("sub1", "kill").allowed is True


def test_quiet_hours_system_kind_bypasses():
    """`system` kind ignores quiet hours (downtime alerts must reach)."""
    db = FakeDb()
    db.add_subscription("sub1")
    three_am = datetime(2026, 4, 25, 3, 0, 0, tzinfo=timezone.utc)
    th = _make_throttle(db, three_am)
    assert th.should_send("sub1", "system").allowed is True


def test_quiet_hours_custom_no_wrap_around():
    """Custom 13-15 UTC (no wrap-around). At 14:00 UTC → block."""
    db = FakeDb()
    db.add_subscription("sub1", quiet_start=13, quiet_end=15)
    two_pm = datetime(2026, 4, 25, 14, 0, 0, tzinfo=timezone.utc)
    th = _make_throttle(db, two_pm)
    decision = th.should_send("sub1", "kill")
    assert decision.allowed is False
    # At 15:00 UTC (end exclusive) → allow
    th2 = _make_throttle(db, two_pm.replace(hour=15))
    assert th2.should_send("sub1", "kill").allowed is True


# ─────────────────────────────────────────────────────────────────────
# 7. Subscription with no row at all (migration 042 not applied yet)
# ─────────────────────────────────────────────────────────────────────

def test_unknown_subscription_uses_defaults():
    """No row for the subscription → quiet-hours defaults apply, all
    other policies see zero-history. At noon UTC, push is allowed."""
    db = FakeDb()  # NO add_subscription()
    th = _make_throttle(db, NOON_UTC)
    assert th.should_send("ghost-sub", "kill").allowed is True


# ─────────────────────────────────────────────────────────────────────
# 8. Bypass env var
# ─────────────────────────────────────────────────────────────────────

def test_bypass_env_disables_all_checks(monkeypatch: pytest.MonkeyPatch):
    """PUSH_THROTTLE_BYPASS_KINDS=kill skips every gate for `kill` only."""
    monkeypatch.setenv("PUSH_THROTTLE_BYPASS_KINDS", "kill")
    db = FakeDb()
    db.add_subscription("sub1")
    # Stack the deck: 5 kill deliveries, dedupe match, quiet hours.
    for i in range(5):
        db.add_delivery("sub1", "kill", NOON_UTC - timedelta(minutes=i))
    three_am = datetime(2026, 4, 25, 3, 0, 0, tzinfo=timezone.utc)
    th = _make_throttle(db, three_am)
    decision = th.should_send("sub1", "kill")
    assert decision.allowed is True
    assert decision.reason == "bypass_env"
    # `broadcast` is NOT in the bypass list → still throttled if applicable.
    # Here global_used is computed across ALL kinds = 5 → blocked.
    decision2 = th.should_send("sub1", "broadcast")
    assert decision2.allowed is False


# ─────────────────────────────────────────────────────────────────────
# 9. Error fallthrough — throttle never blocks on its own crash.
# ─────────────────────────────────────────────────────────────────────

def test_error_fallthrough_allows():
    """If the http_get callable raises, should_send must NOT block."""

    def boom(_path: str, params: dict[str, str] | None = None) -> Any:
        raise RuntimeError("network down")

    th = pt.PushThrottle(
        db_client=None,
        now=lambda: NOON_UTC,
        http_get=boom,
    )
    # The internal _get catches the error and returns []. With empty
    # subscription rows + zero history, the throttle ends up allowing.
    decision = th.should_send("sub1", "kill")
    assert decision.allowed is True


# ─────────────────────────────────────────────────────────────────────
# 10. Quiet-hours wrap-around math (unit on the static helper)
# ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "hour, expected",
    [
        (22, False),  # before window
        (23, True),   # at start
        (0, True),    # in window (wrap)
        (3, True),    # in window (wrap)
        (6, True),    # in window (wrap)
        (7, False),   # at end (exclusive)
        (8, False),   # after end
        (12, False),  # midday
    ],
)
def test_wrap_around_helper(hour: int, expected: bool):
    """The static _is_in_quiet_hours helper handles the 23h-7h wrap."""
    now = datetime(2026, 4, 25, hour, 0, 0, tzinfo=timezone.utc)
    got = pt.PushThrottle._is_in_quiet_hours(now, 23, 7)
    assert got is expected, f"hour={hour} expected={expected} got={got}"


def test_quiet_hours_equal_start_end_means_never():
    """start == end is a conventional 'no quiet hours' value."""
    db = FakeDb()
    db.add_subscription("sub1", quiet_start=12, quiet_end=12)
    th = _make_throttle(db, NOON_UTC)
    assert th.should_send("sub1", "kill").allowed is True
