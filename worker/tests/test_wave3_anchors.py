"""Tests vague 3 — killfeed (détection de bursts) + audio_sync
(corrélation croisée). Maths pures sur signaux synthétiques, pas de
ffmpeg ni de réseau."""
from __future__ import annotations

import pytest

np = pytest.importorskip("numpy")

from modules.killfeed import detect_bursts, BURST_Z_THRESHOLD  # noqa: E402
from modules.audio_sync import correlate_offset, SAMPLE_RATE  # noqa: E402


# ─── killfeed : détection de bursts ───────────────────────────────────

def test_detect_bursts_finds_spike():
    """Fond quasi statique + une bannière à t=10 s (fps=2 → index 20)."""
    series = [1.0 + 0.1 * (i % 3) for i in range(60)]
    series[20] = 9.0
    series[21] = 7.5
    bursts = detect_bursts(series, fps=2)
    assert len(bursts) == 1
    assert bursts[0] == pytest.approx(10.0, abs=0.5)


def test_detect_bursts_merges_consecutive_frames():
    """Une bannière animée sur 2 s = frames consécutives chaudes = UN burst."""
    series = [1.0] * 40
    for i in (12, 13, 14, 15):
        series[i] = 8.0
    bursts = detect_bursts(series, fps=2)
    assert len(bursts) == 1


def test_detect_bursts_two_separate_kills():
    series = [1.0] * 60
    series[10] = 9.0
    series[40] = 9.0
    bursts = detect_bursts(series, fps=2)
    assert len(bursts) == 2
    assert bursts == pytest.approx([5.0, 20.0], abs=0.5)


def test_detect_bursts_flat_noise_no_false_positive():
    """Du bruit uniforme ne doit produire AUCUN burst (MAD robuste)."""
    rng = np.random.default_rng(42)
    series = list(1.0 + rng.normal(0, 0.05, 80))
    assert detect_bursts(series, fps=2) == []


def test_detect_bursts_short_series_rejected():
    assert detect_bursts([1, 9, 1], fps=2) == []


# ─── audio_sync : corrélation croisée ─────────────────────────────────

def _noise(n, seed):
    rng = np.random.default_rng(seed)
    return rng.normal(0, 1, n).astype(np.float32)


def test_correlate_finds_known_lag():
    """ref enfoui dans cand à 7.5 s : le lag retrouvé est exact."""
    sr = SAMPLE_RATE
    ref = _noise(sr * 3, seed=1)
    cand = _noise(sr * 20, seed=2) * 0.3
    lag_true = int(7.5 * sr)
    cand[lag_true:lag_true + len(ref)] += ref
    lag, score = correlate_offset(ref, cand, sr)
    assert lag == pytest.approx(7.5, abs=0.01)
    assert score > 0.5


def test_correlate_mixed_with_other_voice():
    """Le cas réel : le son du jeu commun + une voix différente par
    source (caster vs Kameto). La composante commune suffit."""
    sr = SAMPLE_RATE
    game_audio = _noise(sr * 25, seed=3)
    caster = _noise(sr * 25, seed=4)
    kameto = _noise(sr * 25, seed=5)
    official = game_audio + 0.8 * caster
    alt = np.roll(game_audio, int(4.2 * sr)) + 0.8 * kameto
    ref = official[int(10 * sr):int(13 * sr)]          # extrait à t=10
    lag, score = correlate_offset(ref, alt.astype(np.float32), sr)
    # le même contenu jeu est à t=10+4.2=14.2 dans alt
    assert lag == pytest.approx(14.2, abs=0.05)
    assert score > 0.2


def test_correlate_unrelated_low_score():
    """Deux audios sans rien en commun → score faible, pas de verdict."""
    sr = SAMPLE_RATE
    ref = _noise(sr * 3, seed=10)
    cand = _noise(sr * 20, seed=11)
    lag, score = correlate_offset(ref, cand, sr)
    assert score < 0.15


def test_correlate_guards():
    sr = SAMPLE_RATE
    assert correlate_offset(None, _noise(sr * 5, 1), sr) == (None, 0.0)
    # ref plus long que cand → invalide
    lag, score = correlate_offset(_noise(sr * 10, 1), _noise(sr * 5, 2), sr)
    assert lag is None