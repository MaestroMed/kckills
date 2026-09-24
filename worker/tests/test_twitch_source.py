"""Source Twitch du démon (2026-09-23) : horloge jamais figée en cours de
game, VODs d'un live en cours, cache de sections, décision de source,
fenêtres de séries multi-kill et report de job sans tentative consommée."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules import feed_clock, twitch_source, twitch_sync  # noqa: E402
from modules.feed_clock import FeedClock  # noqa: E402
from services import twitch_vod  # noqa: E402

ANCHOR = 1_756_000_000_000                      # epoch ms de la 1re frame
PAUSE = (ANCHOR + 600_000, ANCHOR + 900_000)    # pause de 5 min à 10:00


def _clock(finished: bool = True, anchor: int = ANCHOR) -> FeedClock:
    return FeedClock("G1", anchor, anchor + 2_400_000 if finished else None,
                     [(PAUSE[0] - ANCHOR + anchor, PAUSE[1] - ANCHOR + anchor)])


def run(coro):
    return asyncio.run(coro)


# ─── feed_clock : pas de cache pour une game en cours ───────────────────────

@pytest.fixture
def clock_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(feed_clock, "CLOCK_DIR", str(tmp_path))
    return tmp_path


def test_unfinished_clock_never_cached(clock_dir):
    feed_clock.save_clock(_clock(finished=False))
    assert not list(clock_dir.iterdir())
    assert feed_clock.load_clock("G1") is None


def test_finished_clock_round_trip(clock_dir):
    feed_clock.save_clock(_clock())
    c = feed_clock.load_clock("G1")
    assert c is not None and c.end_ms == ANCHOR + 2_400_000 and c.pauses == [PAUSE]


def test_legacy_cached_clock_without_end_is_ignored(clock_dir):
    (clock_dir / "G1.json").write_text(json.dumps(_clock(finished=False).to_json()), encoding="utf-8")
    assert feed_clock.load_clock("G1") is None


def test_latest_state_reads_last_frame(monkeypatch):
    from services import livestats_api

    async def fake_window(game, starting_time=None):
        return {"frames": [{"rfc460Timestamp": "2026-09-23T10:00:00.000Z", "gameState": "in_game"},
                           {"rfc460Timestamp": "2026-09-23T10:00:05.000Z", "gameState": "paused"}]}
    monkeypatch.setattr(livestats_api, "get_window", fake_window)
    assert run(feed_clock.latest_state("G1")) == "paused"

    async def empty(game, starting_time=None):
        return None
    monkeypatch.setattr(livestats_api, "get_window", empty)
    assert run(feed_clock.latest_state("G1")) is None


# ─── twitch_vod : VOD d'un live encore en cours ─────────────────────────────

def test_maybe_live_rules():
    now = 2_000_000_000
    # mesurée pendant le live (fin ≈ instant de mesure) -> à re-mesurer
    assert twitch_vod._maybe_live({"start": now - 7200, "duration": 3600, "measured_at": now - 3600}, now)
    # finie bien avant la mesure -> figée
    assert not twitch_vod._maybe_live({"start": now - 90_000, "duration": 3600, "measured_at": now - 3600}, now)
    # ancienne entrée sans measured_at -> figée ; mesure toute fraîche -> pas de re-mesure
    assert not twitch_vod._maybe_live({"start": now - 7200, "duration": 3600}, now)
    assert not twitch_vod._maybe_live({"start": now - 100, "duration": 50, "measured_at": now - 30}, now)


def test_find_vod_requires_coverage_until(monkeypatch):
    calls = []

    async def fake_list(channel, limit=80, force=False):
        calls.append(force)
        # le live dure 1 h au 1er listing, 3 h après rafraîchissement
        dur = 10_800 if force else 3600
        return [twitch_vod.TwitchVod("v1", 1_000_000, dur, "LEC", channel)]
    monkeypatch.setattr(twitch_vod, "list_archives", fake_list)
    v = run(twitch_vod.find_vod_for_epoch(1_001_000_000, "lec", until_ms=1_005_000_000))
    assert v is not None and v.duration_s == 10_800 and calls == [False, True]
    calls.clear()
    assert run(twitch_vod.find_vod_for_epoch(1_001_000_000, "lec", until_ms=1_020_000_000)) is None


# ─── twitch_sync : sections en cache ────────────────────────────────────────

@pytest.fixture
def vods_dir(tmp_path, monkeypatch):
    from services.local_paths import LocalPaths
    monkeypatch.setattr(LocalPaths, "vods_dir", staticmethod(lambda: str(tmp_path)))
    return tmp_path


def _write_section(vods: os.PathLike, vod_id: str, ok: bool, age_s: float = 0, with_file: bool = True):
    path = os.path.join(vods, f"twitch_{vod_id}_G1.mp4")
    if with_file:
        open(path, "wb").close()
    meta = {"vod": {"video_id": vod_id, "title": "LEC Summer"}, "section_start_s": 1234.0,
            "calibrated_at": int(time.time() - age_s), "c": 280.0 if ok else None, "ok": ok,
            "spread_s": 0.5 if ok else None, "reason": "" if ok else "2 lecture(s)", "reads": []}
    with open(path + ".sync.json", "w", encoding="utf-8") as f:
        json.dump(meta, f)
    return path


def test_cached_section_found_without_network(vods_dir):
    path = _write_section(vods_dir, "v42", ok=True)
    sec = twitch_sync.cached_game_section(_clock())
    assert sec is not None and sec.path == path and sec.vod_id == "v42" and sec.sync.c == 280.0
    assert sec.start_s == 1234.0


def test_cached_section_ignores_refused_or_missing_file(vods_dir):
    _write_section(vods_dir, "v1", ok=False)
    _write_section(vods_dir, "v2", ok=True, with_file=False)
    assert twitch_sync.cached_game_section(_clock()) is None


def test_prepare_skips_recent_refusal_without_download(vods_dir, monkeypatch):
    _write_section(vods_dir, "v7", ok=False, age_s=600, with_file=False)

    async def fake_find(epoch_ms, channel="lec", until_ms=None):
        return twitch_vod.TwitchVod("v7", ANCHOR // 1000 - 600, 20_000, "LEC", channel)

    async def boom(*a, **k):
        raise AssertionError("aucun téléchargement attendu")
    monkeypatch.setattr(twitch_vod, "find_vod_for_epoch", fake_find)
    monkeypatch.setattr(twitch_vod, "download_section", boom)
    assert run(twitch_sync.prepare_game_section(_clock(), channels=["lec"])) is None


def test_prepare_refuses_unfinished_game(vods_dir):
    assert run(twitch_sync.prepare_game_section(_clock(finished=False), channels=["lec"])) is None


def test_prepare_tries_next_channel(vods_dir, monkeypatch):
    seen = []

    async def fake_find(epoch_ms, channel="lec", until_ms=None):
        seen.append(channel)
        return None if channel == "lec" else twitch_vod.TwitchVod("v9", ANCHOR // 1000 - 300, 20_000, "Worlds", channel)

    async def fake_download(video_id, start_s, end_s, dest, max_height=1080):
        open(dest, "wb").close()
        return True

    async def fake_calibrate(path, clock, guess_c, tmp_dir):
        return twitch_sync.SectionSync(path=path, c=guess_c + 1.0, ok=True, spread_s=0.4)
    monkeypatch.setattr(twitch_vod, "find_vod_for_epoch", fake_find)
    monkeypatch.setattr(twitch_vod, "download_section", fake_download)
    monkeypatch.setattr(twitch_sync, "calibrate_section", fake_calibrate)
    sec = run(twitch_sync.prepare_game_section(_clock(), channels=["lec", "riotgames"]))
    assert seen == ["lec", "riotgames"]
    assert sec is not None and sec.vod_id == "v9" and sec.sync.c == pytest.approx(241.0)
    meta = json.load(open(sec.path + ".sync.json", encoding="utf-8"))
    assert meta["ok"] and meta["vod"]["channel"] == "riotgames" and meta["calibrated_at"] > 0


# ─── twitch_source : décision et paramètres de découpe ──────────────────────

def test_channels_by_league():
    assert twitch_source.channels_for_league("worlds")[0] == "riotgames"
    assert twitch_source.channels_for_league("lec")[0] == "lec"
    assert set(twitch_source.channels_for_league(None)) >= {"lec", "riotgames"}
    assert len(twitch_source.channels_for_league("msi")) == len(set(twitch_source.channels_for_league("msi")))


@pytest.fixture(autouse=True)
def _reset_source_state(monkeypatch):
    twitch_source._unavailable.clear()
    twitch_source._league_by_match.clear()
    monkeypatch.setattr(twitch_source, "ENABLED", True)
    monkeypatch.setattr(twitch_source, "league_slug_for_match", lambda mid: "lec")


def test_decide_ready_from_cache(monkeypatch):
    now_anchor = int(time.time() * 1000) - 3 * 3600_000
    sec = object()
    monkeypatch.setattr(twitch_source, "finished_clock", lambda ext: _clock(anchor=now_anchor))
    monkeypatch.setattr(twitch_sync, "cached_game_section", lambda clock: sec)
    d = run(twitch_source.decide({"external_id": "G1"}))
    assert d.status == twitch_source.READY and d.section is sec and not d.downloaded


def test_decide_pending_when_budget_spent_or_vod_short(monkeypatch):
    now_anchor = int(time.time() * 1000) - 50 * 60_000       # game finie il y a ~10 min
    monkeypatch.setattr(twitch_source, "finished_clock", lambda ext: _clock(anchor=now_anchor))
    monkeypatch.setattr(twitch_sync, "cached_game_section", lambda clock: None)
    d = run(twitch_source.decide({"external_id": "G1"}, allow_download=False))
    assert d.status == twitch_source.PENDING and d.reason == "download_budget"

    async def none(*a, **k):
        return None
    monkeypatch.setattr(twitch_sync, "prepare_game_section", none)
    d = run(twitch_source.decide({"external_id": "G1"}))
    assert d.status == twitch_source.PENDING and d.reason == "vod_not_ready" and d.downloaded


def test_decide_unavailable_cases(monkeypatch):
    monkeypatch.setattr(twitch_source, "finished_clock", lambda ext: None)
    assert run(twitch_source.decide({"external_id": "G1"})).reason == "no_clock"
    # mémorisé 30 min : pas de nouvel essai à la passe suivante
    monkeypatch.setattr(twitch_source, "finished_clock", lambda ext: _clock())
    assert run(twitch_source.decide({"external_id": "G1"})).reason == "no_clock"
    twitch_source._unavailable.clear()
    old = int(time.time() * 1000) - 200 * 86_400_000
    monkeypatch.setattr(twitch_source, "finished_clock", lambda ext: _clock(anchor=old))
    assert run(twitch_source.decide({"external_id": "G2"})).reason == "too_old"
    monkeypatch.setattr(twitch_source, "ENABLED", False)
    assert run(twitch_source.decide({"external_id": "G3"})).status == twitch_source.UNAVAILABLE


def test_decide_falls_back_after_pending_window(monkeypatch):
    long_ago = int(time.time() * 1000) - 6 * 3600_000        # finie il y a ~5 h 20
    monkeypatch.setattr(twitch_source, "finished_clock", lambda ext: _clock(anchor=long_ago))
    monkeypatch.setattr(twitch_sync, "cached_game_section", lambda clock: None)

    async def none(*a, **k):
        return None
    monkeypatch.setattr(twitch_sync, "prepare_game_section", none)
    d = run(twitch_source.decide({"external_id": "G9"}))
    assert d.status == twitch_source.UNAVAILABLE and d.reason == "no_section"


def _section(c: float = 280.4) -> twitch_sync.GameSection:
    sync = twitch_sync.SectionSync(path="D:/x.mp4", c=c, ok=True)
    return twitch_sync.GameSection("D:/x.mp4", 1000.0, "v5", "LEC", sync, _clock())


def test_clip_args_position_matches_sync_model():
    kill = {"id": "k1", "event_epoch": ANCHOR + 1_000_000, "killer_champion": "Jayce",
            "victim_champion": "Yorick", "multi_kill": None}
    a = twitch_source.clip_args(kill, _section(), [kill], game_number=1)
    # position fichier = c + (E - ancre) : 280 + 1000 = 1280 (erreur ≤ 1 s)
    assert abs(a["vod_offset_seconds"] + a["game_time_seconds"] - _section().sync.file_pos(kill["event_epoch"], _clock())) <= 1
    assert a["youtube_id"] == "twitch_v5" and a["local_vod_path"] == "D:/x.mp4"
    # chrono affiché = 1000 s réels - 300 s de pause = 11:40
    assert a["match_context"] == "Game 1  T+11:40"
    assert a["window_override"] is None


def test_clip_args_penta_window_covers_whole_series():
    base = ANCHOR + 1_800_000
    gaps = [0, 6_000, 14_000, 21_000, 45_000]           # 5e kill 24 s après le 4e (≤ 30 s)
    kills = [{"id": f"k{i}", "event_epoch": base + g, "killer_champion": "Jayce", "victim_champion": v,
              "multi_kill": "penta" if i == 4 else None, "status": "vod_found"}
             for i, (g, v) in enumerate(zip(gaps, ["A", "B", "C", "D", "E"]))]
    assert twitch_source.sequence_start_ms(kills[4], kills) == base
    a = twitch_source.clip_args(kills[4], _section(), kills, game_number=1)
    assert a["multi_kill"] == "penta"
    assert a["window_override"] is not None and a["window_override"]["before"] >= 45 + 12


def test_sequence_uses_label_length_and_ignores_duplicates():
    base = ANCHOR + 1_000_000
    older = {"id": "o", "event_epoch": base - 40_000, "killer_champion": "Ashe"}
    k0 = {"id": "a", "event_epoch": base, "killer_champion": "Ashe"}
    dup = {"id": "b", "event_epoch": base + 5_000, "killer_champion": "Ashe", "status": "duplicate"}
    other = {"id": "x", "event_epoch": base + 6_000, "killer_champion": "Vi"}
    k1 = {"id": "c", "event_epoch": base + 8_000, "killer_champion": "Ashe", "multi_kill": "double"}
    kills = [older, k0, dup, other, k1]
    assert twitch_source.sequence_start_ms(k1, kills) == base
    # kill simple : la fenêtre part du kill lui-même
    assert twitch_source.sequence_start_ms(k0, kills) == base
    # instant fourni par l'appelant (instants exacts du rattrapage)
    shifted = {"a": base - 2_000}
    assert twitch_source.sequence_start_ms(
        k1, kills, epoch_of=lambda k: shifted.get(k["id"], k["event_epoch"])) == base - 2_000


def test_sequence_span_is_capped():
    base = ANCHOR + 1_000_000
    k0 = {"id": "a", "event_epoch": base, "killer_champion": "Ashe"}
    k1 = {"id": "c", "event_epoch": base + 300_000, "killer_champion": "Ashe", "multi_kill": "double"}
    assert twitch_source.sequence_start_ms(k1, [k0, k1]) == base + 300_000 - twitch_source.MAX_SERIES_SPAN_MS


# ─── job_queue.defer : la tentative est rendue ──────────────────────────────

def test_defer_gives_back_the_attempt(monkeypatch):
    from services import job_queue

    sent = {}

    class Resp:
        def raise_for_status(self):
            return None

    class Client:
        def patch(self, url, json=None, headers=None, params=None):
            sent.update(json=json, params=params)
            return Resp()

    class DB:
        base = "https://x/rest/v1"
        headers = {}

        def _get_client(self):
            return Client()
    monkeypatch.setattr(job_queue, "get_db", lambda: DB())
    assert job_queue.defer({"id": "j1", "attempts": 2}, 600, "twitch_vod_not_ready")
    assert sent["params"] == {"id": "eq.j1"}
    body = sent["json"]
    assert body["status"] == "pending" and body["attempts"] == 1 and body["locked_by"] is None
    assert body["last_error"].startswith("deferred: twitch")
