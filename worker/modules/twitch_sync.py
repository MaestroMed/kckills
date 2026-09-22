"""
TWITCH_SYNC — cale une section de VOD Twitch sur l'horloge du feed.

Modèle (exact pour un live continu) :
    position_dans_le_fichier(E) = (E - ancre_du_feed) / 1000 + c

`c` = position, dans le fichier téléchargé, de l'instant réel où le feed a
démarré la game. Les pauses n'y changent rien : pendant une pause l'epoch
avance ET le live continue, les deux horloges avancent ensemble. Seul le
délai de diffusion (broadcast vs serveur de jeu) est inconnu, et il est
constant sur tout un live — d'où une seule constante par game.

Calibration : on lit le chrono affiché (Gemini sur un crop x3 de la ligne du
chrono — l'OCR local lit le score à la place sur le HUD LEC 2026) à 4-6
instants choisis hors pauses, y compris après chaque pause. Chaque lecture
donne un c_i ; on garde la médiane si au moins 3 lectures concordent à
±2,5 s (les replays plein écran montrent un chrono passé : rejetés comme
aberrants).

Coût : ~5 appels image flash-lite par game (≈ 0,001 $).
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
import subprocess
from dataclasses import dataclass, field

import structlog

from modules.feed_clock import FeedClock
from scheduler import scheduler

log = structlog.get_logger()

TIMER_MODEL = os.getenv("KCKILLS_TIMER_MODEL", "gemini-3.5-flash-lite")
# Ligne du chrono sous le bandeau de score (HUD LEC 2026, broadcast 16:9).
TIMER_CROP = "crop=iw*0.14:ih*0.05:iw*0.43:ih*0.055,scale=iw*3:ih*3"
TIMER_PROMPT = (
    "Cette image est un crop du bandeau central du HUD d'un match de League of Legends "
    "(broadcast). Lis le CHRONO de la partie (format MM:SS, chiffres blancs). Si l'écran "
    "montre un replay, une pub, le plateau ou aucun chrono, réponds null. Réponds "
    'UNIQUEMENT en JSON : {"timer": "MM:SS"} ou {"timer": null}.'
)
MAX_SPREAD_S = 2.5
MIN_READS = 3


@dataclass
class SectionSync:
    path: str
    c: float | None                       # position de l'ancre du feed dans le fichier (s)
    reads: list[dict] = field(default_factory=list)
    spread_s: float | None = None
    ok: bool = False
    reason: str = ""

    def file_pos(self, epoch_ms: int, clock: FeedClock) -> float:
        return (epoch_ms - clock.anchor_ms) / 1000.0 + float(self.c or 0.0)

    def to_json(self) -> dict:
        return {"c": self.c, "spread_s": self.spread_s, "ok": self.ok, "reason": self.reason, "reads": self.reads}


def _parse_mmss(v) -> int | None:
    try:
        m, s = str(v).strip().split(":")
        m, s = int(m), int(s)
        return m * 60 + s if 0 <= s < 60 and 0 <= m < 120 else None
    except (ValueError, AttributeError):
        return None


def media_duration(path: str) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, timeout=60,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


async def read_timer_at(path: str, pos: float, tmp_dir: str) -> int | None:
    """Chrono affiché à `pos` secondes dans le fichier (None si illisible)."""
    os.makedirs(tmp_dir, exist_ok=True)
    crop = os.path.join(tmp_dir, f"timer_{abs(hash(path)) % 99999}_{int(pos * 10)}.png")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, pos):.2f}", "-i", path,
        "-frames:v", "1", "-vf", TIMER_CROP, crop,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()
    if not os.path.exists(crop):
        return None
    if not await scheduler.wait_for("gemini"):
        log.warn("twitch_sync_gemini_quota")
        return None
    from services.gemini_client import _wait_for_file_active, get_client, handle_gemini_exception
    try:
        from google.genai import types  # type: ignore

        client = get_client()
        if client is None:
            return None
        img = await asyncio.to_thread(
            client.files.upload, file=crop, config=types.UploadFileConfig(mime_type="image/png"))
        if not await _wait_for_file_active(client, img, timeout=30):
            return None
        resp = await asyncio.to_thread(
            client.models.generate_content, model=TIMER_MODEL, contents=[TIMER_PROMPT, img],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        data = json.loads((resp.text or "{}").strip() or "{}")
        if isinstance(data, list):
            data = next((x for x in data if isinstance(x, dict)), {})
        return _parse_mmss((data or {}).get("timer"))
    except Exception as e:  # jamais bloquant : une lecture ratée = un point en moins
        handle_gemini_exception(e, where="twitch_sync_timer")
        return None
    finally:
        try:
            os.remove(crop)
        except OSError:
            pass


def probe_targets(clock: FeedClock, max_probes: int = 6) -> list[float]:
    """Chronos à lire : début de game + juste après chaque pause + fin.
    Jamais à moins de 25 s d'une pause (chrono figé, ambigu)."""
    dur = clock.duration_ingame_s or 30 * 60
    targets = [150.0, 330.0, 540.0]
    for start, end in clock.pauses:
        t = clock.ingame_seconds(end) + 60
        if t < dur - 60:
            targets.append(t)
    targets.append(max(600.0, dur * 0.8))
    out: list[float] = []
    for t in sorted(set(round(x) for x in targets)):
        if t >= dur - 30:
            continue
        e = clock.epoch_ms_at_ingame(t)
        if any(abs(e - s) < 25_000 or abs(e - en) < 25_000 for s, en in clock.pauses):
            continue
        out.append(float(t))
    return out[:max_probes]


async def calibrate_section(path: str, clock: FeedClock, guess_c: float, tmp_dir: str) -> SectionSync:
    """Mesure `c` dans les coordonnées du fichier `path`."""
    dur_file = media_duration(path)
    sync = SectionSync(path=path, c=None)
    c_est = guess_c
    for target in probe_targets(clock):
        e = clock.epoch_ms_at_ingame(target)
        for jitter in (0.0, 7.0, -7.0, 15.0):
            f = (e - clock.anchor_ms) / 1000.0 + c_est + jitter
            if not 0 <= f <= dur_file - 1:
                continue
            t_read = await read_timer_at(path, f, tmp_dir)
            if t_read is None:
                continue
            e_read = clock.epoch_ms_at_ingame(t_read + 0.5)   # MM:SS tronqué -> milieu de la seconde
            c_i = f - (e_read - clock.anchor_ms) / 1000.0
            sync.reads.append({"target": target, "pos": round(f, 2), "timer": t_read, "c": round(c_i, 2)})
            if len(sync.reads) == 1:
                c_est = c_i            # vise juste pour les lectures suivantes
            break
    cs = [r["c"] for r in sync.reads]
    if len(cs) < MIN_READS:
        sync.reason = f"{len(cs)} lecture(s) du chrono (min {MIN_READS})"
        log.warn("twitch_sync_failed", path=os.path.basename(path), reason=sync.reason, reads=sync.reads)
        return sync
    med = statistics.median(cs)
    inliers = [c for c in cs if abs(c - med) <= MAX_SPREAD_S]
    if len(inliers) < MIN_READS:
        sync.reason = f"lectures incohérentes {cs}"
        log.warn("twitch_sync_failed", path=os.path.basename(path), reason=sync.reason)
        return sync
    sync.c = round(statistics.median(inliers), 2)
    sync.spread_s = round(max(inliers) - min(inliers), 2)
    sync.ok = sync.spread_s <= MAX_SPREAD_S
    if not sync.ok:
        sync.reason = f"dispersion {sync.spread_s}s"
    log.info("twitch_sync_done", path=os.path.basename(path), c=sync.c, spread=sync.spread_s,
             reads=len(cs), inliers=len(inliers), ok=sync.ok)
    return sync
