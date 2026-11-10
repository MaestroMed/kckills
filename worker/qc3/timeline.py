"""E1 — Chronologie fine d'une game, lue dans le feed livestats (0 jeton).

Rétro-ingénierie du 21/10/2026 :
  * `window/{game}?startingTime=` (secondes multiples de 10) rend TOUTES les
    frames des 10 s suivantes : ~4-6 par seconde, pas une seule. Chaque
    participant y a K/D/A, `currentHealth` et `maxHealth`.
  * Un kill a donc SA frame : `deaths` de la victime +1 (même frame que
    `kills` du tueur +1), PV de la victime à 0 quelques centaines de ms
    après. Les kills harvestés avant le 23/09 ont un epoch 0,4 à 8,3 s trop
    tard (11 kills KC–T1 / KC–TS mesurés) ; ceux d'après sont exacts.
  * Les PV de tous les joueurs donnent le début du combat : premier
    décrochage de PV d'un des acteurs (tueur, victime, assists) avant le kill.

Une game ≈ 210 fenêtres (≈ 7 min au rythme du scheduler `livestats`),
mises en cache compressé : on ne relit jamais deux fois la même game.

Usage :
    tl = await load_timeline("116855104460702373")
    for k in tl.kills: print(k.chrono_s, k.killer_champion, k.victim_champion)
"""
from __future__ import annotations

import gzip
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

import structlog

from modules.feed_clock import FeedClock, clock_from_states
from modules.harvester import FrameKillMatcher, assign_multikill_labels
from services import livestats_api
from services.local_paths import LocalPaths

log = structlog.get_logger()

CACHE_DIR = os.path.join(os.path.dirname(LocalPaths.vods_dir()), "qc3", "timelines")
MAX_GAME_MINUTES = 90
STOP_AFTER_FINISH_WINDOWS = 3
MAX_EMPTY_WINDOWS = 60          # 10 min sans frame : feed coupé
# Après la fin, le feed ressert ses dernières frames sans toujours passer
# à « finished » (KC–T1 G1) : 6 fenêtres sans frame nouvelle = fin.
# Pendant une pause, il ressert aussi ses dernières frames (la plus récente
# en « paused ») jusqu'à la reprise : là, on attend (KC–C9 G4, 202 s).
MAX_STALE_WINDOWS = 6
MAX_PAUSE_WINDOWS = 180         # 30 min de pause au plus

# Début du combat : premier décrochage de PV d'un acteur du kill, en
# remontant au plus FIGHT_LOOKBACK_S avant le kill. Un « décrochage » = perte
# d'au moins HP_DROP_PCT des PV max sur une fenêtre glissante de 2 s ; le
# combat est continu tant que deux décrochages sont à moins de FIGHT_GAP_S.
FIGHT_LOOKBACK_S = 30
FIGHT_GAP_S = 6
HP_DROP_PCT = 0.08


@dataclass
class KillMoment:
    epoch_ms: int                     # frame où la mort de la victime est comptée
    chrono_s: float                   # chrono affiché en jeu à cet instant (pauses déduites)
    killer_pid: str | None
    killer_name: str | None
    killer_champion: str | None
    killer_side: str | None
    victim_pid: str | None
    victim_name: str | None
    victim_champion: str | None
    victim_side: str | None
    assist_pids: list[str] = field(default_factory=list)
    confidence: str = "high"
    is_first_blood: bool = False
    multi_kill: str | None = None
    fight_start_ms: int | None = None     # premier décrochage de PV d'un acteur
    killer_hp_pct: float | None = None    # PV du tueur à l'instant du kill (0-1)


@dataclass
class Timeline:
    game_ext_id: str
    participants: dict[str, dict]
    clock: FeedClock
    frames: list[list] = field(default_factory=list)   # [epoch_ms, état, [[k,d,a,pv,pvmax] × pid 1..10]]
    kills: list[KillMoment] = field(default_factory=list)
    finished: bool = False

    @property
    def start_ms(self) -> int:
        return self.clock.anchor_ms

    def chrono_at(self, epoch_ms: int) -> float:
        return self.clock.ingame_seconds(epoch_ms)

    def epoch_at_chrono(self, chrono_s: float) -> int:
        return int(self.clock.epoch_ms_at_ingame(chrono_s))

    def team_kills_at(self, epoch_ms: int) -> tuple[int, int]:
        """(kills bleus, kills rouges) au dernier état connu avant `epoch_ms`
        (somme des compteurs des joueurs 1-5 et 6-10)."""
        lo, hi = 0, len(self.frames) - 1
        if not self.frames or self.frames[0][0] > epoch_ms:
            return 0, 0
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if self.frames[mid][0] <= epoch_ms:
                lo = mid
            else:
                hi = mid - 1
        rows = self.frames[lo][2]
        return sum(r[0] for r in rows[:5]), sum(r[0] for r in rows[5:])


# ─── Frames compactes ──────────────────────────────────────────────────────

def _epoch_ms(ts: str) -> int:
    return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)


def _compact(frame: dict) -> list | None:
    ts = frame.get("rfc460Timestamp")
    if not ts or not frame.get("blueTeam"):
        return None
    rows: dict[int, list[int]] = {}
    for side in ("blueTeam", "redTeam"):
        for p in (frame.get(side) or {}).get("participants") or []:
            rows[int(p.get("participantId") or 0)] = [
                int(p.get("kills") or 0), int(p.get("deaths") or 0), int(p.get("assists") or 0),
                int(p.get("currentHealth") or 0), int(p.get("maxHealth") or 0),
            ]
    return [_epoch_ms(ts), frame.get("gameState") or "", [rows.get(i, [0, 0, 0, 0, 0]) for i in range(1, 11)]]


def _as_feed_frame(c: list) -> dict:
    """Frame compacte → forme minimale lue par FrameKillMatcher."""
    epoch, state, rows = c
    ts = datetime.fromtimestamp(epoch / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    parts = [{"participantId": i + 1, "kills": r[0], "deaths": r[1], "assists": r[2]} for i, r in enumerate(rows)]
    return {"rfc460Timestamp": ts, "gameState": state,
            "blueTeam": {"participants": parts[:5]}, "redTeam": {"participants": parts[5:]}}


# ─── Lecture du feed ───────────────────────────────────────────────────────

async def fetch_frames(game_ext_id: str) -> tuple[dict, list[list]] | None:
    """(métadonnées, frames compactes triées) de toute la game."""
    first = await livestats_api.get_window(game_ext_id, starting_time=None)
    f0 = (first or {}).get("frames") or []
    if not f0:
        return None
    meta = {"gameMetadata": first.get("gameMetadata") or {}}
    seen: dict[int, list] = {}
    for fr in f0:
        c = _compact(fr)
        if c:
            seen.setdefault(c[0] * 10 + (c[1] == "finished"), c)
    anchor = datetime.fromtimestamp(min(c[0] for c in seen.values()) / 1000, timezone.utc)
    t = anchor.replace(second=anchor.second - anchor.second % 10, microsecond=0)
    end = anchor + timedelta(minutes=MAX_GAME_MINUTES)
    empty = after_finish = stale = 0
    while t < end:
        t += timedelta(seconds=10)
        data = await livestats_api.get_window(game_ext_id, t.strftime("%Y-%m-%dT%H:%M:%S.000Z"))
        frames = (data or {}).get("frames") or []
        if not frames:
            empty += 1
            if empty >= MAX_EMPTY_WINDOWS:
                break
            continue
        empty = 0
        before = len(seen)
        if len(seen) and (t - anchor).seconds % 300 < 10:
            log.info("qc3_timeline_progress", game=game_ext_id, minute=int((t - anchor).total_seconds() // 60), frames=len(seen))
        for fr in frames:
            c = _compact(fr)
            if c:
                seen.setdefault(c[0] * 10 + (c[1] == "finished"), c)
        stale = stale + 1 if len(seen) == before else 0
        last_state = seen[max(seen)][1]
        if stale >= (MAX_PAUSE_WINDOWS if last_state == "paused" else MAX_STALE_WINDOWS):
            break
        if any(fr.get("gameState") == "finished" for fr in frames):
            after_finish += 1
            if after_finish >= STOP_AFTER_FINISH_WINDOWS:
                break
    return meta, [seen[k] for k in sorted(seen)]


def _cache_path(game_ext_id: str) -> str:
    return os.path.join(CACHE_DIR, f"{game_ext_id}.json.gz")


def _save(game_ext_id: str, meta: dict, frames: list[list]) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = _cache_path(game_ext_id) + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump({"meta": meta, "frames": frames}, f, separators=(",", ":"))
    os.replace(tmp, _cache_path(game_ext_id))


def _load_cached(game_ext_id: str) -> tuple[dict, list[list]] | None:
    p = _cache_path(game_ext_id)
    if not os.path.exists(p):
        return None
    with gzip.open(p, "rt", encoding="utf-8") as f:
        d = json.load(f)
    return d["meta"], d["frames"]


# ─── Construction ──────────────────────────────────────────────────────────

def build_timeline(game_ext_id: str, meta: dict, frames: list[list]) -> Timeline:
    participants = livestats_api.extract_participants(meta)
    transitions: list[tuple[int, str]] = []
    for c in frames:
        if c[1] and (not transitions or transitions[-1][1] != c[1]):
            transitions.append((c[0], c[1]))
    clock = clock_from_states(game_ext_id, frames[0][0], transitions, frames[-1][0])

    # Le matcher du harvester (marée haute des compteurs, appariement
    # tueur ↔ mort adverse à ±3 s) : ce qu'on a de plus sûr pour qui-tue-qui.
    matcher = _AllKillsMatcher(participants, db_game_id=game_ext_id, kc_side=None)
    events = []
    for c in frames:
        events.extend(matcher.feed(_as_feed_frame(c)))
    events.extend(matcher.flush())
    assign_multikill_labels(events)

    tl = Timeline(game_ext_id, participants, clock, frames, finished=clock.end_ms is not None)
    for e in events:
        k = KillMoment(
            epoch_ms=int(e.event_epoch), chrono_s=round(clock.ingame_seconds(int(e.event_epoch)), 2),
            killer_pid=e.killer_participant_id, killer_name=e.killer_name,
            killer_champion=e.killer_champion, killer_side=e.killer_side,
            victim_pid=e.victim_participant_id, victim_name=e.victim_name,
            victim_champion=e.victim_champion, victim_side=e.victim_side,
            assist_pids=[a.get("participant_id") for a in e.assistants or [] if a.get("participant_id")],
            confidence=e.confidence, is_first_blood=e.is_first_blood, multi_kill=e.multi_kill,
        )
        k.fight_start_ms = fight_start(frames, k)
        k.killer_hp_pct = _hp_pct(frames, k.killer_pid, k.epoch_ms)
        tl.kills.append(k)
    tl.kills.sort(key=lambda k: k.epoch_ms)
    return tl


class _AllKillsMatcher(FrameKillMatcher):
    """FrameKillMatcher sans le filtre « KC impliquée » de _emit : la
    chronologie garde les kills des deux équipes (le filtre KC se fait à
    l'appariement avec la base)."""

    def _emit(self, ke, kpid, vpid, assists, ambiguous):
        saved = self.kc_side
        self.kc_side = (self.participants.get(kpid) or {}).get("side") or "blue"
        try:
            return super()._emit(ke, kpid, vpid, assists, ambiguous)
        finally:
            self.kc_side = saved


def _hp_pct(frames: list[list], pid: str | None, epoch_ms: int) -> float | None:
    if not pid:
        return None
    i = int(pid) - 1
    best = None
    for c in frames:
        if c[0] > epoch_ms:
            break
        best = c
    if not best:
        return None
    hp, mx = best[2][i][3], best[2][i][4]
    return round(hp / mx, 3) if mx else None


def fight_start(frames: list[list], k: KillMoment) -> int | None:
    """Premier décrochage de PV d'un acteur du kill, combat continu jusqu'au kill."""
    actors = [int(p) - 1 for p in [k.killer_pid, k.victim_pid, *k.assist_pids] if p]
    if not actors:
        return None
    lo = k.epoch_ms - FIGHT_LOOKBACK_S * 1000
    window = [c for c in frames if lo <= c[0] <= k.epoch_ms]
    drops: list[int] = []
    for j, c in enumerate(window):
        for i in actors:
            mx = c[2][i][4] or 1
            # PV 2 s plus tôt (frame la plus proche)
            back = next((w for w in reversed(window[:j]) if c[0] - w[0] >= 2000), None)
            if back and back[2][i][3] - c[2][i][3] >= HP_DROP_PCT * mx:
                drops.append(c[0] - 2000)
                break
    if not drops:
        return None
    # remonter depuis le kill tant que les décrochages se suivent
    start = k.epoch_ms
    for d in sorted(set(drops), reverse=True):
        if start - d <= FIGHT_GAP_S * 1000:
            start = d
        else:
            break
    return start if start < k.epoch_ms else None


async def load_timeline(game_ext_id: str, refresh: bool = False) -> Timeline | None:
    got = None if refresh else _load_cached(game_ext_id)
    if got is None:
        got = await fetch_frames(game_ext_id)
        if got is None:
            log.warn("qc3_timeline_no_feed", game=game_ext_id)
            return None
        _save(game_ext_id, *got)
    meta, frames = got
    tl = build_timeline(game_ext_id, meta, frames)
    log.info("qc3_timeline", game=game_ext_id, frames=len(frames), kills=len(tl.kills),
             pauses=len(tl.clock.pauses), finished=tl.finished)
    return tl


def to_json(tl: Timeline) -> dict:
    return {"game": tl.game_ext_id, "start_ms": tl.start_ms, "end_ms": tl.clock.end_ms,
            "pauses": tl.clock.pauses, "kills": [asdict(k) for k in tl.kills]}
