"""Tests modules/dedup.py — doublons exacts + collapse multi-kill.

Cas réels de l'audit 2026-07-14 :
  * même mort (epoch identique ms) insérée ~340× (player_id NULL) ;
  * triple Kaisa gol.gg (epoch=0) publié en 3 clips séparés
    (solo Renekton gt=1502 double, Orianna gt=1504 triple).
"""
from __future__ import annotations

import pytest

from modules.dedup import (
    build_dedup_plan,
    collapse_sequence,
    find_exact_duplicates,
    find_multikill_sequences,
)


def _k(i, *, epoch=0, gt=None, killer="p1", kc="Ahri", vc="Zed",
       mk=None, status="raw", urls=False, created="2026-07-01T00:00:00"):
    return {
        "id": f"kill-{i}",
        "game_id": "game-1",
        "event_epoch": epoch,
        "game_time_seconds": gt,
        "killer_player_id": killer,
        "killer_champion": kc,
        "victim_champion": vc,
        "multi_kill": mk,
        "status": status,
        "clip_url_vertical": "https://r2/x.mp4" if urls else None,
        "highlight_score": 7.0 if urls else None,
        "created_at": created,
    }


# ─── doublons exacts ──────────────────────────────────────────────────

def test_exact_duplicates_same_epoch_collapse_to_published_keeper():
    """340 copies de la même mort : le keeper est la ligne published."""
    e = 1769975989788
    kills = [_k(i, epoch=e, gt=669, killer=None, kc="DrMundo", vc="Jayce")
             for i in range(10)]
    kills[3]["status"] = "published"
    kills[3]["clip_url_vertical"] = "https://r2/pub.mp4"
    kills[7]["status"] = "analyzed"

    plan = build_dedup_plan(kills)
    dups = plan.duplicates
    assert len(dups) == 9
    assert all(d.duplicate_of == "kill-3" for d in dups)
    assert all(d.reason == "exact_dup" for d in dups)
    # le keeper n'est jamais neutralisé
    assert plan.keeper_of("kill-3") is None


def test_exact_duplicates_epoch_zero_fuzzy_key():
    """gol.gg epoch=0 : même (killer, victim) à ±10 s de game_time."""
    kills = [
        _k(1, epoch=0, gt=1473, kc="Kaisa", vc="Nami"),
        _k(2, epoch=0, gt=1479, kc="Kaisa", vc="Nami"),   # +6 s → doublon
        _k(3, epoch=0, gt=1538, kc="Kaisa", vc="Nami"),   # +59 s → distinct
    ]
    groups = find_exact_duplicates(kills)
    assert len(groups) == 1
    assert {k["id"] for k in groups[0]} == {"kill-1", "kill-2"}


def test_no_duplicate_across_different_victims():
    kills = [
        _k(1, epoch=100_000, vc="Zed"),
        _k(2, epoch=100_000, vc="Ahri"),
    ]
    assert find_exact_duplicates(kills) == []


def test_idempotent_on_already_neutralized():
    e = 55_000
    kills = [
        _k(1, epoch=e, status="published", urls=True),
        _k(2, epoch=e, status="duplicate"),
    ]
    plan = build_dedup_plan(kills)
    assert plan.duplicates == []


# ─── séquences multi-kill ─────────────────────────────────────────────

def test_multikill_sequence_detected_within_gap():
    base = 1_700_000_000_000
    kills = [
        _k(1, epoch=base, vc="Zed"),
        _k(2, epoch=base + 8_000, vc="Ahri", mk="double"),
        _k(3, epoch=base + 15_000, vc="Lux", mk="triple"),
        _k(4, epoch=base + 60_000, vc="Jinx"),            # hors fenêtre
    ]
    seqs = find_multikill_sequences(kills)
    assert len(seqs) == 1
    assert [k["id"] for k in seqs[0]] == ["kill-1", "kill-2", "kill-3"]


def test_collapse_keeps_max_tier_and_absorbs_subtiers():
    base = 1_700_000_000_000
    kills = [
        _k(1, epoch=base, vc="Zed"),
        _k(2, epoch=base + 8_000, vc="Ahri", mk="double"),
        _k(3, epoch=base + 15_000, vc="Lux", mk="triple"),
    ]
    info = collapse_sequence(kills)
    assert info.canonical_kill_id == "kill-3"
    assert set(info.absorbed_kill_ids) == {"kill-1", "kill-2"}
    assert info.tier == 3
    assert info.sequence_start_epoch == base
    assert info.sequence_end_epoch == base + 15_000


def test_collapse_infers_tier_when_unlabeled():
    """3 morts en 12 s jamais étiquetées → triple inféré + correction."""
    base = 1_700_000_000_000
    kills = [
        _k(1, epoch=base, vc="Zed"),
        _k(2, epoch=base + 5_000, vc="Ahri"),
        _k(3, epoch=base + 11_000, vc="Lux"),
    ]
    info = collapse_sequence(kills)
    assert info.tier == 3
    assert info.inferred_label == "triple"


def test_collapse_prefers_published_canonical():
    """À tier égal, on ne détrône pas un clip déjà publié."""
    base = 1_700_000_000_000
    kills = [
        _k(1, epoch=base, vc="Zed", mk="double", status="published", urls=True),
        _k(2, epoch=base + 6_000, vc="Ahri", mk="double", status="raw"),
    ]
    info = collapse_sequence(kills)
    assert info.canonical_kill_id == "kill-1"


def test_golgg_epoch_zero_sequence_via_game_time():
    """Le cas Kaisa de l'audit : epoch=0, séquence par game_time."""
    kills = [
        _k(1, epoch=0, gt=1496, kc="Kaisa", vc="Wukong", status="clipped"),
        _k(2, epoch=0, gt=1502, kc="Kaisa", vc="Renekton", mk="double",
           status="published", urls=True),
        _k(3, epoch=0, gt=1504, kc="Kaisa", vc="Orianna", mk="triple",
           status="published", urls=True),
    ]
    plan = build_dedup_plan(kills)
    seq = plan.sequences[0]
    assert seq.canonical_kill_id == "kill-3"          # le triple
    assert set(seq.absorbed_kill_ids) == {"kill-1", "kill-2"}
    dup_ids = {a.kill_id for a in plan.duplicates}
    assert dup_ids == {"kill-1", "kill-2"}
    assert all(a.reason == "subtier" for a in plan.duplicates)


def test_exact_dups_then_sequence_compose():
    """Phase 1 neutralise les copies, phase 2 collapse les survivants."""
    base = 1_700_000_000_000
    kills = [
        _k(1, epoch=base, vc="Zed", status="published", urls=True),
        _k("1b", epoch=base, vc="Zed"),                    # copie exacte
        _k(2, epoch=base + 7_000, vc="Ahri", mk="double",
           status="published", urls=True),
    ]
    plan = build_dedup_plan(kills)
    reasons = {a.kill_id: a.reason for a in plan.duplicates}
    assert reasons["kill-1b"] == "exact_dup"
    assert reasons["kill-1"] == "subtier"
    assert plan.sequences[0].canonical_kill_id == "kill-2"


def test_different_killers_never_sequence():
    base = 1_700_000_000_000
    kills = [
        _k(1, epoch=base, killer="p1", vc="Zed"),
        _k(2, epoch=base + 4_000, killer="p2", kc="Jinx", vc="Ahri"),
    ]
    assert find_multikill_sequences(kills) == []
