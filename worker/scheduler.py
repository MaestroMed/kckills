"""
LoLTok Scheduler — Centralized rate limiter for ALL external API calls.

Every external call must go through: await scheduler.wait_for('service_name')
This ensures we never exceed rate limits on any service.

Wave 27.3 hardening :
  * Daily-reset is gated by a `threading.Lock` so the sync entry points
    (get_stats / get_remaining, called from /admin endpoints + dashboards)
    don't race with the asyncio wait_for path. The asyncio lock alone
    wouldn't help because sync callers don't await it.
  * Backward wall-clock jumps no longer wipe the daily counters. We only
    reset when the new date is STRICTLY LATER than the stored date. An
    NTP correction that pulls the clock back (or a TZ misconfig) would
    otherwise zero out the counts mid-day and let the worker exceed the
    Gemini RPD quota.
  * The threading.Lock + atomic dict reassignment also means concurrent
    coroutines on different per-service locks can't observe a partially-
    cleared count dict.

Wave 34 T3.1 — Cross-process coordination :
  * Pre-Wave-34, orchestrator.py spawned 4 child Python processes, each
    with its own in-process `_daily_counts` + `_daily_cost_usd`. The
    Gemini RPD cap 950 could overshoot to ~3800/day under sustained
    load, and the $-cost cap was equally per-process.
  * Now wait_for() consults a SHARED ledger in Postgres
    (`worker_quota_ledger`, migration 073) before admitting a call.
    record_cost() also bumps the shared ledger via the RPC
    `fn_worker_quota_record`.
  * The shared lookup is cached 5 seconds inside each process to avoid
    spamming the DB ; under typical load (1 call/4s for Gemini) the
    cache is hit on every wait_for() between RPC bumps.
  * If the RPC fails (Supabase down, RLS misconfig), we silently fall
    back to the in-memory ledger so the worker keeps running. This
    matches the existing "Supabase down → local cache" pattern.
"""

import asyncio
import os
import threading
import time
from datetime import datetime, timezone


class LoLTokScheduler:
    DELAYS: dict[str, float] = {
        "gemini": 4.0,             # 15 RPM — hard API limit, can't lower
        "haiku": 1.5,              # 50 RPM — hard API limit, can't lower
        "youtube_search": 2.0,
        # ytdlp throttle dropped from 10s to 4s after observing zero 429s
        # over 1.5K successful downloads on residential IP. Scheduler still
        # serialises across the 6 clip workers, so effective rate is one
        # download every 4s = 900/h theoretical, ~250-400/h with ffmpeg
        # post-processing. If YouTube starts throttling, bump back to 8s.
        "ytdlp": 4.0,
        "discord": 2.5,            # 30/60s
        # lolesports has no published rate limit; 2s is courteous for scan
        # loops that paginate the full schedule (7 pages). Main throttle is
        # the daemon's poll interval, not per-call delay.
        "lolesports_idle": 2.0,
        "lolesports_live": 10.0,
        "livestats": 2.0,          # game frames are lightweight and we
                                    # scan ~15 windows per BO5 game
        # ffmpeg_cooldown : the original 5s assumed a small CPU. With a
        # 16-core Ryzen the bottleneck is I/O, not heat. 1s gives ffmpeg
        # enough breathing room to flush + close handles between calls
        # without artificially serialising the per-clip 4-pass encode.
        "ffmpeg_cooldown": 1.0,
        "supabase": 0.1,
        "r2": 0.5,
    }

    # Daily call budgets. The default 950 keeps us inside Gemini's 1000
    # RPD free tier with a 5% margin.
    #
    # PR12 — when Pro 2.5 is enabled (paid tier), KCKILLS_GEMINI_DAILY_CAP
    # overrides this. Math : Pro 2.5 ≈ $0.0115/clip → 250 calls/day = ~$3
    # = €2.80/day = €84/month max. Set the env var to whatever fits your
    # Google Cloud budget alert. The scheduler enforces this regardless
    # of the API tier — protects you from runaway spend on a bug loop.
    #
    # User explicit budget (€45 one-shot): cap at 250/day = ~15 days to
    # drain the 2,021-clip catalog at €27 total.
    DAILY_QUOTAS: dict[str, int] = {
        "gemini": int(os.environ.get(
            "KCKILLS_GEMINI_DAILY_CAP",
            os.environ.get("GEMINI_DAILY_CAP", "950"),
        )),
        "youtube_search": 95,  # margin on 100
    }

    # Wave 33 — daily $-cost cap (USD). Belt-and-suspenders alongside the
    # RPD count cap, mostly to bound damage if a code change accidentally
    # routes a 3.5-flash high-output call in a tight loop. Set to None to
    # disable ; default is intentionally loose (~$10/day = $300/month
    # ceiling) so the steady-state ~$50/mois budget has plenty of headroom
    # and we don't paper-cut the operator on a Pro one-shot run.
    #
    # Reset window aligns with DAILY_QUOTAS (07:00 UTC).
    DAILY_COST_CAPS_USD: dict[str, float | None] = {
        "gemini": (
            float(os.environ.get("KCKILLS_GEMINI_DAILY_COST_CAP_USD", "10.0"))
            if os.environ.get("KCKILLS_GEMINI_DAILY_COST_CAP_USD", "10.0")
            else None
        ),
    }

    # Reset at 07:00 UTC (midnight Pacific = 09:00 Paris)
    QUOTA_RESET_HOUR_UTC = 7

    # Wave 34 T3.1 — TTL of the shared ledger lookup cache. 5s is short
    # enough that bursts from sibling processes are picked up within a
    # couple of wait_for() calls, long enough that a steady 1 call/4s
    # stream doesn't hammer the DB. Tunable via env var for tests.
    SHARED_LOOKUP_TTL_SECONDS = float(os.environ.get(
        "KCKILLS_QUOTA_SHARED_TTL", "5.0",
    ))

    def __init__(self):
        self._last_call: dict[str, float] = {}
        self._daily_counts: dict[str, int] = {}
        # Wave 33 — running USD spend per service per day. Reset alongside
        # `_daily_counts` at the 07:00 UTC rollover.
        self._daily_cost_usd: dict[str, float] = {}
        self._daily_reset_date: str = ""
        self._locks: dict[str, asyncio.Lock] = {}
        # Wave 27.3 — sync lock around the daily-reset bookkeeping.
        # Both the async wait_for() path and the sync get_stats() /
        # get_remaining() paths can trigger a reset, and the sync
        # callers can't await an asyncio.Lock. A threading.Lock works
        # for both since it doesn't yield to the event loop.
        self._reset_lock = threading.Lock()

        # Wave 34 T3.1 — shared ledger cache. Tuple of
        # (count, cost, fetched_monotonic) per service. Reset alongside
        # the daily counters at the 07:00 UTC rollover.
        self._shared_cache: dict[str, tuple[int, float, float]] = {}

        self._reset_daily_if_needed()

    def _get_lock(self, service: str) -> asyncio.Lock:
        if service not in self._locks:
            self._locks[service] = asyncio.Lock()
        return self._locks[service]

    def _reset_daily_if_needed(self):
        """Reset the daily counters when we cross 07:00 UTC.

        Wave 27.3 — strictly forward-only date comparison. Previously a
        wall-clock backward jump (NTP correction, sleep/wake on a laptop
        with a flaky RTC, manual TZ change) would change the computed
        `today` string and trigger a reset mid-day, wiping the Gemini
        quota counter and letting the worker exceed the daily cap.

        Now we only reset when `today > self._daily_reset_date` — string
        comparison works because the format is ISO `YYYY-MM-DD`, which
        sorts chronologically.
        """
        now = datetime.now(timezone.utc)
        # Day resets at 07:00 UTC
        if now.hour >= self.QUOTA_RESET_HOUR_UTC:
            today = now.strftime("%Y-%m-%d")
        else:
            from datetime import timedelta
            today = (now - timedelta(days=1)).strftime("%Y-%m-%d")

        # Fast-path : date hasn't moved. Avoids the lock cost on the
        # 99.9% of calls that don't trigger a reset.
        if today <= self._daily_reset_date:
            return

        with self._reset_lock:
            # Re-check inside the lock — another caller may have reset
            # between our fast-path check and the lock acquisition.
            if today > self._daily_reset_date:
                self._daily_reset_date = today
                self._daily_counts = {k: 0 for k in self.DAILY_QUOTAS}
                # Wave 33 — also reset the cost ledger.
                self._daily_cost_usd = {k: 0.0 for k in self.DAILY_COST_CAPS_USD}
                # Wave 34 T3.1 — invalidate the shared-ledger cache so
                # the first call after rollover hits Postgres for a
                # fresh count (which the migration treats as a new row
                # for the new quota_date).
                self._shared_cache = {}

    # ─── Wave 34 T3.1 — shared ledger helpers ────────────────────────
    def _current_quota_date(self) -> str:
        """ISO date string of the active quota window (post-07:00 UTC).

        Mirrors `_reset_daily_if_needed`'s rule so the shared ledger
        rows align with the in-memory reset boundary.
        """
        now = datetime.now(timezone.utc)
        if now.hour >= self.QUOTA_RESET_HOUR_UTC:
            return now.strftime("%Y-%m-%d")
        from datetime import timedelta
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")

    def _get_db(self):
        """Lazy import of services.supabase_client.get_db.

        Import is deferred to avoid a circular dep at module load
        (config → scheduler can be imported before supabase_client is
        wired). The wrapped call returns None when the env vars aren't
        set, which we surface as a clean "no shared ledger" signal.
        """
        try:
            from services.supabase_client import get_db
            return get_db()
        except Exception:
            return None

    async def _record_call_shared(self, service: str, cost_usd: float = 0.0) -> tuple[int, float] | None:
        """Bump the shared ledger via fn_worker_quota_record.

        Returns (call_count, cost_usd) on success, None on failure
        (Supabase down, RLS deny, RPC absent). Callers fall back to the
        in-memory ledger on None.

        Runs in a thread (`asyncio.to_thread`) because the underlying
        httpx call is sync. Keeps the event loop unblocked.
        """
        db = self._get_db()
        if db is None:
            return None

        payload = {
            "p_service": service,
            "p_quota_date": self._current_quota_date(),
            "p_cost_usd": float(cost_usd or 0.0),
        }

        def _do_post():
            client = db._get_client()
            r = client.post(f"{db.base}/rpc/fn_worker_quota_record", json=payload)
            r.raise_for_status()
            data = r.json() or []
            # Postgres TABLE function returns either a list of rows or
            # a single row dict depending on PostgREST settings.
            if isinstance(data, list) and data:
                row = data[0]
            elif isinstance(data, dict):
                row = data
            else:
                return None
            return (int(row.get("call_count", 0)), float(row.get("cost_usd", 0.0)))

        try:
            result = await asyncio.to_thread(_do_post)
            if result is not None:
                # Refresh the local cache with the freshly-known value
                # so the very next wait_for() call sees the bump without
                # re-querying.
                self._shared_cache[service] = (
                    result[0], result[1], time.monotonic(),
                )
            return result
        except Exception:
            return None

    async def _get_shared_count(self, service: str) -> tuple[int, float] | None:
        """Read the shared ledger for `service`, caching the answer for
        `SHARED_LOOKUP_TTL_SECONDS`.

        Returns (call_count, cost_usd) on success, None when the RPC
        can't be reached. wait_for() merges this with the in-memory
        count by taking the max — defensive against the case where the
        local process ran a few calls before the shared ledger was up.
        """
        cached = self._shared_cache.get(service)
        now = time.monotonic()
        if cached is not None:
            cnt, cost, fetched_at = cached
            if now - fetched_at < self.SHARED_LOOKUP_TTL_SECONDS:
                return (cnt, cost)

        db = self._get_db()
        if db is None:
            return None

        payload = {
            "p_service": service,
            "p_quota_date": self._current_quota_date(),
        }

        def _do_post():
            client = db._get_client()
            r = client.post(f"{db.base}/rpc/fn_worker_quota_get", json=payload)
            r.raise_for_status()
            data = r.json() or []
            if isinstance(data, list) and data:
                row = data[0]
            elif isinstance(data, dict):
                row = data
            else:
                return (0, 0.0)
            return (int(row.get("call_count", 0)), float(row.get("cost_usd", 0.0)))

        try:
            result = await asyncio.to_thread(_do_post)
            if result is not None:
                self._shared_cache[service] = (result[0], result[1], now)
            return result
        except Exception:
            return None

    async def wait_for(self, service: str) -> bool:
        """Wait until it's safe to call the service. Returns False if a
        daily quota (RPD count OR USD cost cap) is exceeded.

        Wave 33 — cost-cap path : when `DAILY_COST_CAPS_USD[service]` is
        set and the cumulative spend for the day has already crossed it,
        we short-circuit before sleeping. Callers (analyzer / quote
        extractor) report cost back via `record_cost()` after each
        response so the ledger stays current.

        Wave 34 T3.1 — Before checking the in-memory counter we consult
        the shared Postgres ledger (cached 5s). When the shared value is
        higher (a sibling orchestrator child made calls we never saw),
        we use it. If the RPC is unreachable, we fall back silently to
        the in-memory ledger — the previous behaviour.
        """
        async with self._get_lock(service):
            self._reset_daily_if_needed()

            # Wave 34 T3.1 — pull the latest shared snapshot. None means
            # the RPC failed; we degrade gracefully to the in-memory
            # numbers.
            shared = await self._get_shared_count(service)
            local_count = self._daily_counts.get(service, 0)
            local_cost = self._daily_cost_usd.get(service, 0.0)
            if shared is not None:
                effective_count = max(local_count, shared[0])
                effective_cost = max(local_cost, shared[1])
            else:
                effective_count = local_count
                effective_cost = local_cost

            # Check daily quota (RPD)
            if service in self.DAILY_QUOTAS:
                if effective_count >= self.DAILY_QUOTAS[service]:
                    return False

            # Wave 33 — check daily USD cost cap.
            cost_cap = self.DAILY_COST_CAPS_USD.get(service)
            if cost_cap is not None:
                if effective_cost >= cost_cap:
                    return False

            # Enforce minimum delay
            delay = self.DELAYS.get(service, 1.0)
            last = self._last_call.get(service, 0)
            elapsed = time.monotonic() - last
            if elapsed < delay:
                await asyncio.sleep(delay - elapsed)

            # Record call
            self._last_call[service] = time.monotonic()
            if service in self.DAILY_QUOTAS:
                self._daily_counts[service] = self._daily_counts.get(service, 0) + 1

            # Wave 34 T3.1 — note that we do NOT bump the shared ledger
            # here. The shared bump is done from `record_cost()`, which
            # is paired 1:1 with every wait_for() for cost-tracked
            # services (Gemini today). This avoids double-counting in
            # the ledger. For RPD-only services like youtube_search
            # which never call record_cost, the in-memory counter is
            # the source of truth — those services are mono-process
            # (only the `discovery` child polls them) so cross-process
            # coordination isn't needed.

            return True

    def record_cost(self, service: str, usd: float) -> None:
        """Add `usd` to the running day-spend ledger for `service`.

        Wave 33 — called by the analyzer + quote extractor + any other
        caller that computes a per-call cost via
        `services.ai_pricing.compute_gemini_cost`. Safe to call from any
        thread / coroutine — the underlying dict ops are atomic in
        CPython and the cap check inside wait_for() uses the same
        scheduler lock.

        Silently no-ops on bad input so callers don't need a try/except
        wrapper.

        Wave 34 T3.1 — also writes to the shared Postgres ledger via
        `fn_worker_quota_record`. The shared bump is best-effort and
        runs on a background asyncio task when an event loop is
        available; otherwise it's skipped (the in-memory counter still
        catches the spend, and the next wait_for() will refresh from
        the shared ledger).
        """
        try:
            v = float(usd)
        except (TypeError, ValueError):
            return
        if v <= 0:
            return
        self._reset_daily_if_needed()
        self._daily_cost_usd[service] = (
            self._daily_cost_usd.get(service, 0.0) + v
        )

        # Wave 34 T3.1 — fire-and-forget shared ledger bump. record_cost
        # is a sync entry point (called from analyze_kill etc.), so we
        # schedule the RPC on the running loop if there is one. This is
        # the single ledger-bump site : `wait_for()` only READS the
        # shared count (cached 5s). For Gemini, record_cost() is paired
        # 1:1 with wait_for() at every call site, so fn_worker_quota_record
        # bumping call_count + cost in one shot keeps the ledger
        # accurate without double-counting.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No running loop — skip the shared bump. The in-memory
            # spend is preserved and will be reconciled the next time
            # _get_shared_count() runs in a coroutine context.
            return
        loop.create_task(self._record_call_shared(service, cost_usd=v))

    def get_remaining(self, service: str) -> int | None:
        """Get remaining daily quota for a service. None if no quota."""
        if service not in self.DAILY_QUOTAS:
            return None
        self._reset_daily_if_needed()
        return self.DAILY_QUOTAS[service] - self._daily_counts.get(service, 0)

    def get_stats(self) -> dict:
        """Return current scheduler stats. Includes Wave 33 cost ledger."""
        self._reset_daily_if_needed()
        return {
            "daily_counts": dict(self._daily_counts),
            "daily_remaining": {
                k: self.DAILY_QUOTAS[k] - self._daily_counts.get(k, 0)
                for k in self.DAILY_QUOTAS
            },
            "daily_cost_usd": dict(self._daily_cost_usd),
            "daily_cost_remaining_usd": {
                k: (cap - self._daily_cost_usd.get(k, 0.0)) if cap is not None else None
                for k, cap in self.DAILY_COST_CAPS_USD.items()
            },
            "reset_date": self._daily_reset_date,
        }


# Global singleton
scheduler = LoLTokScheduler()
