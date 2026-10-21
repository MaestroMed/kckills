"""QC v3 : chronologie du feed (E1), synchro VOD (E2), titres (E4) — données synthétiques."""
from qc3 import sync as S
from qc3 import titles as T
from qc3.timeline import build_timeline

T0 = 1_784_373_000_000          # epoch ms du début de game
META = {"gameMetadata": {
    "blueTeamMetadata": {"participantMetadata": [
        {"participantId": i, "summonerName": n, "championId": c, "role": r}
        for i, n, c, r in [(1, "KC Canna", "Shyvana", "top"), (2, "KC Yike", "LeeSin", "jungle"),
                           (3, "KC Kyeahoo", "Taliyah", "mid"), (4, "KC Caliste", "Ziggs", "bottom"),
                           (5, "KC Busio", "Rell", "support")]]},
    "redTeamMetadata": {"participantMetadata": [
        {"participantId": i, "summonerName": n, "championId": c, "role": r}
        for i, n, c, r in [(6, "T1 Doran", "Jayce", "top"), (7, "T1 Oner", "XinZhao", "jungle"),
                           (8, "T1 Faker", "Syndra", "mid"), (9, "T1 Peyz", "Varus", "bottom"),
                           (10, "T1 Keria", "Camille", "support")]]},
}}


def _frames(events, end_s=600, pause=None, hz=4):
    """Frames compactes à `hz` Hz. events = [(t_s, tueur, victime, [assists])].
    pause = (début_s, durée_s) : état « paused »."""
    kda = {i: [0, 0, 0] for i in range(1, 11)}
    hp = {i: 1000 for i in range(1, 11)}
    out = []
    n = int(end_s * hz)
    ev = sorted(events)
    for j in range(n + 1):
        t = j / hz
        for (te, k, v, a) in ev:
            # le combat : la victime perd des PV pendant 5 s avant le kill
            if te - 5 <= t < te:
                hp[v] = max(1, int(1000 * (te - t) / 5))
            if abs(t - te) < 1e-9:
                kda[k][0] += 1
                kda[v][1] += 1
                for x in a:
                    kda[x][2] += 1
                hp[v] = 0
            if te < t <= te + 0.01:
                pass
        state = "in_game"
        if pause and pause[0] <= t < pause[0] + pause[1]:
            state = "paused"
        if j == n:
            state = "finished"
        out.append([T0 + int(t * 1000), state, [[*kda[i], hp[i], 1000] for i in range(1, 11)]])
    return out


def test_kill_dated_at_its_frame_with_fight_start():
    tl = build_timeline("g", META, _frames([(180.0, 2, 10, [4])]))
    assert len(tl.kills) == 1
    k = tl.kills[0]
    assert k.epoch_ms == T0 + 180_000
    assert (k.killer_champion, k.victim_champion) == ("LeeSin", "Camille")
    assert k.is_first_blood and k.assist_pids == ["4"]
    # PV de la victime en chute dès 175 s → combat ≈ 5 s avant le kill
    assert 3_000 <= k.epoch_ms - k.fight_start_ms <= 8_000


def test_pause_is_removed_from_chrono():
    tl = build_timeline("g", META, _frames([(300.0, 8, 1, [])], pause=(60.0, 20.0)))
    assert tl.clock.pauses and abs(tl.chrono_at(T0 + 300_000) - 280.0) < 0.5
    assert abs(tl.epoch_at_chrono(280.0) - (T0 + 300_000)) < 500


def test_multikill_and_title():
    ev = [(200.0, 4, 6, [5]), (204.0, 4, 7, []), (207.0, 4, 8, [])]
    tl = build_timeline("g", META, _frames(ev))
    last = tl.kills[-1]
    assert last.multi_kill == "triple"
    assert T.title(tl, last).startswith("Triple kill de Caliste (Ziggs)")
    assert T.title(tl, tl.kills[0]).startswith("Premier sang : Caliste (Ziggs) sur Doran (Jayce)")


def test_titles_helpers():
    assert T.champion("MonkeyKing") == "Wukong" and T.champion("TwistedFate") == "Twisted Fate"
    assert T.player("KC Caliste") == "Caliste" and T.mmss(209.7) == "3:29"


class _FakeSource(S.FrameSource):
    """Vidéo fictive : à la position p, l'écran montre le chrono (p − a) (avec
    un saut `cut` après `cut_at`, comme une VOD montée)."""

    def __init__(self, a, cut_at=None, cut=0.0):
        self.a, self.cut_at, self.cut = a, cut_at, cut

    def frame(self, pos):
        c = pos - self.a - (self.cut if self.cut_at is not None and pos >= self.cut_at else 0.0)
        return c if c >= 0 else None


class _FakeReader:
    def read(self, im):
        class R:
            seconds = int(im) if im is not None else None
        return R()


def test_sync_anchor_from_three_reads():
    tl = build_timeline("g", META, _frames([(180.0, 2, 10, [])], end_s=1800))
    vs = S.measure(tl, _FakeSource(a=2000.0), _FakeReader(), prior_pos=lambda e: 2020 + tl.chrono_at(e))
    assert vs.status == "ok" and len(vs.reads) == 3
    assert abs(vs.pos(T0 + 180_000) - (2000.0 + 180.0)) <= 1.0


def test_sync_flags_vod_cut_inside_game():
    tl = build_timeline("g", META, _frames([(180.0, 2, 10, [])], end_s=1800))
    src = _FakeSource(a=2000.0, cut_at=2000.0 + 1000.0, cut=-40.0)
    vs = S.measure(tl, src, _FakeReader(), prior_pos=lambda e: 2000 + tl.chrono_at(e))
    assert vs.status == "inconsistent"


def test_fetch_waits_through_pause_and_stops_after_end(monkeypatch):
    """Le feed ressert ses dernières frames pendant une pause et après la fin."""
    import asyncio
    from datetime import datetime, timezone
    from qc3 import timeline as TL

    def frame(t_s, state):
        ts = datetime.fromtimestamp((T0 + t_s * 1000) / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        parts = [{"participantId": i, "kills": 0, "deaths": 0, "assists": 0, "currentHealth": 500, "maxHealth": 1000}
                 for i in range(1, 11)]
        return {"rfc460Timestamp": ts, "gameState": state,
                "blueTeam": {"participants": parts[:5]}, "redTeam": {"participants": parts[5:]}}

    PAUSE = (100, 300)        # pause de 100 à 400 s
    END = 600
    calls = []

    async def get_window(game, starting_time=None):
        if starting_time is None:
            return {"gameMetadata": META["gameMetadata"], "frames": [frame(0, "in_game")]}
        t = (datetime.fromisoformat(starting_time.replace("Z", "+00:00")).timestamp() * 1000 - T0) / 1000
        calls.append(t)
        if PAUSE[0] <= t < PAUSE[0] + PAUSE[1]:      # pendant la pause : dernières frames resservies
            return {"frames": [frame(PAUSE[0] - 0.5, "in_game"), frame(PAUSE[0], "paused")]}
        if t >= END:                                  # après la fin : idem, sans « finished »
            return {"frames": [frame(END - 0.5, "in_game")]}
        return {"frames": [frame(t + x / 4, "in_game") for x in range(40)]}

    monkeypatch.setattr(TL.livestats_api, "get_window", get_window)
    meta, frames = asyncio.run(TL.fetch_frames("g"))
    assert frames[-1][0] >= T0 + (END - 1) * 1000          # la pause n'a pas arrêté la lecture
    assert max(calls) <= END + 10 * (TL.MAX_STALE_WINDOWS + 1)   # arrêt peu après la fin


def test_title_from_row_without_db(monkeypatch):
    monkeypatch.setattr(T, "_ign", lambda pid: {"a": "Yike", "b": "Keria"}.get(pid))
    row = {"killer_player_id": "a", "victim_player_id": "b", "killer_champion": "LeeSin",
           "victim_champion": "Camille", "is_first_blood": True, "assistants": [], "game_time_seconds": 209}
    t = T.title_from_row(row)
    assert t.startswith("Premier sang : Yike (Lee Sin) sur Keria (Camille) en solo — 3:29")
    assert len(t) >= 50


def test_gemini_switch_off_by_default(monkeypatch):
    from config import config
    from services import gemini_client
    monkeypatch.setattr(config, "GEMINI_ENABLED", False)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "x")
    assert gemini_client.get_client() is None
