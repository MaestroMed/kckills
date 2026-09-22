"""FrameKillMatcher (2026-09-23) : multi-kills sur frames réelles du feed.

Fixtures = frames livestats capturées autour des 4 séries du Summer 2026
que l'ancien diff par fenêtre de 10 s écrasait en un seul kill.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules.feed_clock import FeedClock, clock_from_states  # noqa: E402
from modules.harvester import FrameKillMatcher, _detect_kc_side, assign_multikill_labels  # noqa: E402
from services import livestats_api  # noqa: E402

FIX = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures", "livestats", "multikills")


def _run(name: str):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        d = json.load(f)
    participants = livestats_api.extract_participants({"gameMetadata": d["gameMetadata"]})
    kc_side = _detect_kc_side(participants)
    m = FrameKillMatcher(participants, "game-test", kc_side)
    kills = []
    for fr in d["frames"]:
        kills.extend(m.feed(fr))
    kills.extend(m.flush())
    assign_multikill_labels(kills)
    return kills, m


def _series(kills, champion):
    return [(k.victim_champion, k.multi_kill) for k in kills if k.killer_champion == champion]


def test_penta_canna_gx_playoffs():
    kills, m = _run("GX_PO_G1_Canna_x5.json")
    assert _series(kills, "Jayce") == [
        ("Cassiopeia", None), ("Lucian", None), ("Skarner", None),
        ("Milio", None), ("Yorick", "penta"),
    ]
    assert all(k.confidence == "high" for k in kills if k.killer_champion == "Jayce")
    assert m.unmatched_kills == 0


def test_quadra_caliste_vs_g2():
    kills, _ = _run("G2_G3_Caliste_x4.json")
    assert _series(kills, "Caitlyn") == [
        ("Olaf", None), ("Anivia", None), ("Taric", None), ("Lucian", "quadra"),
    ]
    # les deux kills adverses sur KC sont gardés (team_victim) : un double
    lucian = [k for k in kills if k.killer_champion == "Lucian"]
    assert [k.tracked_team_involvement for k in lucian] == ["team_victim", "team_victim"]
    assert [k.multi_kill for k in lucian] == [None, "double"]


def test_quadra_yike_vs_gx_then_caliste_takes_fifth():
    kills, _ = _run("GX_G2_Yike_x4.json")
    assert _series(kills, "Qiyana") == [
        ("Syndra", None), ("Lucian", None), ("Milio", None), ("Poppy", "quadra"),
    ]
    assert _series(kills, "Xayah") == [("MonkeyKing", None)]


def test_caliste_vs_fnc_is_a_triple_not_a_quadra():
    # 1er kill à 11,45 s du 2e : hors fenêtre de 10 s -> la série repart.
    kills, _ = _run("FNC_G2_Caliste_x4.json")
    assert _series(kills, "Kalista") == [
        ("Ziggs", None), ("Olaf", None), ("Ryze", None), ("Shen", "triple"),
    ]


def test_epochs_are_frame_precise_and_ordered():
    kills, _ = _run("GX_PO_G1_Canna_x5.json")
    epochs = [k.event_epoch for k in kills]
    assert epochs == sorted(epochs)
    jayce = [k.event_epoch for k in kills if k.killer_champion == "Jayce"]
    # 14:04:07.015 -> 14:04:07.623 : deux kills à 0,6 s d'écart, distincts
    assert jayce[2] - jayce[1] == 608


# ─── Cas synthétiques ───────────────────────────────────────────────────────

PARTS = {
    "1": {"name": "KC Canna", "champion": "Jayce", "side": "blue"},
    "2": {"name": "KC Yike", "champion": "Vi", "side": "blue"},
    "6": {"name": "GX Jun", "champion": "Milio", "side": "red"},
    "7": {"name": "GX Flakked", "champion": "Lucian", "side": "red"},
}


def _frame(ts, kda, state="in_game"):
    blue = [{"participantId": int(p), "kills": k, "deaths": d, "assists": a}
            for p, (k, d, a) in kda.items() if PARTS[p]["side"] == "blue"]
    red = [{"participantId": int(p), "kills": k, "deaths": d, "assists": a}
           for p, (k, d, a) in kda.items() if PARTS[p]["side"] == "red"]
    return {"rfc460Timestamp": ts, "gameState": state,
            "blueTeam": {"participants": blue}, "redTeam": {"participants": red}}


Z = {"1": (0, 0, 0), "2": (0, 0, 0), "6": (0, 0, 0), "7": (0, 0, 0)}


def test_death_one_frame_late_is_still_paired():
    m = FrameKillMatcher(PARTS, "g", "blue")
    out = m.feed(_frame("2026-01-01T00:00:00.000Z", Z))
    out += m.feed(_frame("2026-01-01T00:00:01.000Z", {**Z, "1": (1, 0, 0)}))
    out += m.feed(_frame("2026-01-01T00:00:01.300Z", {**Z, "1": (1, 0, 0), "7": (0, 1, 0)}))
    out += m.flush()
    assert [(k.killer_champion, k.victim_champion, k.confidence) for k in out] == [("Jayce", "Lucian", "high")]
    assert out[0].is_first_blood


def test_execution_death_is_ignored():
    m = FrameKillMatcher(PARTS, "g", "blue")
    m.feed(_frame("2026-01-01T00:00:00.000Z", Z))
    out = m.feed(_frame("2026-01-01T00:00:05.000Z", {**Z, "2": (0, 1, 0)}))   # tour
    out += m.feed(_frame("2026-01-01T00:00:20.000Z", {**Z, "2": (0, 1, 0)}))
    out += m.flush()
    assert out == [] and m.orphan_deaths == 1


def test_duplicate_frames_between_windows_are_skipped():
    m = FrameKillMatcher(PARTS, "g", "blue")
    f0 = _frame("2026-01-01T00:00:00.000Z", Z)
    f1 = _frame("2026-01-01T00:00:02.000Z", {**Z, "1": (1, 0, 0), "6": (0, 1, 0)})
    out = m.feed(f0) + m.feed(f1) + m.feed(f1) + m.feed(f0) + m.flush()
    assert len(out) == 1


def test_unmatched_kill_is_kept_with_low_confidence():
    m = FrameKillMatcher(PARTS, "g", "blue")
    m.feed(_frame("2026-01-01T00:00:00.000Z", Z))
    out = m.feed(_frame("2026-01-01T00:00:02.000Z", {**Z, "1": (1, 0, 0)}))
    out += m.feed(_frame("2026-01-01T00:00:09.000Z", {**Z, "1": (1, 0, 0)}))
    assert [(k.killer_champion, k.victim_champion, k.confidence) for k in out] == [("Jayce", None, "low")]
    assert m.unmatched_kills == 1


def test_enemy_kill_without_visible_victim_is_kept_as_team_victim():
    m = FrameKillMatcher(PARTS, "g", "blue")
    m.feed(_frame("2026-01-01T00:00:00.000Z", Z))
    out = m.feed(_frame("2026-01-01T00:00:02.000Z", {**Z, "6": (1, 0, 0)}))
    out += m.flush()
    assert [(k.killer_champion, k.tracked_team_involvement, k.confidence) for k in out] == [("Milio", "team_victim", "low")]


def test_counter_regression_then_catch_up_is_not_double_counted():
    # observateur en retard : le compteur recule puis revient -> un seul kill
    m = FrameKillMatcher(PARTS, "g", "blue")
    out = m.feed(_frame("2026-01-01T00:00:00.000Z", Z))
    out += m.feed(_frame("2026-01-01T00:00:01.000Z", {**Z, "1": (1, 0, 0), "7": (0, 1, 0)}))
    out += m.feed(_frame("2026-01-01T00:00:01.500Z", Z))
    out += m.feed(_frame("2026-01-01T00:00:02.000Z", {**Z, "1": (1, 0, 0), "7": (0, 1, 0)}))
    out += m.flush()
    assert len(out) == 1


def test_finished_frame_sharing_the_last_millisecond_is_seen():
    m = FrameKillMatcher(PARTS, "g", "blue")
    m.feed(_frame("2026-01-01T00:40:39.581Z", Z, "in_game"))
    m.feed(_frame("2026-01-01T00:40:39.581Z", Z, "finished"))
    assert m.finished


def test_one_label_per_series_on_its_last_kill():
    # rafale de 3 kills espacés de 4 s, puis un kill isolé 20 s plus tard
    m = FrameKillMatcher(PARTS, "g", "blue")
    seq = [("00:00:00", Z)]
    kda = dict(Z)
    for i, sec in enumerate((5, 9, 13, 33), 1):
        kda = {**kda, "1": (i, 0, 0), "7": (0, i, 0)}
        seq.append((f"00:00:{sec:02d}", dict(kda)))
    out = []
    for ts, k in seq:
        out += m.feed(_frame(f"2026-01-01T{ts}.000Z", k))
    out += m.flush()
    assign_multikill_labels(out)
    assert [k.multi_kill for k in out] == [None, None, "triple", None]


def test_pause_and_finish_are_recorded():
    m = FrameKillMatcher(PARTS, "g", "blue")
    for ts, st in (("00:00:00", "in_game"), ("00:07:33", "paused"), ("00:13:03", "in_game"), ("00:40:39", "finished")):
        m.feed(_frame(f"2026-01-01T{ts}.000Z", Z, st))
    assert m.finished
    clock = clock_from_states("g", m.first_epoch, m.states, m.last_ts)
    assert len(clock.pauses) == 1 and clock.total_paused_s == 330
    assert clock.duration_ingame_s == pytest.approx(40 * 60 + 39 - 330)


# ─── Horloge du feed ────────────────────────────────────────────────────────

def test_feed_clock_conversions_across_a_pause():
    a = 1_000_000
    c = FeedClock("g", anchor_ms=a, end_ms=a + 2_439_000, pauses=[(a + 453_000, a + 783_000)])
    assert c.ingame_seconds(a + 60_000) == 60
    assert c.ingame_seconds(a + 600_000) == 453          # figé pendant la pause
    assert c.ingame_seconds(a + 2_396_000) == 2066       # penta de Canna : 39:56 réel -> 34:26 au chrono
    assert c.epoch_ms_at_ingame(2066) == a + 2_396_000
    assert c.epoch_ms_at_ingame(453) == a + 453_000      # début de pause, jamais le milieu
    assert c.is_paused(a + 500_000) and not c.is_paused(a + 800_000)


def test_open_pause_is_closed_on_last_frame():
    c = clock_from_states("g", 0, [(0, "in_game"), (100, "paused")], last_epoch_ms=400)
    assert c.pauses == [(100, 400)] and c.end_ms is None
