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
import time
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


# ─── Section de game prête à l'emploi (backfill, montage) ───────────────────

@dataclass
class GameSection:
    """Section 1080p60 d'une game + sa calibration : tout instant réel E du
    feed tombe à `sync.file_pos(E, clock)` secondes dans `path`."""
    path: str
    start_s: float                  # position de la section dans la VOD
    vod_id: str
    vod_title: str
    sync: SectionSync
    clock: FeedClock


NEGATIVE_RETRY_S = 6 * 3600      # calibration refusée : pas de nouvel essai avant 6 h
END_MARGIN_S = 120               # la VOD doit couvrir la fin de game + 2 min


def _read_meta(meta_path: str) -> dict | None:
    try:
        with open(meta_path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def cached_game_section(clock: FeedClock) -> GameSection | None:
    """Section déjà téléchargée ET calée pour cette game (toutes VODs
    confondues) — lecture disque seule, aucun appel réseau."""
    import glob

    from services.local_paths import LocalPaths

    pattern = os.path.join(glob.escape(LocalPaths.vods_dir()), f"twitch_*_{clock.game_ext_id}.mp4.sync.json")
    for meta_path in sorted(glob.glob(pattern)):
        meta = _read_meta(meta_path)
        path = meta_path[: -len(".sync.json")]
        if not meta or not meta.get("ok") or meta.get("c") is None or not os.path.exists(path):
            continue
        vod = meta.get("vod") or {}
        vod_id = vod.get("video_id") or os.path.basename(path).split("_")[1]
        sync = SectionSync(path=path, c=float(meta["c"]), reads=meta.get("reads") or [],
                           spread_s=meta.get("spread_s"), ok=True)
        return GameSection(path, float(meta.get("section_start_s") or 0), vod_id, vod.get("title") or "", sync, clock)
    return None


async def prepare_game_section(clock: FeedClock, *, channel: str | None = None,
                               channels: list[str] | None = None, margin_s: int = 240,
                               last_epoch_ms: int | None = None, tmp_dir: str | None = None,
                               require_finished: bool = True, retry_refused: bool = False) -> GameSection | None:
    """VOD Twitch qui couvre la game -> section téléchargée -> calibration.

    `channels` : chaînes essayées dans l'ordre (ex. ["lec", "riotgames"]) —
    la calibration sert de juge : une rediffusion ou un autre match qui
    couvrirait la même heure échoue à la lecture du chrono, on passe à la
    suivante. Réutilise la section et son .sync.json s'ils existent (aucun
    appel Gemini ni téléchargement en double) ; une calibration refusée
    n'est retentée qu'après NEGATIVE_RETRY_S.

    `require_finished` : la game doit être terminée dans le feed (horloge
    complète) — pendant le live, les pauses à venir et la fin sont inconnues.
    None si pas de VOD (ou pas encore assez longue), téléchargement raté ou
    calibration refusée."""
    from services import twitch_vod
    from services.local_paths import LocalPaths

    if require_finished and clock.end_ms is None:
        log.info("twitch_section_game_unfinished", game=clock.game_ext_id)
        return None
    cached = cached_game_section(clock)
    if cached is not None:
        return cached
    order = [c for c in (channels or [channel or twitch_vod.DEFAULT_CHANNEL]) if c]
    last = last_epoch_ms or clock.end_ms or (clock.anchor_ms + 60 * 60_000)
    for ch in order:
        vod = await twitch_vod.find_vod_for_epoch(clock.anchor_ms, channel=ch, until_ms=last + END_MARGIN_S * 1000)
        if not vod:
            continue
        path = os.path.join(LocalPaths.vods_dir(), f"twitch_{vod.video_id}_{clock.game_ext_id}.mp4")
        meta_path = path + ".sync.json"
        meta = _read_meta(meta_path)
        if meta and meta.get("ok") and meta.get("c") is not None and os.path.exists(path):
            sync = SectionSync(path=path, c=float(meta["c"]), reads=meta.get("reads") or [],
                               spread_s=meta.get("spread_s"), ok=True)
            return GameSection(path, float(meta.get("section_start_s") or 0), vod.video_id, vod.title, sync, clock)
        if meta and not meta.get("ok") and not retry_refused:
            age = time.time() - float(meta.get("calibrated_at") or os.path.getmtime(meta_path))
            if age < NEGATIVE_RETRY_S:
                log.info("twitch_section_skip_refused", game=clock.game_ext_id, vod=vod.video_id,
                         reason=meta.get("reason"), retry_in_min=round((NEGATIVE_RETRY_S - age) / 60))
                continue
        anchor_pos = vod.position_of(clock.anchor_ms / 1000.0)
        start = max(0.0, anchor_pos - margin_s)
        end = min(float(vod.duration_s), vod.position_of(last / 1000.0) + margin_s)
        if not await twitch_vod.download_section(vod.video_id, start, end, path):
            log.warn("twitch_section_download_failed", game=clock.game_ext_id, vod=vod.video_id, channel=ch)
            continue
        sync = await calibrate_section(path, clock, guess_c=anchor_pos - start,
                                       tmp_dir=tmp_dir or os.path.join(os.path.dirname(path), "sync_tmp"))
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"vod": {"video_id": vod.video_id, "start_epoch_s": vod.start_epoch_s,
                               "duration_s": vod.duration_s, "title": vod.title, "channel": ch},
                       "section_start_s": start, "calibrated_at": int(time.time()),
                       "clock": clock.to_json(), **sync.to_json()}, f, indent=1)
        if sync.ok:
            return GameSection(path, start, vod.video_id, vod.title, sync, clock)
        # section inutilisable : on libère le disque (le .sync.json garde la trace)
        try:
            os.remove(path)
        except OSError:
            pass
    return None
