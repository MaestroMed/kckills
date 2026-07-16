"""
TIMER_OCR — Lecture locale (0 token) du timer in-game LoL, auto-calibrée.

Pourquoi : chaque lecture de timer coûtait 1 appel Gemini. Le backfill
multi-points en fait 5-8 par game × ~600 games × retries — c'est LE poste
de dépense qui a vidé le cap (cf. docs/ETAT_DES_LIEUX_2026-07-14.md §6).
Ce module lit le timer par template matching OpenCV, gratuitement.

Principe d'auto-calibration (« Gemini enseigne, l'OCR répète ») :
  * Au début on ne sait rien lire. Chaque frame que Gemini lit avec succès
    passe par learn(frame, seconds) : on localise les chiffres du timer
    dans la zone du HUD, on découpe chaque chiffre, on l'enregistre comme
    template étiqueté (par profil d'overlay : LEC top-center, LFL top-left).
  * Dès qu'un profil a des templates pour les 10 chiffres, read() devient
    autonome : segmentation + matchTemplate + assemblage MM:SS.
  * Un score de match faible → on rend None et l'appelant retombe sur
    Gemini (qui ré-enseigne au passage). L'OCR ne DEVINE jamais.

Dépendances optionnelles : cv2 + numpy. Absentes → AVAILABLE=False et
tous les appels rendent None ; le pipeline fonctionne en Gemini-only.

Stockage templates : worker/cache/timer_ocr/<profile>/<digit>_<n>.png
  + meta.json {profile: {box: [x0,y0,x1,y1] relatif 0-1, samples: int}}
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger()

try:  # deps optionnelles — le worker doit tourner sans
    import cv2
    import numpy as np
    AVAILABLE = True
except Exception:  # pragma: no cover - environnement sans cv2
    cv2 = None
    np = None
    AVAILABLE = False

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "timer_ocr"

# Zones candidates du timer, en fractions de la frame (x0, y0, x1, y1).
# LEC : top-center. LFL/OTPLOL : top-left près des scores. On garde les
# deux et read() essaie chaque profil calibré.
PROFILES: dict[str, tuple[float, float, float, float]] = {
    "top_center": (0.42, 0.00, 0.58, 0.10),
    "top_left":   (0.05, 0.00, 0.30, 0.12),
}

MAX_TEMPLATES_PER_DIGIT = 8      # au-delà on n'apprend plus (suffisant)
MATCH_THRESHOLD = 0.78           # score matchTemplate min par chiffre
READ_CONFIDENCE_FLOOR = 0.80     # score moyen min pour rendre un résultat
DIGIT_MIN_HEIGHT_FRAC = 0.25     # hauteur min d'un chiffre vs zone croppée
MAX_TIMER_MINUTES = 90           # sanity : un game LoL ne dure pas 2 h


def _profile_dir(profile: str) -> Path:
    d = CACHE_DIR / profile
    d.mkdir(parents=True, exist_ok=True)
    return d


def _binarize(gray):
    """Texte clair sur fond sombre → binaire. Le HUD LoL affiche le timer
    en blanc/doré ; un seuil haut isole bien les glyphes."""
    _, bw = cv2.threshold(gray, 170, 255, cv2.THRESH_BINARY)
    return bw


def _segment_digits(bw) -> list[tuple[int, int, int, int]]:
    """Boxes (x, y, w, h) des composantes 'chiffre', triées par x.
    Filtre le ':' (petit) et le bruit (composantes minuscules ou plates),
    puis isole le CLUSTER timer : la zone croppée contient aussi les scores
    K/D, l'or et des icônes (8-9 boxes observées en pratique) — le timer, lui,
    est un run de 3-5 chiffres de hauteur uniforme, alignés sur la même ligne,
    à espacement serré. Sans ce filtre, read() s'abstenait sur ~100 % des
    frames réelles (benchmark 2026-07-16 : 0/24 lectures)."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(bw, connectivity=8)
    boxes = []
    zone_h = bw.shape[0]
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if h < zone_h * DIGIT_MIN_HEIGHT_FRAC:
            continue                      # ':' ou poussière
        if w > h * 1.2 or area < 12:
            continue                      # trop plat / trop petit
        boxes.append((int(x), int(y), int(w), int(h)))
    boxes.sort(key=lambda b: b[0])
    if len(boxes) <= 5:
        return boxes
    return _timer_cluster(boxes) or boxes


def _timer_cluster(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """Extrait le run 3-5 boxes le plus 'timer-like' d'un ensemble bruité.

    Critères : hauteur uniforme (±25 %), même ligne (centres y à ±40 % de h),
    espacement horizontal serré (gap < ~1.6× la largeur médiane du run).
    Préfère les runs de 4 chiffres (MM:SS) puis 3 (M:SS) puis 5 (MMM:SS).
    Retourne [] si aucun run plausible — l'appelant garde alors son gate 3-5.
    """
    best: list[tuple[int, int, int, int]] = []
    n = len(boxes)
    for i in range(n):
        run = [boxes[i]]
        for j in range(i + 1, n):
            prev, cand = run[-1], boxes[j]
            ref_h = run[0][3]
            med_w = sorted(b[2] for b in run)[len(run) // 2]
            gap = cand[0] - (prev[0] + prev[2])
            same_h = abs(cand[3] - ref_h) <= ref_h * 0.25
            same_row = abs((cand[1] + cand[3] / 2) - (run[0][1] + ref_h / 2)) <= ref_h * 0.4
            near = gap <= max(int(med_w * 1.6), 10)
            if same_h and same_row and near:
                run.append(cand)
            elif cand[0] > prev[0] + prev[2] + max(int(med_w * 1.6), 10):
                break                     # trou trop grand : le run est fini
        if 3 <= len(run) <= 5:
            # Priorité au format MM:SS (4 chiffres), puis M:SS (3), puis 5.
            rank = {4: 3, 3: 2, 5: 1}[len(run)]
            best_rank = {4: 3, 3: 2, 5: 1}.get(len(best), 0)
            if rank > best_rank:
                best = run
    return best


def _crop_zone(img, box_frac):
    h, w = img.shape[:2]
    x0, y0, x1, y1 = box_frac
    return img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]


def _norm_digit(bw, box):
    x, y, w, h = box
    crop = bw[y:y + h, x:x + w]
    return cv2.resize(crop, (20, 32), interpolation=cv2.INTER_AREA)


def _load_templates(profile: str) -> dict[str, list]:
    """{digit_char: [img, ...]}"""
    out: dict[str, list] = {}
    d = _profile_dir(profile)
    for p in d.glob("[0-9]_*.png"):
        digit = p.name[0]
        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if img is not None:
            out.setdefault(digit, []).append(img)
    return out


def is_calibrated(profile: str | None = None) -> bool:
    """Un profil est calibré quand chaque chiffre 0-9 a ≥1 template."""
    if not AVAILABLE:
        return False
    profiles = [profile] if profile else list(PROFILES)
    for prof in profiles:
        t = _load_templates(prof)
        if all(str(d) in t for d in range(10)):
            return True
    return False


def learn(frame_path: str, known_seconds: int) -> bool:
    """Apprend des templates depuis une frame dont Gemini a lu le timer.

    On sait que la frame affiche MM:SS = known_seconds. Pour chaque profil,
    on segmente la zone ; si le nombre de chiffres trouvés colle au format
    attendu, on étiquette de gauche à droite et on sauvegarde.
    Retourne True si au moins un profil a appris quelque chose.
    """
    if not AVAILABLE or known_seconds is None or known_seconds < 0:
        return False
    expected = f"{known_seconds // 60}:{known_seconds % 60:02d}"
    digits_expected = [c for c in expected if c.isdigit()]

    img = cv2.imread(frame_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return False

    learned = False
    for prof, box_frac in PROFILES.items():
        zone = _crop_zone(img, box_frac)
        if zone.size == 0:
            continue
        bw = _binarize(zone)
        boxes = _segment_digits(bw)
        if len(boxes) != len(digits_expected):
            continue  # segmentation ne colle pas au format → pas fiable
        d = _profile_dir(prof)
        counts = {str(k): len(list(d.glob(f"{k}_*.png"))) for k in range(10)}
        for box, digit in zip(boxes, digits_expected):
            if counts.get(digit, 0) >= MAX_TEMPLATES_PER_DIGIT:
                continue
            tpl = _norm_digit(bw, box)
            fname = d / f"{digit}_{int(time.time() * 1000) % 10_000_000}.png"
            cv2.imwrite(str(fname), tpl)
            counts[digit] = counts.get(digit, 0) + 1
            learned = True
        if learned:
            log.info("timer_ocr_learned", profile=prof,
                     value=expected, digits=len(boxes))
    return learned


def _match_digit(tpl_norm, templates: dict[str, list]) -> tuple[Optional[str], float]:
    best_digit, best_score = None, 0.0
    for digit, tpls in templates.items():
        for t in tpls:
            res = cv2.matchTemplate(tpl_norm, t, cv2.TM_CCOEFF_NORMED)
            score = float(res.max())
            if score > best_score:
                best_digit, best_score = digit, score
    return best_digit, best_score


def read(frame_path: str) -> tuple[Optional[int], float, Optional[str]]:
    """Lit le timer localement.

    Returns (seconds | None, confidence 0-1, profile | None).
    None si pas calibré, segmentation douteuse ou score sous le plancher —
    dans ce cas l'appelant DOIT retomber sur Gemini, jamais deviner.
    """
    if not AVAILABLE:
        return None, 0.0, None
    img = cv2.imread(frame_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None, 0.0, None

    best: tuple[Optional[int], float, Optional[str]] = (None, 0.0, None)
    for prof, box_frac in PROFILES.items():
        templates = _load_templates(prof)
        if not all(str(d) in templates for d in range(10)):
            continue  # profil pas encore calibré
        zone = _crop_zone(img, box_frac)
        if zone.size == 0:
            continue
        bw = _binarize(zone)
        boxes = _segment_digits(bw)
        if not 3 <= len(boxes) <= 5:  # M:SS → MMM:SS ; sinon pas un timer
            continue
        digits, scores = [], []
        for box in boxes:
            digit, score = _match_digit(_norm_digit(bw, box), templates)
            if digit is None or score < MATCH_THRESHOLD:
                digits = []
                break
            digits.append(digit)
            scores.append(score)
        if not digits:
            continue
        # Assemble : les 2 derniers chiffres = SS, le reste = MM
        mm = int("".join(digits[:-2]))
        ss = int("".join(digits[-2:]))
        if ss >= 60 or mm > MAX_TIMER_MINUTES:
            continue
        conf = sum(scores) / len(scores)
        if conf >= READ_CONFIDENCE_FLOOR and conf > best[1]:
            best = (mm * 60 + ss, conf, prof)
    return best


def stats() -> dict:
    """Pour le monitoring : nb de templates par profil."""
    out = {"available": AVAILABLE}
    if not AVAILABLE:
        return out
    for prof in PROFILES:
        d = _profile_dir(prof)
        out[prof] = {str(k): len(list(d.glob(f"{k}_*.png"))) for k in range(10)}
        out[f"{prof}_calibrated"] = is_calibrated(prof)
    return out
