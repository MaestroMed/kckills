"""
LoLTok Scheduler — Centralized rate limiter for ALL external API calls.

Every external call must go through: await scheduler.wait_for('service_name')
This ensures we never exceed rate limits on any service.
"""

import asyncio
import time
from datetime import datetime, timezone


class LoLTokScheduler:
    DELAYS: dict[str, float] = {
        "gemini": 4.0,             # 15 RPM
        "haiku": 1.5,              # 50 RPM
        "youtube_search": 2.0,
        "ytdlp": 10.0,
        "discord": 2.5,            # 30/60s
        # lolesports has no published rate limit; 2s is courteous for scan
        # loops that paginate the full schedule (7 pages). Main throttle is
        # the daemon's poll interval, not per-call delay.
        "lolesports_idle": 2.0,
        "lolesports_live": 10.0,
        "livestats": 2.0,          # game frames are lightweight and we
                                    # scan ~15 windows per BO5 game
        "ffmpeg_cooldown": 5.0,
        "supabase": 0.1,
        "r2": 0.5,
    }

    DAILY_QUOTAS: dict[str, int] = {
        "gemini": 950,       # 5% margin on 1000 RPD
        "youtube_search": 95,  # margin on 100
    }

    # Reset at 07:00 UTC (midnight Pacific = 09:00 Paris)
    QUOTA_RESET_HOUR_UTC = 7

    def __init__(self):
        self._last_call: dict[str, float] = {}
        self._daily_counts: dict[str, int] = {}
        self._daily_reset_date: str = ""
        self._locks: dict[str, asyncio.Lock] = {}
        self._reset_daily_if_needed()

    def _get_lock(self, service: str) -> asyncio.Lock:
        if service not in self._locks:
            self._locks[service] = asyncio.Lock()
        return self._locks[service]

    def _reset_daily_if_needed(self):
        now = datetime.now(timezone.utc)
        # Day resets at 07:00 UTC
        if now.hour >= self.QUOTA_RESET_HOUR_UTC:
            today = now.strftime("%Y-%m-%d")
        else:
            from datetime import timedelta
            today = (now - timedelta(days=1)).strftime("%Y-%m-%d")

        if self._daily_reset_date != today:
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
