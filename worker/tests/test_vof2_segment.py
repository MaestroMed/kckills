"""vod_offset_finder_v2 — recherche bornée au segment API de la game (30/09/2026).

Sur une VOD de série, l'ancienne recherche prenait le premier chrono lisible :
le départ de la G1 pour toutes les games. On vérifie que le balayage n'accepte
qu'un départ situé dans le segment de la game, et qu'un offset qui entre en
collision avec une autre game du match n'est jamais écrit.
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules import vod_offset_finder_v2 as vof2  # noqa: E402


def _timer_from(game_starts: list[int], replay_until: int = 0):
    """Faux lecteur de chrono : VOD de série dont les games démarrent aux
    offsets donnés (35 min chacune) ; avant `replay_until`, on voit un
    replay de la game précédente (chrono de la G1 figé à 30:00)."""
    async def read(_yt, t):
        if t < replay_until:
            return 1800
        for s in sorted(game_starts, reverse=True):
            if s <= t <= s + 35 * 60:
                return t - s
        return None
    return read


def test_segment_scan_finds_second_game(monkeypatch):
    # G1 à 360 s, G2 à 2800 s ; segment API de la G2 débutant à 2450 s.
    monkeypatch.setattr(vof2, "_read_timer_at", _timer_from([360, 2800]))
    assert asyncio.run(vof2._scan_segment("yt", 2450.0, 4800.0, "g2")) == 2800


def test_segment_scan_rejects_previous_game_replay(monkeypatch):
    # Un replay de la G1 (chrono 30:00) au début du segment de la G2 donnerait
    # un départ bien avant le segment : refusé, on continue jusqu'à la G2.
    monkeypatch.setattr(vof2, "_read_timer_at", _timer_from([360, 2800], replay_until=3100))
    assert asyncio.run(vof2._scan_segment("yt", 2450.0, 4800.0, "g2")) == 2800


def test_segment_scan_gives_up_without_readable_timer(monkeypatch):
    async def never(_yt, _t):
        return None
    monkeypatch.setattr(vof2, "_read_timer_at", never)
    assert asyncio.run(vof2._scan_segment("yt", 100.0, 1200.0, "g")) is None


def test_offset_collision_with_sibling_game(monkeypatch):
    siblings = [
        {"id": "g1", "game_number": 1, "vod_youtube_id": "V", "vod_offset_seconds": 360},
        {"id": "g2", "game_number": 2, "vod_youtube_id": "V", "vod_offset_seconds": None},
    ]
    monkeypatch.setattr(vof2, "safe_select", lambda *a, **k: siblings)
    g2 = {"id": "g2", "match_id": "m", "game_number": 2, "vod_youtube_id": "V"}
    assert vof2._offset_collides(g2, 365) is True       # le départ de la G1
    assert vof2._offset_collides(g2, 2800) is False     # le vrai départ de la G2


def test_same_game_duplicate_source_does_not_collide(monkeypatch):
    siblings = [{"id": "lol", "game_number": 1, "vod_youtube_id": "V", "vod_offset_seconds": 474}]
    monkeypatch.setattr(vof2, "safe_select", lambda *a, **k: siblings)
    dup = {"id": "dup", "match_id": "m", "game_number": 1, "vod_youtube_id": "V"}
    assert vof2._offset_collides(dup, 484) is False
