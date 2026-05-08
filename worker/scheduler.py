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

    # Reset at 07:00 UTC (midnight Pacific = 09:00 Paris)
    QUOTA_RESET_HOUR_UTC = 7

    def __init__(self):
        self._last_call: dict[str, float] = {}
        self._daily_counts: dict[str, int] = {}
        self._daily_reset_date: str = ""
        self._locks: dict[str, asyncio.Lock] = {}
        # Wave 27.3 — sync lock around the daily-reset bookkeeping.
        # Both the async wait_for() path and the sync get_stats() /
        # get_remaining() paths can trigger a reset, and the sync
        # callers can't await an asyncio.Lock. A threading.Lock works
        # for both since it doesn't yield to the event loop.
        self._reset_lock = threading.Lock()
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

    async def wait_for(self, service: str) -> bool:
        """Wait until it's safe to call the service. Returns False if daily quota exceeded."""
        async with self._get_lock(service):
            self._reset_daily_if_needed()

            # Check daily quota
            if service in self.DAILY_QUOTAS:
                count = self._daily_counts.get(service, 0)
                if count >= self.DAILY_QUOTAS[service]:
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

            return True

    def get_remaining(self, service: str) -> int | None:
        """Get remaining daily quota for a service. None if no quota."""
        if service not in self.DAILY_QUOTAS:
            return None
        self._reset_daily_if_needed()
        return self.DAILY_QUOTAS[service] - self._daily_counts.get(service, 0)

    def get_stats(self) -> dict:
        """Return current scheduler stats."""
        self._reset_daily_if_needed()
        return {
            "daily_counts": dict(self._daily_counts),
            "daily_remaining": {
                k: self.DAILY_QUOTAS[k] - self._daily_counts.get(k, 0)
                for k in self.DAILY_QUOTAS
            },
            "reset_date": self._daily_reset_date,
        }


# Global singleton
scheduler = LoLTokScheduler()
