"""Lecture locale du score de kills des deux équipes (bandeau du haut).

Preuve indépendante qu'un clip montre le bon kill : le score de l'équipe du
tueur passe de n à n+1 dans le clip, aux valeurs que donne le feed. Le
bandeau du haut reste affiché quand le tableau des joueurs du bas change de
mise en page (combats) — contrairement aux portraits du HUD.

Pas d'étiquetage à la main : les modèles de chiffres s'apprennent depuis le
feed (`learn`), sur des images où l'on connaît le score (aucun kill à moins
de quelques secondes). Gauche = côté bleu, droite = côté rouge.

Zones (1080p, x0 y0 x1 y1) mesurées le 21/10/2026 :
  worlds26 : C9 2 · KC 4 au centre du bandeau (Worlds 2026 / LEC 2026)
  ewc26    : KC 11 · T1 23, grands chiffres de part et d'autre des logos
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from engine_v2.chrono import NORM, _binarize, _components

ZONES: dict[str, dict[str, tuple[int, int, int, int]]] = {
    "worlds26": {"left": (868, 14, 948, 62), "right": (972, 14, 1052, 62)},
    "ewc26": {"left": (700, 6, 792, 60), "right": (1128, 6, 1220, 60)},
}
STORE = Path(__file__).resolve().parent / "templates"
MIN_SCORE = 0.75
MIN_MARGIN = 0.06       # écart minimal avec le 2e chiffre candidat (un 9 inconnu lu « 6 », G5 27:54)
MAX_TEMPLATES = 6


@dataclass
class ScoreRead:
    left: int | None
    right: int | None


def _crop(im: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    h, w = im.shape[:2]
    sx, sy = w / 1920, h / 1080
    x0, y0, x1, y1 = box
    return im[int(y0 * sy):int(y1 * sy), int(x0 * sx):int(x1 * sx)]


def _digits(bw: np.ndarray) -> list[tuple[int, int, int, int, int]] | None:
    comps = _components(bw)
    if not comps:
        return None
    hmax = max(b[3] for b in comps)
    if hmax < bw.shape[0] * 0.35:
        return None
    digits = [b for b in comps if b[3] >= hmax * 0.8]
    if not 1 <= len(digits) <= 2:
        return None
    return digits


def _norm(bw: np.ndarray, box) -> np.ndarray:
    x, y, w, h, _ = box
    return cv2.resize(bw[y:y + h, x:x + w], NORM, interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0


class ScoreReader:
    def __init__(self, profile: str):
        self.profile = profile
        self.dir = STORE / f"score_{profile}"
        self.templates: dict[str, list[np.ndarray]] = {}
        if self.dir.exists():
            for p in sorted(self.dir.glob("*.png")):
                self.templates.setdefault(p.name[0], []).append(
                    cv2.imread(str(p), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0)

    def _side(self, im: np.ndarray, side: str):
        bw = _binarize(_crop(im, ZONES[self.profile][side]))
        return bw, _digits(bw)

    def learn(self, im: np.ndarray, left: int, right: int) -> int:
        """Apprend les chiffres d'une image dont on connaît le score. Rend le
        nombre de chiffres appris (0 si la segmentation ne colle pas)."""
        n = 0
        for side, value in (("left", left), ("right", right)):
            bw, digits = self._side(im, side)
            labels = str(value)
            if digits is None or len(digits) != len(labels):
                continue
            for lab, box in zip(labels, digits):
                have = self.templates.setdefault(lab, [])
                if len(have) >= MAX_TEMPLATES:
                    continue
                t = _norm(bw, box)
                if any(float(cv2.matchTemplate(t, x, cv2.TM_CCOEFF_NORMED)[0, 0]) > 0.97 for x in have):
                    continue    # doublon
                have.append(t)
                self.dir.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(self.dir / f"{lab}_{len(have)}.png"), (t * 255).astype(np.uint8))
                n += 1
        return n

    @property
    def calibrated(self) -> bool:
        return all(str(d) in self.templates for d in range(10))

    def _read_side(self, im: np.ndarray, side: str) -> int | None:
        bw, digits = self._side(im, side)
        if digits is None or not self.templates:
            return None
        out = ""
        for box in digits:
            t = _norm(bw, box)
            per: dict[str, float] = {}
            for lab, tpls in self.templates.items():
                per[lab] = max(float(cv2.matchTemplate(t, tp, cv2.TM_CCOEFF_NORMED)[0, 0]) for tp in tpls)
            ranked = sorted(per.items(), key=lambda x: -x[1])
            if not ranked or ranked[0][1] < MIN_SCORE:
                return None
            if len(ranked) > 1 and ranked[0][1] - ranked[1][1] < MIN_MARGIN:
                return None
            out += ranked[0][0]
        return int(out)

    def read(self, im: np.ndarray) -> ScoreRead:
        return ScoreRead(self._read_side(im, "left"), self._read_side(im, "right"))
