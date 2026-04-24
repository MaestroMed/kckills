"""Tests for modules/qc_sampler.py (Wave 1 + Wave 3 risk-based scoring).

Coverage
--------
The qc_sampler computes a risk score per published kill from heuristic
"bumps" and queues qc.verify jobs for anything above RISK_THRESHOLD.

We focus on the pure scoring function `compute_qc_risk` because it
encodes ALL the policy. The daemon's I/O is just plumbing around it.

Tests:
  * baseline (no bumps) → 0.0 (modulo random 2% bonus, which we lock by
    seeding random)
  * pending_report_count = 0 → no user-reported bump
  * pending_report_count = 1 → +1.0 (RISK_USER_REPORTED)
  * pending_report_count = 5 → +1.0 + +0.5 (heavy user-report bump)
  * gol_gg data source → +0.3
  * extreme highlight_score (high & low) → +0.3
  * vof2-discovered offset on asset → +0.5
  * weird duration (<15s or >30s) → +0.4
  * first kill from a brand-new VOD → +0.4
  * low ai confidence_score → +0.5
  * legacy `user_reported=True` (no count) → treated as 1 report
  * combination test: very-bad clip exceeds RISK_THRESHOLD by a lot
  * baseline random bump frequency holds for the threshold

The daemon enqueue helper is also tested with a mocked job_queue.

Strategy
--------
random.random is seeded inside each test so the 2% baseline bump is
deterministic. Helper fns reading PostgREST aren't tested directly —
covered by pipeline_jobs e2e + qc_sampler is mostly pure logic above
the I/O layer.
"""

from __future__ import annotations

import os
import random
import sys
from unittest.mock import MagicMock, patch

import pytest

# Add worker root to sys.path before importing.
_WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _WORKER_ROOT)

# Stub env so config.py doesn't refuse to import.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ─── Helper: kill a baseline kill dict ───────────────────────────────


def _baseline_kill(**overrides):
    """Return a kill dict that triggers ZERO risk bumps by default."""
    base = {
        "id": "kill-test-baseline",
        "data_source": "livestats",         # not gol_gg
        "highlight_score": 6.0,             # not extreme (not >=9 or <=3)
        "vod_youtube_id": "yt-abc",
        "duration_ms": 22_000,              # within [15s, 30s]
        "kill_visible": True,
    }
    base.update(overrides)
    return base


def _seed_no_random_bump(monkeypatch):
    """Force random.random() > 0.02 so the baseline bump never fires."""
    from modules import qc_sampler
    monkeypatch.setattr(qc_sampler.random, "random", lambda: 0.99)


def _seed_force_random_bump(monkeypatch):
    """Force random.random() < 0.02 so the baseline bump always fires."""
    from modules import qc_sampler
    monkeypatch.setattr(qc_sampler.random, "random", lambda: 0.001)


# ─── Pure-scoring tests ──────────────────────────────────────────────


def test_baseline_kill_with_no_random_bump_scores_zero(monkeypatch):
    """A clean kill with no risk signals + random bump suppressed = 0."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk

    score = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},  # already verified — no first-from-VOD bump
    )
    assert score == 0.0


def test_zero_reports_no_user_report_bump(monkeypatch):
    """pending_report_count=0 → user-report bump must NOT fire."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk

    score = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
        pending_report_count=0,
    )
    assert score == 0.0, "no reports → no bump"


def test_single_pending_report_adds_user_reported_bump(monkeypatch):
    """1 pending report → +1.0 (RISK_USER_REPORTED)."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_USER_REPORTED

    score = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
        pending_report_count=1,
    )
    assert score == pytest.approx(RISK_USER_REPORTED), (
        f"expected {RISK_USER_REPORTED}, got {score}"
    )


def test_heavy_user_report_count_adds_extra_bump(monkeypatch):
    """5 pending reports (>=3) → +1.0 + +0.5 = 1.5."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import (
        compute_qc_risk, RISK_USER_REPORTED, RISK_USER_REPORTED_HEAVY,
    )

    score = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
        pending_report_count=5,
    )
    expected = RISK_USER_REPORTED + RISK_USER_REPORTED_HEAVY
    assert score == pytest.approx(expected), (
        f"expected {expected}, got {score}"
    )


def test_user_reports_increase_score_monotonically(monkeypatch):
    """Risk score MUST increase with reports.report_count.

    Property: score(0) < score(1) <= score(2) < score(3) <= score(5).
    """
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk

    scores = {
        n: compute_qc_risk(
            _baseline_kill(),
            asset=None,
            annotation=None,
            verified_vods={"yt-abc"},
            pending_report_count=n,
        )
        for n in (0, 1, 2, 3, 5)
    }

    assert scores[0] < scores[1]
    assert scores[1] == scores[2]   # both single-report bumps, no heavy
    assert scores[2] < scores[3]   # heavy threshold = 3
    assert scores[3] == scores[5]  # both heavy


def test_user_reported_clip_jumps_above_risk_threshold(monkeypatch):
    """A clean clip with 1+ user report must score above RISK_THRESHOLD,
    so it gets queued for QC regardless of any other heuristic."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_THRESHOLD

    score = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
        pending_report_count=1,
    )
    assert score >= RISK_THRESHOLD, (
        f"single user report ({score}) must clear RISK_THRESHOLD={RISK_THRESHOLD}"
    )


def test_legacy_user_reported_flag_treated_as_one_report(monkeypatch):
    """Backward-compat: callers passing user_reported=True without a
    pending_report_count get exactly +1.0."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_USER_REPORTED

    score_legacy = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
        user_reported=True,
        pending_report_count=0,
    )
    assert score_legacy == pytest.approx(RISK_USER_REPORTED)


# ─── Other risk bumps ────────────────────────────────────────────────


def test_gol_gg_data_source_bump(monkeypatch):
    """data_source='gol_gg' → +0.3."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_GOLGG_SOURCE

    score = compute_qc_risk(
        _baseline_kill(data_source="gol_gg"),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
    )
    assert score == pytest.approx(RISK_GOLGG_SOURCE)


def test_extreme_highlight_score_high(monkeypatch):
    """highlight_score >= 9 → +0.3."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_EXTREME_SCORE

    score = compute_qc_risk(
        _baseline_kill(highlight_score=9.5),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
    )
    assert score == pytest.approx(RISK_EXTREME_SCORE)


def test_extreme_highlight_score_low(monkeypatch):
    """highlight_score <= 3 → +0.3."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_EXTREME_SCORE

    score = compute_qc_risk(
        _baseline_kill(highlight_score=2.5),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
    )
    assert score == pytest.approx(RISK_EXTREME_SCORE)


def test_vof2_offset_bump(monkeypatch):
    """asset.source_offset_seconds non-null (vof2 path) → +0.5."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_VOF2_OFFSET

    asset = {"source_offset_seconds": 1247, "duration_ms": 22_000}
    score = compute_qc_risk(
        _baseline_kill(),
        asset=asset,
        annotation=None,
        verified_vods={"yt-abc"},
    )
    assert score == pytest.approx(RISK_VOF2_OFFSET)


def test_weird_duration_bump(monkeypatch):
    """duration_ms < 15000 OR > 30000 → +0.4."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_WEIRD_DURATION

    # short
    asset_short = {"source_offset_seconds": None, "duration_ms": 8_000}
    score = compute_qc_risk(
        _baseline_kill(),
        asset=asset_short,
        annotation=None,
        verified_vods={"yt-abc"},
    )
    assert score == pytest.approx(RISK_WEIRD_DURATION)

    # long
    asset_long = {"source_offset_seconds": None, "duration_ms": 45_000}
    score = compute_qc_risk(
        _baseline_kill(),
        asset=asset_long,
        annotation=None,
        verified_vods={"yt-abc"},
    )
    assert score == pytest.approx(RISK_WEIRD_DURATION)


def test_first_from_vod_bump_when_vod_not_in_verified_set(monkeypatch):
    """vod_youtube_id NOT in verified_vods → +0.4."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_FIRST_FROM_VOD

    score = compute_qc_risk(
        _baseline_kill(vod_youtube_id="yt-fresh"),
        asset=None,
        annotation=None,
        verified_vods=set(),  # empty — fresh VOD
    )
    assert score == pytest.approx(RISK_FIRST_FROM_VOD)


def test_low_confidence_annotation_bump(monkeypatch):
    """ai_annotations.confidence_score < 0.5 → +0.5."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk, RISK_LOW_CONFIDENCE

    annotation = {"confidence_score": 0.3}
    score = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=annotation,
        verified_vods={"yt-abc"},
    )
    assert score == pytest.approx(RISK_LOW_CONFIDENCE)


def test_combination_bumps_sum_correctly(monkeypatch):
    """A clip with 3 risk signals: gol_gg + extreme score + 1 user report
    should sum to 0.3 + 0.3 + 1.0 = 1.6."""
    _seed_no_random_bump(monkeypatch)
    from modules.qc_sampler import (
        compute_qc_risk, RISK_GOLGG_SOURCE, RISK_EXTREME_SCORE,
        RISK_USER_REPORTED,
    )

    score = compute_qc_risk(
        _baseline_kill(data_source="gol_gg", highlight_score=9.5),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
        pending_report_count=1,
    )
    expected = RISK_GOLGG_SOURCE + RISK_EXTREME_SCORE + RISK_USER_REPORTED
    assert score == pytest.approx(expected)


# ─── Random sampling baseline ────────────────────────────────────────


def test_random_baseline_adds_one_when_random_below_rate(monkeypatch):
    """When random.random() returns a value below RANDOM_BASELINE_RATE,
    +1.0 is added. This is the unbiased coverage path for clean clips
    that never get otherwise-flagged."""
    _seed_force_random_bump(monkeypatch)
    from modules.qc_sampler import compute_qc_risk

    score = compute_qc_risk(
        _baseline_kill(),
        asset=None,
        annotation=None,
        verified_vods={"yt-abc"},
    )
    # +1.0 from the baseline only — no other bumps.
    assert score == pytest.approx(1.0)


# ─── Daemon enqueue helper (mocked job_queue) ────────────────────────


def test_enqueue_qc_job_calls_pipeline_jobs_with_payload(monkeypatch):
    """_enqueue_qc_job builds the right payload (source + risk_score)
    and uses the qc.verify type."""
    from modules import qc_sampler

    captured: dict = {}

    def fake_enqueue(job_type, *, entity_type, entity_id, payload, priority):
        captured["job_type"] = job_type
        captured["entity_type"] = entity_type
        captured["entity_id"] = entity_id
        captured["payload"] = payload
        captured["priority"] = priority
        return "fake-job-uuid"

    monkeypatch.setattr(qc_sampler.job_queue, "enqueue", fake_enqueue)

    job_id = qc_sampler._enqueue_qc_job("kill-xyz", 1.234)
    assert job_id == "fake-job-uuid"
    assert captured["job_type"] == "qc.verify"
    assert captured["entity_type"] == "kill"
    assert captured["entity_id"] == "kill-xyz"
    assert captured["payload"]["source"] == "qc_sampler"
    assert captured["payload"]["risk_score"] == 1.234
    assert captured["priority"] == 60


# ─── Manual main runner ──────────────────────────────────────────────

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "-s"]))
