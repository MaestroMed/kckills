"""Incident du 29/09/2026 (1 149 clips publiés sans jeu) : un offset VOD
absent ne devient jamais 0, et la porte « sans jeu » décide sur 5 images."""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules import gameplay_gate  # noqa: E402
from services.vod_offset import parse_api_offset, shared_offset_game_ids, usable_offset  # noqa: E402


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


# ─── VOD + offset partagés dans un match (audit du 30/09/2026) ──────────────

def _g(gid, num, vod, off, match="m1"):
    return {"id": gid, "match_id": match, "game_number": num,
            "vod_youtube_id": vod, "vod_offset_seconds": off}


def test_shared_offset_blocks_whole_series_on_one_offset():
    # « G1 à G5 à 301 s » sur une seule VOD : au plus une est juste.
    games = [_g(f"g{i}", i, "H4F", 301) for i in range(1, 6)]
    assert shared_offset_game_ids(games) == {"g1", "g2", "g3", "g4", "g5"}


def test_series_vod_with_spaced_offsets_is_fine():
    # Vraie VOD de série : une game toutes les ~50 min.
    games = [_g("g1", 1, "V", 372), _g("g2", 2, "V", 3302), _g("g3", 3, "V", 5302)]
    assert shared_offset_game_ids(games) == set()


def test_same_game_from_two_sources_is_not_blocked():
    # Doublon de source d'une même game (même numéro) : légitime.
    games = [_g("lol", 1, "V", 474), _g("dup", 1, "V", 484)]
    assert shared_offset_game_ids(games) == set()


def test_other_match_and_unknown_offsets_are_ignored():
    games = [_g("a", 1, "V", 301), _g("b", 2, "V", 301, match="m2"),
             _g("c", 2, "W", 0), _g("d", 3, "W", 0)]
    # a/b : matchs différents ; c/d : offsets inconnus (déjà refusés ailleurs).
    assert shared_offset_game_ids(games) == set()
