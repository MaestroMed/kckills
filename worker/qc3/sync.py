"""E2 — Position d'un instant du feed dans une VOD, une ancre par game (0 jeton).

Rétro-ingénierie du 21/10/2026 : dans une vidéo enregistrée en continu,
    position(E) = ancre + (E − début_de_game) / 1000
à moins d'une seconde près sur tous les kills d'une game (KC–T1 G1/G2/G3 :
écart < 1 s sur 39, 33 et 48 kills). Les pauses sont incluses d'office :
c'est du temps réel des deux côtés. Une VOD montée (re-upload OTP) change
d'ancre entre deux games, pas à l'intérieur d'une game.

L'ancre se mesure en lisant le chrono à l'écran (engine_v2.chrono, modèles
locaux) à 3 instants répartis dans la game. Pour un chrono lu c à la
position p : ancre = p − (E(c) − début)/1000, avec E(c) l'instant du feed où
le chrono valait c. Les 3 ancres doivent concorder à SPREAD_MAX près ; sinon
la vidéo est montée à l'intérieur de la game (ou le lecteur s'est trompé) :
on le dit, on ne devine pas.
"""
from __future__ import annotations

import os
import statistics
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Callable

import cv2
import numpy as np
import structlog

from engine_v2.chrono import ChronoReader
from qc3.timeline import Timeline

log = structlog.get_logger()

SPREAD_MAX = 1.5            # s — désaccord max entre les ancres
PROBE_FRACTIONS = (0.25, 0.5, 0.75)
SEARCH_STEPS = (0, 4, -4, 9, -9, 15, -15, 22, -22, 30, -30, 45, -45, 60, -60, 90, -90)
PAIR_GAP = 2.0              # 2e lecture de confirmation, 2 s plus loin


# ─── Accès aux images ──────────────────────────────────────────────────────

class FrameSource:
    def frame(self, pos: float) -> np.ndarray | None:
        raise NotImplementedError

    def close(self) -> None:
        pass


class LocalVideo(FrameSource):
    """Fichier local ; `origin` = position de la VOD au début du fichier
    (une section téléchargée à partir de 15290 s a origin=15290)."""

    def __init__(self, path: str, origin: float = 0.0):
        self.path, self.origin = path, origin
        self.cap = cv2.VideoCapture(path)

    def frame(self, pos: float) -> np.ndarray | None:
        t = pos - self.origin
        if t < 0:
            return None
        self.cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, im = self.cap.read()
        return im if ok else None

    def close(self) -> None:
        self.cap.release()


class RemoteStream(FrameSource):
    """URL directe (yt-dlp -g) : une image par appel ffmpeg -ss, sans télécharger la VOD."""

    def __init__(self, url: str):
        self.url = url

    def frame(self, pos: float) -> np.ndarray | None:
        fd, out = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        try:
            r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{pos:.2f}", "-i", self.url,
                                "-frames:v", "1", out], capture_output=True, timeout=60)
            return cv2.imread(out) if r.returncode == 0 else None
        finally:
            if os.path.exists(out):
                os.remove(out)


# ─── Synchronisation ───────────────────────────────────────────────────────

@dataclass
class VodSync:
    start_ms: int
    anchor_s: float | None
    spread_s: float | None
    reads: list[dict] = field(default_factory=list)   # {pos, chrono, anchor}
    status: str = "ok"                                  # ok | inconsistent | unreadable

    def pos(self, epoch_ms: int) -> float:
        if self.anchor_s is None:
            raise ValueError("synchronisation absente")
        return self.anchor_s + (epoch_ms - self.start_ms) / 1000.0

    def to_json(self) -> dict:
        return {"start_ms": self.start_ms, "anchor_s": self.anchor_s, "spread_s": self.spread_s,
                "status": self.status, "reads": self.reads}


def _confirmed_read(src: FrameSource, reader: ChronoReader, pos: float) -> tuple[float, int] | None:
    """Chrono lu à `pos`, confirmé par une 2e lecture 2 s plus loin (écart 1-3 s)."""
    a = src.frame(pos)
    if a is None:
        return None
    ra = reader.read(a)
    if ra.seconds is None:
        return None
    b = src.frame(pos + PAIR_GAP)
    rb = reader.read(b) if b is not None else None
    if rb is None or rb.seconds is None or not (1 <= rb.seconds - ra.seconds <= 3):
        return None
    return pos, ra.seconds


def measure(tl: Timeline, src: FrameSource, reader: ChronoReader,
            prior_pos: Callable[[int], float], probes: tuple[float, ...] = PROBE_FRACTIONS) -> VodSync:
    """Ancre de la game dans la vidéo. `prior_pos(epoch_ms)` = position estimée
    (offset en base, startMillis, firstFrameTime…) : la recherche part de là,
    ±90 s."""
    end = tl.clock.end_ms or tl.frames[-1][0]
    reads: list[dict] = []
    for frac in probes:
        e = int(tl.start_ms + frac * (end - tl.start_ms))
        p0 = prior_pos(e)
        for step in SEARCH_STEPS:
            got = _confirmed_read(src, reader, p0 + step)
            if not got:
                continue
            p, c = got
            # chrono affiché c = [c, c+1[ : on prend le milieu de la seconde
            ec = tl.epoch_at_chrono(c + 0.5)
            reads.append({"pos": round(p, 2), "chrono": c, "anchor": round(p - (ec - tl.start_ms) / 1000.0, 2)})
            break
    if not reads:
        log.warn("qc3_sync_unreadable", game=tl.game_ext_id)
        return VodSync(tl.start_ms, None, None, reads, "unreadable")
    anchors = [r["anchor"] for r in reads]
    spread = max(anchors) - min(anchors)
    status = "ok" if len(reads) >= 2 and spread <= SPREAD_MAX else "inconsistent"
    vs = VodSync(tl.start_ms, round(statistics.median(anchors), 2), round(spread, 2), reads, status)
    log.info("qc3_sync", game=tl.game_ext_id, anchor=vs.anchor_s, spread=vs.spread_s, reads=len(reads), status=status)
    return vs
