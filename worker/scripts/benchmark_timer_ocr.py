"""Benchmark indépendant de l'OCR timer calibré.

Tire N clips publiés au hasard (offset stable, timer connu :
game_time_seconds - before_pad(30) + t_frame(15)), extrait la frame à 15 s du
clip (R2, egress gratuit), lit le timer via modules.timer_ocr et compare.

Métriques : taux de lecture (l'OCR a le droit de s'abstenir), précision des
lectures (|delta| <= 3 s), et faux positifs (lecture confiante mais fausse —
LE cas dangereux pour l'offset).

Usage : .venv/Scripts/python.exe scripts/benchmark_timer_ocr.py [N]
"""
from __future__ import annotations

import os
import random
import subprocess
import sys
import tempfile

sys.path.insert(0, ".")

import httpx
from services.supabase_client import get_db
from modules import timer_ocr

N = int(sys.argv[1]) if len(sys.argv) > 1 else 24
FRAME_T = 15          # seconde du clip où on lit
BEFORE_PAD = 30       # pad standard du clipper
TOL = 3               # tolérance en secondes


def main() -> None:
    if not timer_ocr.is_calibrated("top_center"):
        print("top_center NON calibré — rien à benchmarker")
        return
    db = get_db()
    r = httpx.get(
        f"{db.base}/kills", headers=db.headers,
        params={
            "select": "id,clip_url_horizontal,game_time_seconds",
            "status": "eq.published",
            "clip_url_horizontal": "not.is.null",
            "game_time_seconds": "gte.120",
            "order": "id", "limit": "400",
        }, timeout=30)
    rows = [k for k in r.json() if k.get("clip_url_horizontal")]
    random.shuffle(rows)
    rows = rows[:N]
    print(f"échantillon : {len(rows)} clips publiés (timer attendu connu)")

    reads = 0
    correct = 0
    false_pos: list[tuple[str, int, int]] = []
    tmp = tempfile.mkdtemp(prefix="ocr_bench_")
    for i, k in enumerate(rows):
        expected = int(k["game_time_seconds"]) - BEFORE_PAD + FRAME_T
        frame = os.path.join(tmp, f"f{i}.jpg")
        ff = subprocess.run(
            ["ffmpeg", "-y", "-ss", str(FRAME_T), "-i", k["clip_url_horizontal"],
             "-frames:v", "1", "-q:v", "2", "-vf", "scale=1920:-1", frame],
            capture_output=True, timeout=60)
        if ff.returncode != 0 or not os.path.exists(frame):
            continue
        secs, conf, prof = timer_ocr.read(frame)
        os.remove(frame)
        if secs is None:
            continue  # abstention — autorisée
        reads += 1
        if abs(secs - expected) <= TOL:
            correct += 1
        else:
            false_pos.append((k["id"][:8], expected, secs))

    total = len(rows)
    print(f"\nlectures    : {reads}/{total} ({100*reads//max(1,total)}% — l'abstention est OK)")
    if reads:
        print(f"précision   : {correct}/{reads} ({100*correct//reads}%) à ±{TOL}s")
        print(f"faux positifs (dangereux) : {len(false_pos)}")
        for kid, exp, got in false_pos[:6]:
            print(f"   {kid}  attendu={exp//60}:{exp%60:02d}  lu={got//60}:{got%60:02d}")
    print("\nverdict :",
          "SAFE — précis quand il lit, s'abstient sinon" if reads and not false_pos
          else ("ATTENTION faux positifs → resserrer le seuil" if false_pos
                else "n'ose pas lire — recalibrer avec plus de samples"))


if __name__ == "__main__":
    main()
