"""
AUDIO_SYNC — Alignement inter-sources par corrélation croisée audio.

Cas d'usage : la VOD officielle LEC est décryptée (modèle de drift
fiable) et on veut caler une source ALTERNATIVE (Kameto, EtoStark,
KC Replay) sans re-décrypter par vision — ou quand son HUD est masqué
par un overlay webcam. Les deux flux partagent le SON DU JEU (les voix
des casters diffèrent mais les bruits de teamfight, annonces et musiques
d'ambiance sont communs et très énergétiques).

Méthode : extraire un extrait mono 8 kHz de la source de référence à un
moment BRUYANT connu (un teamfight — on a les kills !), extraire une
fenêtre de recherche large autour de la position attendue dans la source
alternative, corrélation croisée normalisée par FFT → lag + score.
Score < seuil = pas d'alignement fiable (rendre None, jamais deviner).

Local, gratuit (ffmpeg + numpy). Dépendance numpy optionnelle.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import structlog

log = structlog.get_logger()

try:
    import numpy as np
    AVAILABLE = True
except Exception:  # pragma: no cover
    np = None
    AVAILABLE = False

SAMPLE_RATE = 8000
MIN_SCORE = 0.35     # corrélation normalisée minimale pour un verdict
SNIPPET_S = 20       # durée de l'extrait de référence
SEARCH_S = 120       # fenêtre de recherche dans la source alternative


async def extract_audio(
    source: str,
    start_s: float,
    duration_s: float,
    sr: int = SAMPLE_RATE,
):
    """PCM float32 mono via ffmpeg. → np.ndarray ou None."""
    if not AVAILABLE:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-ss", str(max(0, start_s)),
            "-i", source, "-t", str(duration_s),
            "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=180)
        if proc.returncode != 0 or not out:
            return None
        return np.frombuffer(out, dtype=np.float32)
    except (asyncio.TimeoutError, OSError):
        try:
            proc.kill()
        except Exception:
            pass
        return None


def correlate_offset(ref, cand, sr: int = SAMPLE_RATE) -> tuple[Optional[float], float]:
    """Corrélation croisée normalisée (FFT). ref doit être PLUS COURT que
    cand. → (lag_secondes du début de ref dans cand, score 0-1).

    Normalisation par fenêtre glissante d'énergie : un simple argmax de
    xcorr favoriserait les zones bruyantes de cand ; on divise par
    ||ref||·||cand_fenêtre|| pour un vrai cosinus par position."""
    if not AVAILABLE or ref is None or cand is None:
        return None, 0.0
    n_ref, n_cand = len(ref), len(cand)
    if n_ref < sr or n_cand <= n_ref:
        return None, 0.0

    ref = ref - ref.mean()
    cand = cand - cand.mean()
    ref_norm = float(np.sqrt((ref ** 2).sum()))
    if ref_norm < 1e-6:
        return None, 0.0

    n_fft = 1 << int(np.ceil(np.log2(n_cand + n_ref)))
    corr = np.fft.irfft(
        np.fft.rfft(cand, n_fft) * np.conj(np.fft.rfft(ref, n_fft)), n_fft
    )[: n_cand - n_ref + 1]

    # énergie glissante de cand sur la longueur de ref (cumsum O(n))
    csum = np.concatenate(([0.0], np.cumsum(cand.astype(np.float64) ** 2)))
    win_energy = csum[n_ref:] - csum[: n_cand - n_ref + 1]
    win_norm = np.sqrt(np.maximum(win_energy, 1e-12))

    scores = corr / (ref_norm * win_norm)
    best = int(np.argmax(scores))
    return best / sr, float(scores[best])


async def align_alt_source(
    official_source: str,
    alt_source: str,
    official_vod_time: float,
    alt_expected_vod_time: float,
    *,
    snippet_s: float = SNIPPET_S,
    search_s: float = SEARCH_S,
) -> tuple[Optional[float], float]:
    """Cale la source alternative sur l'officielle autour d'un moment
    bruyant connu (typiquement un teamfight, `official_vod_time`).

    → (correction en secondes à AJOUTER à alt_expected_vod_time,
       score de confiance 0-1). (None, 0) si audio illisible ou
       corrélation sous MIN_SCORE — ne JAMAIS utiliser un alignement
       douteux, l'appelant garde sa voie vision."""
    ref = await extract_audio(official_source, official_vod_time, snippet_s)
    cand_start = max(0, alt_expected_vod_time - search_s / 2)
    cand = await extract_audio(alt_source, cand_start, search_s + snippet_s)
    lag, score = correlate_offset(ref, cand)
    if lag is None or score < MIN_SCORE:
        log.info("audio_sync_no_match", score=round(score, 3))
        return None, score
    found_vod_time = cand_start + lag
    correction = round(found_vod_time - alt_expected_vod_time, 2)
    log.info("audio_sync_aligned", correction=correction,
             score=round(score, 3))
    return correction, score
