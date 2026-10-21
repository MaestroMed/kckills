"""Vainqueur d'une game lu dans la dernière frame du feed (FrameKillMatcher.winner_side).

Chiffres réels : dernières frames de KC 3-2 C9, Worlds 2026 Play-Ins (15/10/2026).
"""
from modules.harvester import FrameKillMatcher


def _matcher(blue: tuple[int, int], red: tuple[int, int], state: str = "finished") -> FrameKillMatcher:
    m = FrameKillMatcher({}, "g", "blue")
    m.finished = state == "finished"
    m.final_teams = {
        "blue": {"towers": blue[0], "inhibitors": blue[1]},
        "red": {"towers": red[0], "inhibitors": red[1]},
    }
    return m


def test_kc_c9_series():
    # (tours, inhibiteurs) bleu / rouge -> camp vainqueur réel
    games = [
        ((3, 0), (11, 2), "red"),    # G1 C9 (rouge)
        ((5, 0), (7, 1), "red"),     # G2 KC (rouge) — 2 tours d'écart seulement
        ((4, 0), (10, 2), "red"),    # G3 C9 (rouge)
        ((4, 0), (9, 1), "red"),     # G4 KC (rouge)
        ((8, 1), (3, 0), "blue"),    # G5 KC (bleu)
    ]
    for blue, red, want in games:
        assert _matcher(blue, red).winner_side() == want


def test_unfinished_or_ambiguous_gives_none():
    assert _matcher((9, 1), (2, 0), state="in_game").winner_side() is None
    assert _matcher((5, 0), (5, 0)).winner_side() is None
    # plus d'inhibiteurs mais moins de tours : contradictoire, on n'écrit rien
    assert _matcher((4, 1), (6, 0)).winner_side() is None


def test_feed_keeps_last_team_stats():
    m = FrameKillMatcher({}, "g", "blue")
    frame = {
        "rfc460Timestamp": "2026-10-15T19:00:00.000Z",
        "gameState": "finished",
        "blueTeam": {"towers": 8, "inhibitors": 1, "participants": []},
        "redTeam": {"towers": 3, "inhibitors": 0, "participants": []},
    }
    m.feed(frame)
    assert m.finished
    assert m.winner_side() == "blue"
