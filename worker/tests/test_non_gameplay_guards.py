"""Incident du 29/09/2026 (1 149 clips publiés sans jeu) : un offset VOD
absent ne devient jamais 0, et la porte « sans jeu » décide sur 5 images."""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules import gameplay_gate  # noqa: E402
from services.vod_offset import parse_api_offset, usable_offset  # noqa: E402


# ─── services/vod_offset ────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, expected", [
    (None, None), ("", None), (0, None), ("0", None), (-12, None), ("abc", None),
    (379, 379), ("526", 526), (1905.6, 1905),
])
def test_parse_api_offset(raw, expected):
    assert parse_api_offset(raw) == expected


def test_usable_offset_refuses_zero_and_null():
    # 5 games d'un BO5 « à 0 » sur la même VOD de série : aucune n'est clippable
    assert usable_offset(0) is None
    assert usable_offset(None) is None
    assert usable_offset(814) == 814


def test_clip_kill_refuses_unknown_offset(monkeypatch):
    from modules import clipper

    def boom(*a, **k):
        raise AssertionError("aucun téléchargement / encodage attendu")

    monkeypatch.setattr(clipper, "_ffmpeg", boom)
    monkeypatch.setattr(clipper, "_run_ytdlp", boom)
    out = asyncio.run(clipper.clip_kill(kill_id="k1", youtube_id="yt", vod_offset_seconds=None,
                                        game_time_seconds=1769))
    assert out is None


# ─── modules/gameplay_gate : règle et repli ─────────────────────────────────

@pytest.mark.parametrize("p, verdict, n", [
    ([0.02, 0.03, 0.01, 0.05, 0.04], "pass", 0),
    ([0.98, 0.03, 0.01, 0.05, 0.04], "warn", 1),        # une coupe ponctuelle
    ([0.03, 0.04, 0.35, 0.97, 0.97], "warn", 2),        # fin de game : reste en ligne
    ([0.03, 0.04, 0.97, 0.97, 0.97], "fail", 3),        # majorité hors jeu
    ([0.99, 0.98, 0.99, 0.97, 0.99], "fail", 5),        # draft / plateau
    ([None, None, None, None, None], "skipped", 0),
])
def test_verdict_from_scores(p, verdict, n):
    assert gameplay_gate.verdict_from_scores(p) == (verdict, n)


def test_thumbnail_candidates_keep_gameplay(monkeypatch):
    monkeypatch.setattr(gameplay_gate, "score_paths", lambda paths: [0.97, 0.04, 0.06])
    assert gameplay_gate.gameplay_candidates(["stinger.jpg", "a.jpg", "b.jpg"]) == ["a.jpg", "b.jpg"]


def test_thumbnail_candidates_fall_back(monkeypatch):
    # porte indisponible -> sélecteur historique inchangé
    monkeypatch.setattr(gameplay_gate, "score_paths", lambda paths: None)
    assert gameplay_gate.gameplay_candidates(["a.jpg", "b.jpg"]) == ["a.jpg", "b.jpg"]
    # aucune candidate de jeu -> on garde tout plutôt que rien
    monkeypatch.setattr(gameplay_gate, "score_paths", lambda paths: [0.9, 0.95])
    assert gameplay_gate.gameplay_candidates(["a.jpg", "b.jpg"]) == ["a.jpg", "b.jpg"]


def test_gate_disabled_by_env(monkeypatch):
    monkeypatch.setenv("KCKILLS_GAMEPLAY_GATE", "0")
    r = asyncio.run(gameplay_gate.check_clip("nope.mp4"))
    assert r.verdict == "skipped"
