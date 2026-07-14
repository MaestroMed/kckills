"""
KILLFEED — Détection locale d'activité dans la zone killfeed (0 token).

Le killfeed LoL (bannières kill en haut à droite) est une ancre visuelle
DIRECTE du moment du kill — indépendante du timer. Quand une bannière
apparaît, la zone change brutalement entre deux frames ; entre deux
événements elle est quasi statique.

Usage :
  * QC `kill_visible` sans Gemini : « y a-t-il une activité killfeed à
    ±10 s du moment attendu du kill dans le clip ? » ;
  * affinage du placement : le burst le plus proche du moment attendu
    donne la correction fine (le livestats date les kills à ~10 s près,
    frames espacées de 10 s).

Méthode : ffmpeg extrait la zone croppée à `fps` images/s sur la fenêtre,
OpenCV calcule la différence absolue moyenne entre frames consécutives,
un z-score sur la série localise les bursts. Local, gratuit, rapide
(zone minuscule ~22 % × 26 % de l'écran, scalée à 160 px).

Dépendances optionnelles cv2/numpy (comme timer_ocr) : absentes →
AVAILABLE=False, tous les appels rendent None et l'appelant retombe sur
la voie vision classique.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from typing import Optional

import structlog

log = structlog.get_logger()

try:
    import cv2
    import numpy as np
    AVAILABLE = True
except Exception:  # pragma: no cover
    cv2 = None
    np = None
    AVAILABLE = False

# Zone killfeed en fractions de frame (x0, y0, x1, y1). Le killfeed LoL
# broadcast vit sous le scoreboard, quart haut-droit.
KILLFEED_REGION = (0.76, 0.10, 1.00, 0.40)
DEFAULT_FPS = 2
BURST_Z_THRESHOLD = 5.0       # en unités de MAD (≈3.4σ) : une bannière
                              # kill fait un pic ×5-10 sur le fond, alors
                              # que 2-3 MAD laisse passer ~5-7 % du bruit
                              # gaussien de la caméra (faux positifs)
MIN_FRAMES = 8                # série trop courte = pas exploitable


async def _extract_region_frames(
    source: str,
    start_s: float,
    duration_s: float,
    fps: int = DEFAULT_FPS,
) -> list:
    """Extrait la zone killfeed en petites frames grises via UN run
    ffmpeg. Retourne une liste d'arrays numpy (grayscale)."""
    if not AVAILABLE:
        return []
    x0, y0, x1, y1 = KILLFEED_REGION
    crop = (f"crop=iw*{x1 - x0:.3f}:ih*{y1 - y0:.3f}:"
            f"iw*{x0:.3f}:ih*{y0:.3f}")
    with tempfile.TemporaryDirectory(prefix="killfeed_") as tmp:
        pattern = os.path.join(tmp, "kf_%04d.png")
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-hide_banner", "-ss", str(max(0, start_s)),
                "-i", source, "-t", str(duration_s),
                "-vf", f"fps={fps},{crop},scale=160:-1,format=gray",
                "-y", pattern,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=120)
        except (asyncio.TimeoutError, OSError):
            try:
                proc.kill()
            except Exception:
                pass
            return []
        frames = []
        for name in sorted(os.listdir(tmp)):
            img = cv2.imread(os.path.join(tmp, name), cv2.IMREAD_GRAYSCALE)
            if img is not None:
                frames.append(img)
        return frames


def activity_series(frames: list) -> list[float]:
    """Différence absolue moyenne entre frames consécutives."""
    if not AVAILABLE or len(frames) < 2:
        return []
    out = []
    for a, b in zip(frames, frames[1:]):
        if a.shape != b.shape:
            out.append(0.0)
            continue
        out.append(float(cv2.absdiff(a, b).mean()))
    return out


def detect_bursts(
    series: list[float],
    fps: int = DEFAULT_FPS,
    z_threshold: float = BURST_Z_THRESHOLD,
) -> list[float]:
    """Temps (s, relatifs au début de la série) des pics d'activité.
    Un burst = valeur > médiane + z_threshold × MAD (robuste au bruit de
    fond : la caméra du jeu fait bouger un peu la zone en continu).
    Les secondes consécutives au-dessus du seuil fusionnent en UN burst
    (une bannière reste animée ~1-2 s)."""
    if len(series) < MIN_FRAMES:
        return []
    med = sorted(series)[len(series) // 2]
    mad = sorted(abs(v - med) for v in series)[len(series) // 2]
    scale = max(mad, 1e-3)
    bursts = []
    in_burst = False
    for i, v in enumerate(series):
        hot = (v - med) / scale >= z_threshold
        if hot and not in_burst:
            bursts.append(i / fps)
            in_burst = True
        elif not hot:
            in_burst = False
    return bursts


async def kill_activity_near(
    source: str,
    expected_vod_time: float,
    window_s: float = 40,
    fps: int = DEFAULT_FPS,
) -> Optional[float]:
    """Cherche un burst killfeed autour du moment attendu du kill.

    → décalage en secondes du burst le plus proche (burst - attendu),
      ou None si zone illisible / aucun burst. |décalage| ≤ ~12 s est
      normal (le livestats date les kills à la frame de 10 s près)."""
    if not AVAILABLE:
        return None
    start = max(0, expected_vod_time - window_s / 2)
    frames = await _extract_region_frames(source, start, window_s, fps)
    series = activity_series(frames)
    bursts = detect_bursts(series, fps)
    if not bursts:
        return None
    center = expected_vod_time - start
    nearest = min(bursts, key=lambda t: abs(t - center))
    return round(nearest - center, 1)
