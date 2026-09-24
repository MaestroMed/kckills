"""game_time_seconds = chrono affiché (2026-09-23) ; position dans une VOD
continue = temps réel depuis la 1re frame (feed_clock.wall_seconds_for_kill)."""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules import feed_clock  # noqa: E402
from modules.feed_clock import FeedClock  # noqa: E402
from modules.harvester import apply_game_time  # noqa: E402

ANCHOR = 1_756_000_000_000
PAUSE = (ANCHOR + 600_000, ANCHOR + 930_000)      # 5 min 30 de pause à 10:00


def _kills(*offsets_s):
    return [SimpleNamespace(event_epoch=ANCHOR + int(o * 1000), game_time_seconds=None) for o in offsets_s]


def test_chrono_after_pause():
    clock = FeedClock("G1", ANCHOR, ANCHOR + 2_700_000, [PAUSE])
    ks = _kills(300, 2396)                       # avant la pause ; penta 39:56 en temps réel
    apply_game_time(ks, ANCHOR, clock)
    assert [k.game_time_seconds for k in ks] == [300, 2066]     # 34:26 au chrono


def test_unfinished_clock_falls_back_to_wall_time():
    clock = FeedClock("G1", ANCHOR, None, [PAUSE])   # game non terminée : pauses à venir inconnues
    ks = _kills(2396)
    apply_game_time(ks, ANCHOR, clock)
    assert ks[0].game_time_seconds == 2396


def test_no_clock_and_missing_epoch():
    ks = _kills(125) + [SimpleNamespace(event_epoch=None, game_time_seconds=42)]
    apply_game_time(ks, ANCHOR, None)
    assert ks[0].game_time_seconds == 125 and ks[1].game_time_seconds == 42


def test_wall_and_pause_for_vod_position(monkeypatch):
    clock = FeedClock("G1", ANCHOR, ANCHOR + 2_700_000, [PAUSE])
    monkeypatch.setattr(feed_clock, "_GAME_EXT", {"gid": "G1"})
    monkeypatch.setattr(feed_clock, "load_clock", lambda ext: clock if ext == "G1" else None)
    kill = {"game_id": "gid", "event_epoch": ANCHOR + 2_396_000, "game_time_seconds": 2066}
    assert feed_clock.wall_seconds_for_kill(kill) == 2396       # position VOD = temps réel
    assert feed_clock.paused_before_kill_s(kill) == 330.0
    assert feed_clock.chrono_seconds_for_kill(kill) == 2066
    early = {"game_id": "gid", "event_epoch": ANCHOR + 300_000}
    assert feed_clock.paused_before_kill_s(early) == 0.0
    assert feed_clock.wall_seconds_for_kill({"game_id": "inconnue", "event_epoch": ANCHOR}) is None
