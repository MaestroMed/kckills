"""Carte temps du fichier ↔ chrono de la partie, lue à l'écran.

On lit le chrono toutes les `step` secondes du fichier. Pendant le jeu,
fichier − chrono est constant ; il augmente d'un coup après une pause
(le fichier avance, pas le chrono) ; un replay de la régie ou un plan sans
HUD ne donne pas de lecture (ou une lecture incohérente, écartée).

Segments = plages où fichier − chrono reste constant (± 1,5 s). Pour placer
un kill dont on connaît le chrono, on prend le segment qui contient ce
chrono. Un chrono qui tombe entre deux segments (pendant une pause, ou
dans un trou de lecture) reste placé, mais marqué `gap=True`.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

import cv2
import numpy as np

from engine_v2.chrono import ChronoReader, frame_at


@dataclass
class Segment:
    offset: float          # fichier − chrono
    chrono_from: int
    chrono_to: int
    file_from: float
    file_to: float
    points: int


@dataclass
class ClockMap:
    video: str
    step: float
    reads: list[tuple[float, int]] = field(default_factory=list)   # (fichier, chrono)
    unreadable: int = 0
    segments: list[Segment] = field(default_factory=list)

    def file_pos(self, chrono: float) -> tuple[float | None, bool]:
        """Position dans le fichier pour un chrono ; (pos, gap)."""
        if not self.segments:
            return None, True
        for s in self.segments:
            if s.chrono_from - self.step <= chrono <= s.chrono_to + self.step:
                return chrono + s.offset, False
        # entre deux segments : on prend le segment précédent (le chrono
        # ne repart qu'à la fin d'une pause)
        prev = [s for s in self.segments if s.chrono_to <= chrono]
        s = prev[-1] if prev else self.segments[0]
        return chrono + s.offset, True

    @property
    def pauses(self) -> list[dict]:
        out = []
        for a, b in zip(self.segments, self.segments[1:]):
            d = b.offset - a.offset
            if d > 2:
                out.append({"chrono": a.chrono_to, "file_from": a.file_to, "duration_s": round(d, 1)})
        return out

    def to_json(self) -> dict:
        return {
            "video": self.video,
            "step": self.step,
            "reads": len(self.reads),
            "unreadable": self.unreadable,
            "segments": [asdict(s) for s in self.segments],
            "pauses": self.pauses,
        }


def _segments(reads: list[tuple[float, int]], tol: float = 1.5, min_points: int = 3) -> list[Segment]:
    segs: list[list[tuple[float, int]]] = []
    for f, c in reads:
        off = f - c
        if segs and abs((segs[-1][-1][0] - segs[-1][-1][1]) - off) <= tol and c >= segs[-1][-1][1]:
            segs[-1].append((f, c))
        else:
            segs.append([(f, c)])
    out = []
    for s in segs:
        if len(s) < min_points:
            continue  # lecture isolée : replay, coupe, erreur — écartée
        offs = np.array([f - c for f, c in s])
        out.append(Segment(float(np.median(offs)), s[0][1], s[-1][1], s[0][0], s[-1][0], len(s)))
    # fusionne les segments consécutifs de même décalage (séparés par un replay)
    merged: list[Segment] = []
    for s in out:
        if merged and abs(merged[-1].offset - s.offset) <= tol and s.chrono_from >= merged[-1].chrono_to:
            m = merged[-1]
            merged[-1] = Segment((m.offset * m.points + s.offset * s.points) / (m.points + s.points), m.chrono_from, s.chrono_to, m.file_from, s.file_to, m.points + s.points)
        else:
            merged.append(s)
    return merged


def build(video: str, step: float = 2.0, start: float = 0.0, end: float | None = None, reader: ChronoReader | None = None) -> ClockMap:
    r = reader or ChronoReader()
    cap = cv2.VideoCapture(video)
    dur = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(1.0, cap.get(cv2.CAP_PROP_FPS))
    end = min(end or dur, dur - 0.5)
    cm = ClockMap(video=video, step=step)
    t = start
    while t < end:
        im = frame_at(cap, t)
        if im is None:
            break
        rd = r.read(im)
        if rd.seconds is None:
            cm.unreadable += 1
        else:
            cm.reads.append((round(t, 2), rd.seconds))
        t += step
    cap.release()
    cm.segments = _segments(cm.reads)
    return cm


def save(cm: ClockMap, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump({**cm.to_json(), "raw": cm.reads}, f, indent=1)
