"""clip_qc_v2 — cohérence des lectures de chrono (30/09/2026).

Deux images prises à 17 s d'écart (t=15 et t=32 dans le clip) doivent montrer
des chronos à 17 s d'écart. Une lecture OCR fausse (or ou score lus à la place
du chrono, +27 min) faisait échouer des clips justes : la « médiane » de deux
valeurs retenait la plus haute.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from modules.clip_qc_v2 import timer_reads_coherent  # noqa: E402


def test_reads_that_advance_with_the_clip_are_coherent():
    assert timer_reads_coherent([(15, 449, "ocr"), (32, 466, "gemini")])
    assert timer_reads_coherent([(15, 449, "ocr"), (32, 469, "ocr")])  # ±5 s toléré


def test_one_wrong_ocr_read_is_incoherent():
    # vrai chrono 7:29 à t=15, OCR lit 35:14 à t=32 (+27 min)
    assert not timer_reads_coherent([(15, 449, "gemini"), (32, 2114, "ocr")])


def test_static_misread_is_incoherent():
    # l'OCR lit deux fois le même nombre (or, score) : il n'avance pas
    assert not timer_reads_coherent([(15, 2096, "ocr"), (32, 2096, "ocr")])


def test_single_read_is_trivially_coherent():
    assert timer_reads_coherent([(15, 449, "ocr")])
