"""Vainqueurs écrits par le sentinel (2026-09-23) : match + games certaines,
jamais d'écrasement (filtre is.null)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules import sentinel  # noqa: E402


class _Resp:
    status_code = 204


class _Client:
    def __init__(self):
        self.calls = []

    def patch(self, url, params=None, json=None, headers=None):
        self.calls.append((url.rsplit("/", 1)[-1], params, json))
        return _Resp()


class _DB:
    base = "https://x/rest/v1"
    headers = {}

    def __init__(self):
        self.client = _Client()

    def _get_client(self):
        return self.client


def _run(monkeypatch, wins_a, wins_b, n_games):
    db = _DB()
    import services.supabase_client as sc
    monkeypatch.setattr(sc, "get_db", lambda: db)
    team_a = {"code": "KC", "result": {"gameWins": wins_a}}
    team_b = {"code": "MKOI", "result": {"gameWins": wins_b}}
    detail = {"teams": [team_a, team_b],
              "games": [{"id": f"g{i}", "state": "completed"} for i in range(1, n_games + 1)]
              + [{"id": "g9", "state": "unneeded"}]}
    out = sentinel._record_winners("m1", team_a, team_b, "blue-KC", "red-MKOI", detail)
    return out, db.client.calls


def test_sweep_sets_every_played_game(monkeypatch):
    out, calls = _run(monkeypatch, 0, 3, 3)
    assert out == {"match": "red-MKOI", "games": 3}
    assert calls[0] == ("matches", {"id": "eq.m1", "winner_team_id": "is.null"}, {"winner_team_id": "red-MKOI"})
    assert [c[1]["external_id"] for c in calls[1:]] == ["eq.g1", "eq.g2", "eq.g3"]
    assert all(c[1]["winner_team_id"] == "is.null" for c in calls[1:])


def test_contested_series_sets_only_last_game(monkeypatch):
    out, calls = _run(monkeypatch, 3, 1, 4)
    assert out == {"match": "blue-KC", "games": 1}
    assert [c[1].get("external_id") for c in calls[1:]] == ["eq.g4"]


def test_tie_or_missing_team_writes_nothing(monkeypatch):
    out, calls = _run(monkeypatch, 1, 1, 2)
    assert out == {"match": None, "games": 0} and calls == []
    assert sentinel._record_winners("m1", {}, {}, None, "x", {}) == {"match": None, "games": 0}
