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


class _FakeClient:
    def __init__(self):
        self.calls = []

    def patch(self, url, params=None, json=None, headers=None):
        self.calls.append((url, params, json))

        class R:
            status_code = 204
        return R()


class _FakeDb:
    base = "https://db/rest/v1"
    headers = {}

    def __init__(self):
        self.client = _FakeClient()

    def _get_client(self):
        return self.client


def _run_record(monkeypatch, game, outcome):
    import modules.harvester as H
    import services.supabase_client as S

    db = _FakeDb()
    monkeypatch.setattr(S, "get_db", lambda: db)
    monkeypatch.setattr(H, "_tracked_team_id", lambda: "KC")
    H._record_game_winner(game, outcome)
    return db.client.calls


def test_record_winner_maps_side_to_team(monkeypatch):
    game = {"id": "g1", "winner_team_id": None, "matches": {"team_blue_id": "KC", "team_red_id": "C9"}}
    # KC joue rouge dans cette game et le rouge gagne -> KC
    calls = _run_record(monkeypatch, game, {"winner_side": "red", "kc_side": "red"})
    assert calls == [("https://db/rest/v1/games", {"id": "eq.g1", "winner_team_id": "is.null"}, {"winner_team_id": "KC"})]
    # KC bleu, le rouge gagne -> l'adversaire
    calls = _run_record(monkeypatch, game, {"winner_side": "red", "kc_side": "blue"})
    assert calls[0][2] == {"winner_team_id": "C9"}


def test_record_winner_never_guesses_or_overwrites(monkeypatch):
    base = {"id": "g1", "matches": {"team_blue_id": "KC", "team_red_id": "C9"}}
    assert _run_record(monkeypatch, {**base, "winner_team_id": "C9"}, {"winner_side": "red", "kc_side": "red"}) == []
    assert _run_record(monkeypatch, {**base, "winner_team_id": None}, {"winner_side": None, "kc_side": "red"}) == []
    assert _run_record(monkeypatch, {**base, "winner_team_id": None}, {"winner_side": "red", "kc_side": None}) == []
