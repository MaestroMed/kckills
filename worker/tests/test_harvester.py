"""Tests for the kill detection harvester."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules.harvester import _diff_frames, _detect_multi_kill, _get_kc_involvement


def test_detect_multi_kill():
    assert _detect_multi_kill(1) is None
    assert _detect_multi_kill(2) == "double"
    assert _detect_multi_kill(3) == "triple"
    assert _detect_multi_kill(4) == "quadra"
    assert _detect_multi_kill(5) == "penta"
    assert _detect_multi_kill(7) == "penta"
    print("  [OK] Multi-kill detection")


def test_kc_involvement():
    assert _get_kc_involvement({"side": "blue"}, {"side": "red"}, "blue") == "team_killer"
    assert _get_kc_involvement({"side": "red"}, {"side": "blue"}, "blue") == "team_victim"
    assert _get_kc_involvement({"side": "red"}, {"side": "blue"}, "red") == "team_killer"
    assert _get_kc_involvement({"side": "blue"}, {"side": "red"}, "red") == "team_victim"
    # Neither side is KC
    assert _get_kc_involvement({"side": "blue"}, {"side": "red"}, "neither") is None
    print("  [OK] KC involvement detection")


def test_diff_frames_simple_kill():
    """Test 1v1 kill detection from frame diff."""
    prev = {
        "1": {"kills": 0, "deaths": 0, "assists": 0},
        "2": {"kills": 0, "deaths": 0, "assists": 0},
    }
    curr = {
        "1": {"kills": 1, "deaths": 0, "assists": 0},
        "2": {"kills": 0, "deaths": 1, "assists": 0},
    }
    participants = {
        "1": {"name": "KC Caliste", "champion": "Jinx", "role": "bottom", "side": "blue"},
        "2": {"name": "G2 Hans", "champion": "Aphelios", "role": "bottom", "side": "red"},
    }

    kills = _diff_frames(prev, curr, participants, "2026-01-01T00:00:00Z", "test-game", "blue", 0)
    assert len(kills) == 1
    k = kills[0]
    assert k.killer_champion == "Jinx"
    assert k.victim_champion == "Aphelios"
    assert k.confidence == "high"
    assert k.tracked_team_involvement == "team_killer"
    assert k.is_first_blood is True
    print("  [OK] Simple 1v1 kill detection")


def test_diff_frames_no_change():
    """No kills when frames are identical."""
    frame = {"1": {"kills": 3, "deaths": 1, "assists": 2}}
    kills = _diff_frames(frame, frame, {}, "2026-01-01T00:00:00Z", "test", "blue", 5)
    assert len(kills) == 0
    print("  [OK] No false positives on identical frames")


def test_diff_frames_teamfight():
    """Teamfight: multiple kills in one frame."""
    prev = {
        "1": {"kills": 0, "deaths": 0, "assists": 0},
        "2": {"kills": 0, "deaths": 0, "assists": 0},
        "3": {"kills": 0, "deaths": 0, "assists": 0},
        "4": {"kills": 0, "deaths": 0, "assists": 0},
    }
    curr = {
        "1": {"kills": 2, "deaths": 0, "assists": 0},  # blue killer
        "2": {"kills": 0, "deaths": 0, "assists": 0},
        "3": {"kills": 0, "deaths": 1, "assists": 0},  # red victim
        "4": {"kills": 0, "deaths": 1, "assists": 0},  # red victim
    }
    participants = {
        "1": {"name": "KC Caliste", "champion": "Jinx", "side": "blue", "role": "adc"},
        "2": {"name": "KC Busio", "champion": "Thresh", "side": "blue", "role": "support"},
        "3": {"name": "G2 Caps", "champion": "Azir", "side": "red", "role": "mid"},
        "4": {"name": "G2 Hans", "champion": "Aphelios", "side": "red", "role": "adc"},
    }

    kills = _diff_frames(prev, curr, participants, "2026-01-01T00:00:00Z", "test", "blue", 0)
    assert len(kills) >= 1
    assert kills[0].confidence == "medium"
    print(f"  [OK] Teamfight detected {len(kills)} kill(s)")


def main():
    print("=== Harvester Tests ===")
    test_detect_multi_kill()
    test_kc_involvement()
    test_diff_frames_simple_kill()
    test_diff_frames_no_change()
    test_diff_frames_teamfight()
    print("\nAll tests passed!")


if __name__ == "__main__":
    main()
