"""
FEED_CLOCK — l'horloge d'une game telle que la voit le feed livestats :
début (1re frame), pauses (gameState == "paused") et fin ("finished").

Pourquoi (2026-09-23) : le pipeline raisonnait en « temps réel depuis le
début de la game » (`kills.game_time_seconds` = epoch - ancre). Après une
pause, le chrono affiché en jeu retarde sur ce temps réel de toute la durée
de la pause (GX playoffs G1 du 05/09/2026 : pause de 5 min 30, penta de
Canna au chrono 34:26 mais à « T+39:56 » en base). Les calibrations qui
lisent le chrono à l'écran décalaient donc tous les clips d'après-pause.
Le feed publie l'état de la partie ~4 fois par seconde : l'horloge convertit
exactement le temps réel (epoch) en chrono de jeu et inversement.

Usage :
    clock = await get_clock("115548681803406292")      # cache disque, sinon parcours du feed
    clock.ingame_seconds(kill_epoch_ms)                  # chrono affiché au moment du kill
    clock.epoch_ms_at_ingame(34 * 60 + 26)               # instant réel d'un chrono donné

Le harvester construit l'horloge pendant son propre parcours (zéro requête
en plus) via `clock_from_states` + `save_clock`. `build_clock` ne sert que
pour les games harvestées avant cette version.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import structlog

from services.local_paths import LocalPaths

log = structlog.get_logger()

CLOCK_DIR = os.path.join(os.path.dirname(LocalPaths.vods_dir()), "feed_clock")


@dataclass
class FeedClock:
    game_ext_id: str
    anchor_ms: int                      # epoch de la 1re frame de la partie
    end_ms: int | None = None           # epoch du passage à "finished"
    pauses: list[tuple[int, int]] = field(default_factory=list)  # [(début, fin)] en epoch ms

    # ─── Conversions ────────────────────────────────────────────────────
    def paused_before_ms(self, epoch_ms: int) -> int:
        """Durée cumulée de pause entre l'ancre et `epoch_ms`."""
        total = 0
        for start, end in self.pauses:
            if start >= epoch_ms:
                break
            total += max(0, min(end, epoch_ms) - start)
        return total

    def ingame_seconds(self, epoch_ms: int) -> float:
        """Chrono de jeu (s) affiché à l'instant réel `epoch_ms`."""
        return max(0.0, (epoch_ms - self.anchor_ms - self.paused_before_ms(epoch_ms)) / 1000.0)

    def epoch_ms_at_ingame(self, seconds: float) -> int:
        """Premier instant réel où le chrono affiche `seconds`.

        Pendant une pause le chrono est figé : on renvoie le début de la
        pause, jamais un instant au milieu (ambigu)."""
        t = self.anchor_ms
        remaining = max(0.0, seconds) * 1000.0
        for start, end in self.pauses:
            if start < t:
                continue
            if start - t >= remaining:
                break
            remaining -= start - t
            t = end
        return int(round(t + remaining))

    def is_paused(self, epoch_ms: int) -> bool:
        return any(start <= epoch_ms < end for start, end in self.pauses)

    @property
    def total_paused_s(self) -> float:
        return sum(end - start for start, end in self.pauses) / 1000.0

    @property
    def duration_ingame_s(self) -> float | None:
        return None if self.end_ms is None else self.ingame_seconds(self.end_ms)

    # ─── Sérialisation ──────────────────────────────────────────────────
    def to_json(self) -> dict:
        return {
            "game_ext_id": self.game_ext_id,
            "anchor_ms": self.anchor_ms,
            "end_ms": self.end_ms,
            "pauses": [list(p) for p in self.pauses],
            "version": 1,
        }

    @classmethod
    def from_json(cls, d: dict) -> "FeedClock":
        return cls(
            game_ext_id=str(d["game_ext_id"]),
            anchor_ms=int(d["anchor_ms"]),
            end_ms=int(d["end_ms"]) if d.get("end_ms") else None,
            pauses=[(int(a), int(b)) for a, b in (d.get("pauses") or [])],
        )


def clock_from_states(
    game_ext_id: str,
    anchor_ms: int,
    transitions: list[tuple[int, str]],
    last_epoch_ms: int | None = None,
) -> FeedClock:
    """Construit l'horloge depuis la liste ordonnée des changements d'état
    [(epoch_ms, gameState)]. Une pause encore ouverte à la fin est fermée
    sur `last_epoch_ms` (game coupée pendant une pause)."""
    pauses: list[tuple[int, int]] = []
    end_ms: int | None = None
    pause_start: int | None = None
    for epoch, state in sorted(transitions):
        if state == "paused":
            if pause_start is None:
                pause_start = epoch
            continue
        if pause_start is not None:
            if epoch > pause_start:
                pauses.append((pause_start, epoch))
            pause_start = None
        if state == "finished" and end_ms is None:
            end_ms = epoch
    if pause_start is not None and last_epoch_ms and last_epoch_ms > pause_start:
        pauses.append((pause_start, last_epoch_ms))
    return FeedClock(game_ext_id=str(game_ext_id), anchor_ms=int(anchor_ms), end_ms=end_ms, pauses=pauses)


def _path(game_ext_id: str) -> str:
    return os.path.join(CLOCK_DIR, f"{game_ext_id}.json")


def save_clock(clock: FeedClock) -> None:
    """Cache disque (une game terminée ne change plus). Silencieux en cas
    d'échec : l'horloge est reconstructible depuis le feed.

    Une horloge sans fin (game encore en cours : le harvester du démon la
    voit toutes les 10 min pendant le live) n'est JAMAIS mise en cache : elle
    figerait l'ancre sans les pauses suivantes ni la fin de partie."""
    if clock.end_ms is None:
        log.debug("feed_clock_not_cached_unfinished", game=clock.game_ext_id)
        return
    try:
        os.makedirs(CLOCK_DIR, exist_ok=True)
        tmp = _path(clock.game_ext_id) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(clock.to_json(), f)
        os.replace(tmp, _path(clock.game_ext_id))
    except OSError as e:
        log.warn("feed_clock_save_failed", game=clock.game_ext_id, error=str(e)[:120])


def load_clock(game_ext_id: str) -> FeedClock | None:
    """Horloge en cache, seulement si elle est complète (fin de partie vue)."""
    try:
        with open(_path(game_ext_id), encoding="utf-8") as f:
            clock = FeedClock.from_json(json.load(f))
    except (OSError, ValueError, KeyError):
        return None
    return clock if clock.end_ms is not None else None


def _epoch_ms(ts: str) -> int:
    return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)


async def build_clock(game_ext_id: str, max_minutes: int = 90, step_s: int = 10) -> FeedClock | None:
    """Parcourt le feed (une fenêtre toutes les `step_s`) pour relever les
    changements d'état. ~2 min pour une game de 40 min."""
    from services import livestats_api

    first = await livestats_api.get_window(game_ext_id, starting_time=None)
    frames = (first or {}).get("frames") or []
    if not frames:
        log.warn("feed_clock_no_anchor", game=game_ext_id)
        return None
    anchor_ms = _epoch_ms(frames[0]["rfc460Timestamp"])
    transitions: list[tuple[int, str]] = []
    seen: set[tuple[str, str]] = set()
    last_epoch = anchor_ms

    def _ingest(frs: list[dict]) -> bool:
        nonlocal last_epoch
        finished = False
        for fr in sorted(frs, key=lambda x: x.get("rfc460Timestamp") or ""):
            ts = fr.get("rfc460Timestamp")
            st = fr.get("gameState") or ""
            # clé (instant, état) : la frame 'finished' partage souvent la
            # milliseconde de la dernière frame in_game ; après la fin, le feed
            # ressert ses dernières frames indéfiniment (jamais de 204).
            if not ts or (ts, st) in seen:
                continue
            seen.add((ts, st))
            e = _epoch_ms(ts)
            last_epoch = max(last_epoch, e)
            if not transitions or transitions[-1][1] != st:
                transitions.append((e, st))
            finished = finished or st == "finished"
        return finished

    _ingest(frames)
    anchor_dt = datetime.fromtimestamp(anchor_ms / 1000, tz=timezone.utc)
    t = anchor_dt.replace(microsecond=0) - timedelta(seconds=anchor_dt.second % 10) + timedelta(seconds=step_s)
    empty_run = 0
    while t < anchor_dt + timedelta(minutes=max_minutes):
        data = await livestats_api.get_window(game_ext_id, t.strftime("%Y-%m-%dT%H:%M:%S.000Z"))
        frs = (data or {}).get("frames") or []
        if not frs:
            empty_run += 1
            if empty_run >= 30:
                break
        else:
            empty_run = 0
            if _ingest(frs):
                break
        t += timedelta(seconds=step_s)
    transitions.sort()
    clock = clock_from_states(game_ext_id, anchor_ms, transitions, last_epoch)
    save_clock(clock)
    log.info("feed_clock_built", game=game_ext_id, pauses=len(clock.pauses),
             paused_s=round(clock.total_paused_s), duration_ingame_s=clock.duration_ingame_s)
    return clock


_GAME_EXT: dict[str, str | None] = {}


def chrono_seconds_for_kill(kill: dict) -> int | None:
    """Chrono affiché à l'instant du kill, depuis l'horloge du feed EN CACHE
    (aucun appel au feed). None si l'instant, la game ou l'horloge manque."""
    epoch = kill.get("event_epoch")
    clock = clock_for_kill(kill) if epoch else None
    return int(clock.ingame_seconds(int(epoch))) if clock else None


def clock_for_kill(kill: dict) -> FeedClock | None:
    """Horloge complète en cache de la game du kill (aucun appel au feed)."""
    gid = kill.get("game_id")
    if not gid:
        return None
    if gid not in _GAME_EXT:
        try:
            from services.supabase_client import safe_select

            rows = safe_select("games", "external_id", id=gid) or []
            _GAME_EXT[gid] = (rows[0] if rows else {}).get("external_id")
        except Exception:
            return None
    ext = _GAME_EXT.get(gid)
    return load_clock(ext) if ext else None


def wall_seconds_for_kill(kill: dict) -> int | None:
    """Temps RÉEL depuis la 1re frame du feed à l'instant du kill (pauses
    comprises). La position dans un live continu (VOD officielle, Twitch) se
    calcule avec lui, jamais avec le chrono. None sans horloge en cache."""
    epoch = kill.get("event_epoch")
    clock = clock_for_kill(kill) if epoch else None
    return max(0, round((int(epoch) - clock.anchor_ms) / 1000)) if clock else None


def paused_before_kill_s(kill: dict) -> float | None:
    """Durée de pause écoulée avant le kill (None sans horloge en cache)."""
    epoch = kill.get("event_epoch")
    clock = clock_for_kill(kill) if epoch else None
    return clock.paused_before_ms(int(epoch)) / 1000.0 if clock else None


async def latest_state(game_ext_id: str) -> str | None:
    """État actuel de la game dans le feed (in_game / paused / finished), une
    seule requête. Après la fin, le feed ressert ses dernières frames : une
    game finie depuis longtemps répond donc 'finished'. None = pas de
    données (game pas commencée, feed indisponible)."""
    from services import livestats_api

    t = datetime.now(timezone.utc) - timedelta(seconds=60)
    t = t.replace(microsecond=0) - timedelta(seconds=t.second % 10)
    data = await livestats_api.get_window(game_ext_id, t.strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    frames = (data or {}).get("frames") or []
    if not frames:
        return None
    return max(frames, key=lambda f: f.get("rfc460Timestamp") or "").get("gameState") or None


async def get_clock(game_ext_id: str) -> FeedClock | None:
    """Horloge depuis le cache disque, sinon construite depuis le feed."""
    return load_clock(game_ext_id) or await build_clock(game_ext_id)
