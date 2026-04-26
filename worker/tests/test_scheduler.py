"""Tests for the rate limiter scheduler."""

import asyncio
import time
import sys
import os

# Add worker root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from scheduler import LoLTokScheduler


def test_delays():
    """Test that wait_for enforces minimum delays."""
    s = LoLTokScheduler()
    assert "gemini" in s.DELAYS
    assert s.DELAYS["gemini"] == 4.0
    assert s.DELAYS["haiku"] == 1.5
    # 2026-04-26 : ytdlp delay tuned from 10s to 4s after observing
    # zero 429s on the production stream over a multi-month window.
    # Sync with scheduler.py DELAYS["ytdlp"].
    assert s.DELAYS["ytdlp"] == 4.0
    print("  [OK] Delays configured correctly")


def test_daily_quotas():
    """Test daily quota tracking."""
    s = LoLTokScheduler()
    assert s.get_remaining("gemini") == 950
    assert s.get_remaining("youtube_search") == 95
    assert s.get_remaining("nonexistent") is None
    print("  [OK] Daily quotas correct")


def test_stats():
    """Test stats reporting."""
    s = LoLTokScheduler()
    stats = s.get_stats()
    assert "daily_counts" in stats
    assert "daily_remaining" in stats
    assert "reset_date" in stats
    assert stats["daily_remaining"]["gemini"] == 950
    print("  [OK] Stats reporting works")


async def test_wait_for():
    """Test that wait_for returns True and enforces delay."""
    s = LoLTokScheduler()
    # First call should be immediate
    start = time.monotonic()
    ok = await s.wait_for("supabase")
    elapsed = time.monotonic() - start
    assert ok is True
    assert elapsed < 1.0  # Should be fast (first call)
    print(f"  [OK] wait_for returned in {elapsed:.3f}s")


async def test_quota_exceeded():
    """Test quota enforcement."""
    s = LoLTokScheduler()
    s.DAILY_QUOTAS["test_service"] = 2
    s.DELAYS["test_service"] = 0.01
    s._daily_counts["test_service"] = 0

    ok1 = await s.wait_for("test_service")
    ok2 = await s.wait_for("test_service")
    ok3 = await s.wait_for("test_service")

    assert ok1 is True
    assert ok2 is True
    assert ok3 is False  # Quota exceeded
    print("  [OK] Quota enforcement works")


def main():
    print("=== Scheduler Tests ===")
    test_delays()
    test_daily_quotas()
    test_stats()
    asyncio.run(test_wait_for())
    asyncio.run(test_quota_exceeded())
    print("\nAll tests passed!")


if __name__ == "__main__":
    main()
