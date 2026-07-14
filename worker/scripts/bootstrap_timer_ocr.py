# -*- coding: utf-8 -*-
"""
BOOTSTRAP_TIMER_OCR — Calibre l'OCR local depuis les clips déjà publiés,
SANS AUCUN appel Gemini.

Principe : un clip publié validé montre, à t=15 s dans le clip, le timer
in-game gt - before + 15 (before = pad du CLIP_TIMING, 30 s). On extrait
la frame directement depuis R2 (egress gratuit) et on l'apprend comme
template étiqueté (modules/timer_ocr.learn).

Anti-poison : certains clips publiés ont un offset faux (c'est le
problème qu'on répare !) → un label erroné apprendrait de mauvais
chiffres. Protections :
  1. learn() ne retient une frame que si la segmentation trouve
     EXACTEMENT le nombre de chiffres du timer attendu ;
  2. MAX_TEMPLATES_PER_DIGIT=8 + vote au match → un template
     empoisonné isolé perd le vote ;
  3. phase de VALIDATION : après apprentissage, on relit un échantillon
     de frames tenues à l'écart et on mesure l'accord lecture ↔ attendu
     (drift ≤ 45 s = OK, le clip peut légitimement dériver un peu).
     Précision < 70 % → on RAZ les templates (--auto-reset).

Usage :
    python scripts/bootstrap_timer_ocr.py                # 60 clips, apprend + valide
    python scripts/bootstrap_timer_ocr.py --sample 120
    python scripts/bootstrap_timer_ocr.py --reset        # RAZ des templates d'abord
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import structlog  # noqa: E402

structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

from config import config  # noqa: E402
from services.supabase_client import get_db  # noqa: E402
from modules import timer_ocr  # noqa: E402
from modules.decryptage import _extract_frame  # noqa: E402

FRAME_POS = 15          # position dans le clip
BEFORE_PAD = 30         # CLIP_TIMING before (tous les tiers = 30)
VALIDATE_DRIFT_OK = 45  # un clip legacy peut dériver ; ≤45 s compte "accord"


def fetch_candidates(db, n: int) -> list[dict]:
    client = db._get_client()
    rows, offset = [], 0
    while True:
        r = client.get(f"{db.base}/kills", params={
            "select": "id,game_time_seconds,clip_url_horizontal",
            "status": "eq.published",
            "clip_url_horizontal": "not.is.null",
            "game_time_seconds": "gte.120",   # timer à 2 chiffres de minutes
            "limit": "1000", "offset": str(offset),
        })
        r.raise_for_status()
        batch = r.json() or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    random.shuffle(rows)
    return rows[: n * 3]   # marge : certaines frames seront illisibles


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=60)
    ap.add_argument("--reset", action="store_true",
                    help="RAZ des templates avant apprentissage")
    ap.add_argument("--auto-reset", action="store_true", default=True,
                    help="RAZ si la validation < 70%% (défaut on)")
    args = ap.parse_args()

    if not timer_ocr.AVAILABLE:
        print("OpenCV/numpy manquants — pip install -r requirements.txt")
        return 1
    if args.reset and timer_ocr.CACHE_DIR.exists():
        shutil.rmtree(timer_ocr.CACHE_DIR)
        print("Templates RAZ.")

    db = get_db()
    if db is None:
        print("Supabase indisponible")
        return 1

    candidates = fetch_candidates(db, args.sample)
    print(f"{len(candidates)} clips candidats (cible {args.sample} apprentissages)")

    tmp_dir = os.path.join(getattr(config, "CLIPS_DIR", "."), "ocr_bootstrap")
    os.makedirs(tmp_dir, exist_ok=True)

    learned, holdout = 0, []
    for k in candidates:
        if learned >= args.sample:
            break
        expected = (k["game_time_seconds"] or 0) - BEFORE_PAD + FRAME_POS
        if expected < 60:
            continue
        frame = os.path.join(tmp_dir, f"{k['id']}.jpg")
        if not await _extract_frame(k["clip_url_horizontal"], FRAME_POS, frame):
            continue
        # 1 frame sur 5 part en holdout de validation (jamais apprise)
        if learned % 5 == 4:
            holdout.append((frame, expected))
            learned += 1
            continue
        if timer_ocr.learn(frame, expected):
            learned += 1
        try:
            if (frame, expected) not in holdout:
                os.remove(frame)
        except OSError:
            pass

    print(f"\nApprentissage : {learned} frames traitées")
    print("Templates :", timer_ocr.stats())

    # ── Validation sur le holdout ──
    if holdout:
        agree, total = 0, 0
        for frame, expected in holdout:
            seconds, conf, prof = timer_ocr.read(frame)
            if seconds is not None:
                total += 1
                if abs(seconds - expected) <= VALIDATE_DRIFT_OK:
                    agree += 1
            try:
                os.remove(frame)
            except OSError:
                pass
        pct = (agree / total * 100) if total else 0.0
        print(f"Validation holdout : {agree}/{total} accords ({pct:.0f}%) "
              f"— lisibilité {total}/{len(holdout)}")
        if total >= 5 and pct < 70 and args.auto_reset:
            shutil.rmtree(timer_ocr.CACHE_DIR, ignore_errors=True)
            print("⚠️ Précision insuffisante → templates RAZ (repasser avec "
                  "plus de clips, ou laisser Gemini enseigner au fil du "
                  "backfill).")
            return 1
        if timer_ocr.is_calibrated():
            print("✅ OCR calibré — les lectures de timer sont maintenant "
                  "locales et gratuites (Gemini = arbitre des cas ambigus).")
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    raise SystemExit(asyncio.run(main()))
