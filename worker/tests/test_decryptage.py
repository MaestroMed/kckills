"""Tests modules/decryptage.py — fit du modèle de drift, résolution,
dégradation sans Gemini.

Les valeurs piecewise reproduisent worker/vod_time_maps.json (prototype
reclip_calibrated) : offset observé 3509 → 3525 → 3562 sur une même game.
"""
from __future__ import annotations

import pytest

from modules import decryptage
from modules.decryptage import (
    DriftSample,
    ProbeBudget,
    decrypt_source,
    fit_drift_model,
    reject_outliers,
    resolve_vod_time,
)


def _s(gt, vt, method="gemini", conf=0.95):
    return DriftSample(
        game_time=gt, vod_time=vt,
        timer_read=f"{gt // 60}:{gt % 60:02d}",
        method=method, confidence=conf,
    )


# ─── fit : constant ───────────────────────────────────────────────────

def test_fit_constant_model_lec_official():
    """VOD LEC : offset stable sur toute la game → 1 segment."""
    samples = [_s(gt, gt + 3509) for gt in (120, 600, 1200, 1800, 2100)]
    model, conf = fit_drift_model(samples)
    assert model.type == "constant"
    assert len(model.segments) == 1
    assert model.segments[0]["offset"] == pytest.approx(3509, abs=0.5)
    assert model.breakpoints == []
    assert conf > 0.8


def test_fit_piecewise_with_pause_jumps():
    """Le cas réel vod_time_maps : 3509 → 3525 → 3562 (2 pauses)."""
    samples = [
        _s(173, 3682),    # offset 3509
        _s(457, 3982),    # offset 3525
        _s(773, 4298),    # offset 3525
        _s(1320, 4882),   # offset 3562
        _s(1620, 5182),   # offset 3562
    ]
    model, conf = fit_drift_model(samples)
    assert model.type == "piecewise"
    assert len(model.segments) == 3
    offsets = [seg["offset"] for seg in model.segments]
    assert offsets == pytest.approx([3509, 3525, 3562], abs=0.5)
    # 2 zones d'incertitude : entre 173-457 et entre 773-1320
    assert len(model.breakpoints) == 2
    assert model.breakpoints[0] == [173.0, 457.0]
    assert model.breakpoints[1] == [773.0, 1320.0]


def test_outlier_rejected_before_fit():
    """Une lecture aberrante (replay à l'écran) ne casse pas le fit."""
    samples = [_s(gt, gt + 3500) for gt in (120, 600, 1200, 1800)]
    samples.append(_s(900, 900 + 7200))   # replay : offset délirant
    kept, rejected = reject_outliers(sorted(samples, key=lambda s: s.game_time))
    assert len(rejected) == 1
    assert rejected[0].game_time == 900

    model, conf = fit_drift_model(samples)
    assert model.type == "constant"
    assert model.segments[0]["offset"] == pytest.approx(3500, abs=0.5)


# ─── résolution ───────────────────────────────────────────────────────

def test_resolve_inside_segment():
    samples = [_s(gt, gt + 3509) for gt in (120, 900, 1800)]
    model, _ = fit_drift_model(samples)
    r = resolve_vod_time(model, 1000)
    assert r.vod_time == pytest.approx(4509, abs=1)
    assert not r.in_uncertainty_zone
    assert r.confidence > 0.8


def test_resolve_flags_uncertainty_zone():
    """Un kill entre deux segments divergents doit être signalé."""
    samples = [
        _s(173, 3682), _s(457, 3982), _s(773, 4298),
        _s(1320, 4882), _s(1620, 5182),
    ]
    model, _ = fit_drift_model(samples)
    r = resolve_vod_time(model, 1000)   # entre 773 et 1320
    assert r.in_uncertainty_zone
    assert r.confidence < 0.5
    # un kill au cœur d'un segment reste confiant
    r2 = resolve_vod_time(model, 500)
    assert not r2.in_uncertainty_zone
    assert r2.offset == pytest.approx(3525, abs=0.5)


def test_resolve_from_json_roundtrip():
    """Le modèle relu depuis game_vod_sources (JSONB) doit résoudre pareil."""
    samples = [_s(gt, gt + 3509) for gt in (120, 900, 1800)]
    model, _ = fit_drift_model(samples)
    as_json = model.to_json()
    r = resolve_vod_time(as_json, 1500)
    assert r.vod_time == pytest.approx(1500 + 3509, abs=1)


# ─── dégradation sans Gemini ──────────────────────────────────────────

async def test_official_vod_degrades_to_epoch_offset(monkeypatch):
    """Quota Gemini mort + OCR non calibré : la VOD officielle produit
    quand même un modèle exploitable depuis l'offset officiel."""

    async def _no_vision(*args, **kwargs):
        return None

    monkeypatch.setattr(decryptage, "read_timer_at", _no_vision)

    model, conf, samples, method = await decrypt_source(
        game={"id": "g1", "duration_seconds": 1800},
        source_video="C:/fake/vod.mp4",
        offset_hint=3600,
        duration_seconds=1800,
        budget=ProbeBudget(0),
        is_official=True,
    )
    assert method == "official_epoch"
    assert model.type == "constant"
    assert model.segments[0]["offset"] == 3600
    assert conf == 0.5
    assert samples == []
    r = resolve_vod_time(model, 900)
    assert r.vod_time == 900 + 3600


async def test_non_official_without_vision_defers(monkeypatch):
    """Source non-officielle sans vision : on REPORTE au lieu de produire
    un offset faux."""

    async def _no_vision(*args, **kwargs):
        return None

    monkeypatch.setattr(decryptage, "read_timer_at", _no_vision)

    model, conf, samples, method = await decrypt_source(
        game={"id": "g1", "duration_seconds": 1800},
        source_video="C:/fake/kameto.mp4",
        offset_hint=1200,
        duration_seconds=1800,
        budget=ProbeBudget(0),
        is_official=False,
    )
    assert model is None
    assert method == "none"


async def test_partial_samples_low_confidence(monkeypatch):
    """1-2 lectures seulement → modèle rendu mais confiance plafonnée."""
    reads = {1590: _s(1590, 1590 + 3500)}
    calls = {"n": 0}

    async def _one_read(source, vod_seconds, budget, tmp_dir=None):
        calls["n"] += 1
        # seule la probe ~95 % répond (les autres tombent sur du replay)
        for gt, sample in reads.items():
            if abs(vod_seconds - (gt + 3500)) < 200:
                return sample
        return None

    monkeypatch.setattr(decryptage, "read_timer_at", _one_read)

    model, conf, samples, method = await decrypt_source(
        game={"id": "g1", "duration_seconds": 1800},
        source_video="C:/fake/vod.mp4",
        offset_hint=3500,
        duration_seconds=1800,
        budget=ProbeBudget(10),
        is_official=True,
    )
    assert model is not None
    assert method == "single_point_legacy"
    assert conf <= 0.55


# ─── budget ───────────────────────────────────────────────────────────

def test_probe_budget_exhausts():
    b = ProbeBudget(2)
    assert b.take_gemini() and b.take_gemini()
    assert not b.take_gemini()
