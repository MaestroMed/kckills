"""Dérive chrono de l'analyzer (2026-09-23) : le chrono lu à l'écran se
compare au CHRONO du kill (horloge du feed), pas au temps réel écoulé —
sinon tout kill après une pause était marqué needs_reclip."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules import analyzer, feed_clock  # noqa: E402
from modules.feed_clock import FeedClock  # noqa: E402

ANCHOR = 1_756_000_000_000
CLOCK = FeedClock("G1", ANCHOR, ANCHOR + 2_700_000, [(ANCHOR + 600_000, ANCHOR + 900_000)])  # pause 5 min à 10:00


def _setup(monkeypatch):
    monkeypatch.setattr(feed_clock, "_GAME_EXT", {"game-uuid": "G1"})
    monkeypatch.setattr(feed_clock, "load_clock", lambda ext: CLOCK if ext == "G1" else None)


def test_chrono_for_kill_after_pause(monkeypatch):
    _setup(monkeypatch)
    kill = {"event_epoch": ANCHOR + 1_000_000, "game_id": "game-uuid"}
    assert feed_clock.chrono_seconds_for_kill(kill) == 700          # 1000 s réels - 300 s de pause
    assert feed_clock.chrono_seconds_for_kill({"event_epoch": None, "game_id": "game-uuid"}) is None
    assert feed_clock.chrono_seconds_for_kill({"event_epoch": ANCHOR, "game_id": "autre"}) is None


def test_no_false_reclip_after_pause(monkeypatch):
    _setup(monkeypatch)
    kill = {"id": "k", "event_epoch": ANCHOR + 1_000_000, "game_id": "game-uuid", "game_time_seconds": 1000}
    result = {"highlight_score": 8, "tags": [], "description_fr": "x" * 60,
              "kill_visible_on_screen": True, "in_game_timer_at_clip_midpoint": "11:30"}
    patch = analyzer._build_analysis_patch(result, kill)
    assert patch["ai_qc_drift_sec"] == 690 - 700
    assert "needs_reclip" not in patch


def test_real_drift_still_flagged(monkeypatch):
    _setup(monkeypatch)
    kill = {"id": "k", "event_epoch": ANCHOR + 1_000_000, "game_id": "game-uuid", "game_time_seconds": 1000}
    result = {"highlight_score": 8, "tags": [], "description_fr": "x" * 60,
              "kill_visible_on_screen": True, "in_game_timer_at_clip_midpoint": "13:00"}
    patch = analyzer._build_analysis_patch(result, kill)
    assert patch["ai_qc_drift_sec"] == 80 and patch["needs_reclip"] is True


def test_without_clock_falls_back_to_wall_time(monkeypatch):
    monkeypatch.setattr(feed_clock, "_GAME_EXT", {"game-uuid": None})
    kill = {"id": "k", "event_epoch": ANCHOR + 1_000_000, "game_id": "game-uuid", "game_time_seconds": 1000}
    result = {"highlight_score": 8, "tags": [], "description_fr": "x" * 60,
              "kill_visible_on_screen": True, "in_game_timer_at_clip_midpoint": "16:30"}
    assert analyzer._build_analysis_patch(result, kill)["ai_qc_drift_sec"] == -10
