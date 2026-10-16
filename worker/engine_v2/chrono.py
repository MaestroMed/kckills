"""Lecture locale du chrono de la partie (MM:SS) dans le HUD de diffusion.

Pourquoi : la sync Twitch lit le chrono avec Gemini (un appel par lecture).
Ici, zéro jeton : découpe de la zone du chrono, binarisation (chiffres
blancs sur fond sombre), segmentation en composantes, et comparaison de
chaque chiffre à des modèles appris sur quelques images étiquetées.

Profils (fractions de l'image, 16:9) :
  worlds26_row : HUD Worlds 2026 / LEC 2026 — chrono sur la 2e ligne du
                 bandeau du haut, centré (1080p : x 937-985, y 78-100).

Garde-fous : la lecture exige exactement 4 chiffres + 2 points au bon
endroit (MM:SS, secondes < 60) et un score de ressemblance minimal par
chiffre. Une barre de vie qui passe sur le chrono, une coupe de la régie,
un replay sans HUD : la lecture rend None. Le lecteur ne devine jamais.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

PROFILES: dict[str, tuple[float, float, float, float]] = {
    # x0, y0, x1, y1 — un peu plus large que les chiffres pour tolérer ±10 px
    "worlds26_row": (0.470, 0.062, 0.530, 0.100),
}

# Versionnés avec le code : le moteur lit dès le premier lancement.
STORE = Path(__file__).resolve().parent / "templates"
NORM = (14, 22)                # taille normalisée d'un chiffre (l, h)
MIN_SCORE = 0.72               # corrélation minimale par chiffre
MAX_TEMPLATES = 6              # par chiffre


@dataclass
class Read:
    seconds: int | None
    score: float
    text: str | None


def _crop(img: np.ndarray, profile: str) -> np.ndarray:
    h, w = img.shape[:2]
    x0, y0, x1, y1 = PROFILES[profile]
    return img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]


def _binarize(crop: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    # chiffres : blanc cassé, peu saturés, très lumineux
    mask = (hsv[..., 2] > 165) & (hsv[..., 1] < 70)
    return mask.astype(np.uint8) * 255


def _components(bw: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """Boîtes (x, y, w, h, aire) triées de gauche à droite."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(bw, connectivity=8)
    hh = bw.shape[0]
    out = []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if a < 6 or h > hh * 0.95:
            continue
        out.append((int(x), int(y), int(w), int(h), int(a)))
    return sorted(out, key=lambda b: b[0])


def _split(bw: np.ndarray):
    """Les 4 chiffres et les 2 points d'un « MM:SS », ou None."""
    comps = _components(bw)
    if not comps:
        return None
    hmax = max(b[3] for b in comps)
    digits = [b for b in comps if b[3] >= hmax * 0.7]
    dots = [b for b in comps if b[3] < hmax * 0.4 and b[2] < hmax * 0.5]
    if len(digits) != 4:
        return None
    # les deux points doivent tomber entre le 2e et le 3e chiffre
    gap_l, gap_r = digits[1][0] + digits[1][2], digits[2][0]
    if not any(gap_l - 2 <= d[0] <= gap_r + 2 for d in dots):
        return None
    # chiffres de même hauteur, alignés
    hs = [b[3] for b in digits]
    if max(hs) - min(hs) > 3:
        return None
    return digits


def _norm(bw: np.ndarray, box) -> np.ndarray:
    x, y, w, h, _ = box
    d = bw[y:y + h, x:x + w]
    return cv2.resize(d, NORM, interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0


def _load(profile: str) -> dict[str, list[np.ndarray]]:
    d = STORE / profile
    out: dict[str, list[np.ndarray]] = {}
    if not d.exists():
        return out
    for p in sorted(d.glob("*.png")):
        out.setdefault(p.name[0], []).append(cv2.imread(str(p), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0)
    return out


class ChronoReader:
    def __init__(self, profile: str = "worlds26_row"):
        self.profile = profile
        self.templates = _load(profile)

    @property
    def calibrated(self) -> bool:
        return all(str(k) in self.templates for k in range(10))

    def learn(self, img: np.ndarray, mmss: str) -> bool:
        """Apprend les 4 chiffres d'une image dont on connaît le chrono (« 16:06 »)."""
        digits = _split(_binarize(_crop(img, self.profile)))
        labels = mmss.replace(":", "")
        if digits is None or len(labels) != 4:
            return False
        bw = _binarize(_crop(img, self.profile))
        d = STORE / self.profile
        d.mkdir(parents=True, exist_ok=True)
        for lab, box in zip(labels, digits):
            have = self.templates.setdefault(lab, [])
            if len(have) >= MAX_TEMPLATES:
                continue
            t = _norm(bw, box)
            have.append(t)
            cv2.imwrite(str(d / f"{lab}_{len(have)}.png"), (t * 255).astype(np.uint8))
        return True

    def _match(self, t: np.ndarray) -> tuple[str | None, float]:
        best, score = None, -1.0
        for lab, tpls in self.templates.items():
            for tp in tpls:
                s = float(cv2.matchTemplate(t, tp, cv2.TM_CCOEFF_NORMED)[0, 0])
                if s > score:
                    best, score = lab, s
        return best, score

    def read(self, img: np.ndarray) -> Read:
        if not self.calibrated:
            return Read(None, 0.0, None)
        bw = _binarize(_crop(img, self.profile))
        digits = _split(bw)
        if digits is None:
            return Read(None, 0.0, None)
        labs, scores = [], []
        for box in digits:
            lab, s = self._match(_norm(bw, box))
            if lab is None or s < MIN_SCORE:
                return Read(None, s, None)
            labs.append(lab)
            scores.append(s)
        mm, ss = int(labs[0] + labs[1]), int(labs[2] + labs[3])
        if ss >= 60:
            return Read(None, min(scores), None)
        return Read(mm * 60 + ss, min(scores), f"{labs[0]}{labs[1]}:{labs[2]}{labs[3]}")


def frame_at(cap: cv2.VideoCapture, t: float) -> np.ndarray | None:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
    ok, im = cap.read()
    return im if ok else None


def calibrate_from_labels(video: str, labels: dict[float, str], profile: str = "worlds26_row") -> dict:
    """labels = {position dans le fichier (s): « MM:SS » lu à l'œil}."""
    r = ChronoReader(profile)
    cap = cv2.VideoCapture(video)
    learned = {}
    for t, mmss in labels.items():
        im = frame_at(cap, t)
        learned[t] = bool(im is not None and r.learn(im, mmss))
    cap.release()
    (STORE / profile).mkdir(parents=True, exist_ok=True)
    (STORE / profile / "labels.json").write_text(json.dumps({"video": video, "labels": labels, "learned": learned}, indent=1))
    return {"calibrated": r.calibrated, "learned": learned, "digits": {k: len(v) for k, v in sorted(r.templates.items())}}
