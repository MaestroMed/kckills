"""Morts lues dans le tableau des 10 joueurs du HUD (diffusion 2026, 1080p).

Le portrait d'un champion passe en gris pendant sa mort (temps de
réapparition ≥ 6 s). On mesure la saturation de chaque portrait une fois
par seconde ; une mort = saturation sous 45 % de sa valeur de référence
pendant au moins 4 s. Le tableau se met à jour à 1 Hz (LoLscan, LECONS.md) :
la précision est de l'ordre de la seconde, ce qui suffit pour vérifier
qu'un kill annoncé par le feed est bien à l'écran à l'instant prévu.

Coordonnées reprises de lolscan/hud.py (mesurées sur les Worlds 2026) :
portraits x = 731 (gauche) / 1185 (droite), lignes y = 836…1045 (top → support).
Quand le tableau disparaît (caméras joueurs, version compacte, replay),
tous les portraits « grisent » ensemble : ces instants sont ignorés.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

XP = {"left": 731, "right": 1185}
Y = [836, 888, 940, 993, 1045]


@dataclass
class Death:
    side: str      # "left" | "right"
    row: int       # 0 top … 4 support
    t: float       # seconde du fichier où le portrait grise
    until: float   # fin du gris (réapparition)


def _sat(im: np.ndarray, x: int, y: int, r: int = 12) -> float:
    h, w = im.shape[:2]
    sx, sy = w / 1920, h / 1080
    x, y, r = int(x * sx), int(y * sy), max(4, int(r * sx))
    z = cv2.cvtColor(im[y - r:y + r + 1, x - r:x + r + 1], cv2.COLOR_BGR2HSV)
    return float(z[..., 1].mean())


def series(video: str, start: float, end: float, step: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """T (n,), S (n, 10) : saturation des 10 portraits (5 gauche puis 5 droite)."""
    cap = cv2.VideoCapture(video)
    T, S = [], []
    t = start
    while t < end:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, im = cap.read()
        if not ok:
            break
        T.append(t)
        S.append([_sat(im, XP[s], y) for s in ("left", "right") for y in Y])
        t += step
    cap.release()
    return np.array(T), np.array(S)


def deaths(T: np.ndarray, S: np.ndarray, ratio: float = 0.45, min_len: float = 4.0, step: float = 1.0) -> list[Death]:
    if not len(T):
        return []
    ref = np.percentile(S, 75, axis=0)                     # saturation « vivant » de chaque portrait
    low = S < ratio * ref[None, :]
    hidden = low.sum(axis=1) >= 6                          # tableau absent : tout le monde « gris »
    low[hidden] = False
    out: list[Death] = []
    for k in range(S.shape[1]):
        i = 0
        while i < len(T):
            if low[i, k] and not hidden[i]:
                j = i
                while j + 1 < len(T) and (low[j + 1, k] or hidden[j + 1]):
                    j += 1
                if T[j] - T[i] + step >= min_len:
                    out.append(Death("left" if k < 5 else "right", k % 5, float(T[i]), float(T[j] + step)))
                i = j + 1
            else:
                i += 1
    return sorted(out, key=lambda d: d.t)
