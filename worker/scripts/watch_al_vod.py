"""Watcher one-shot : VOD YouTube du match KC vs Anyone's Legend (EWC, 17/07).

Poll @KarmineCorpVOD toutes les 5 min (yt-dlp flat, zéro quota API). Dès qu'une
vidéo matche (anyone|ag.al|\bAL\b + EWC), écrit games.vod_youtube_id sur les
games du match 116855104460702360 → le pipeline (vof2 offset OCR-first →
clipper) fait le reste tout seul. S'arrête après succès ou ~6 h.

Lancé détaché le 2026-07-17 (demande Mehdi : clips AL asap).
Log : worker/logs/watch_al_vod.log
"""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))
from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

import httpx
from services.supabase_client import get_db

CHANNEL = "https://www.youtube.com/@KarmineCorpVOD/videos"
MATCH_EXT = "116855104460702360"
PATTERN = re.compile(r"(anyone|ag\.?al|\bAL\b)", re.IGNORECASE)
LOGF = _ROOT / "logs" / "watch_al_vod.log"
YTDLP = str(_ROOT / ".venv" / "Scripts" / "yt-dlp.exe")


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}\n"
    with open(LOGF, "a", encoding="utf-8") as f:
        f.write(line)


def find_upload() -> str | None:
    p = subprocess.run(
        [YTDLP, "--flat-playlist", "--playlist-items", "1-6",
         "--print", "%(id)s\t%(title)s", CHANNEL],
        capture_output=True, text=True, timeout=120)
    for line in (p.stdout or "").splitlines():
        if "\t" not in line:
            continue
        vid, title = line.split("\t", 1)
        if PATTERN.search(title) and ("ewc" in title.lower() or "2026" in title):
            log(f"FOUND {vid} | {title[:80]}")
            return vid.strip()
    return None


def wire(vid: str) -> bool:
    db = get_db()
    m = httpx.get(f"{db.base}/matches", headers=db.headers,
                  params={"select": "id", "external_id": f"eq.{MATCH_EXT}"}, timeout=20).json()
    if not m:
        log("match introuvable"); return False
    gs = httpx.get(f"{db.base}/games", headers=db.headers,
                   params={"select": "id,game_number", "match_id": f"eq.{m[0]['id']}",
                           "game_number": "in.(1,2)"}, timeout=20).json()
    ok = 0
    for g in gs:
        r = httpx.patch(f"{db.base}/games",
                        headers={**db.headers, "Prefer": "return=minimal"},
                        params={"id": f"eq.{g['id']}", "vod_youtube_id": "is.null"},
                        json={"vod_youtube_id": vid}, timeout=30)
        if r.status_code < 400:
            ok += 1
    log(f"WIRED vod={vid} sur {ok} games (offset: vof2 s'en charge)")
    return ok > 0


def main() -> None:
    log("watcher démarré")
    deadline = time.time() + 6 * 3600
    while time.time() < deadline:
        try:
            vid = find_upload()
            if vid and wire(vid):
                log("terminé — pipeline prend le relais")
                return
        except Exception as e:
            log(f"erreur: {str(e)[:150]}")
        time.sleep(300)
    log("timeout 6h — VOD pas encore uploadée")


if __name__ == "__main__":
    main()
