"""
DÉCRYPTAGE — Offset/drift multi-points par (game × source VOD).

Remplace la validation single-point de vod_offset_finder_v2 + clip_qc par
un vrai modèle du mapping game_time → vod_time :

  1. ÉCHANTILLONNAGE — lire le timer in-game à N instants répartis sur la
     partie (5 %, 20 %, 40 %, 60 %, 80 %, 95 % de la durée).
  2. FIT — modèle par morceaux : l'horloge du jeu et celle de la VOD
     avancent à la même vitesse (pente 1) ; le drift vient des pauses et
     des coupes, qui sont des SAUTS d'offset. Le modèle est donc un
     offset constant par segment, avec breakpoints détectés entre les
     échantillons qui divergent. Rejet robuste des lectures aberrantes
     (MAD sur les offsets).
  3. RÉSOLUTION — resolve_vod_time(model, gt) place n'importe quel kill.
     Un kill qui tombe dans une zone d'incertitude (entre deux segments
     qui divergent) est signalé → probe ciblée de bissection.
  4. PERSISTANCE — game_vod_sources.drift_samples / drift_model /
     offset_confidence / sync_method / synced_at. games.vod_offset_seconds
     reste alimenté (offset du segment couvrant gt=0) pour le clipper
     legacy.

Coût — hiérarchie de lecteurs (« Gemini enseigne, l'OCR répète ») :
  * timer_ocr (local, 0 token) dès qu'il est calibré ;
  * Gemini sinon, via le scheduler + circuit breaker 429 ; chaque lecture
    Gemini réussie ENTRAÎNE l'OCR (timer_ocr.learn), donc la dépense tend
    vers zéro au fil du backfill.

Dégradation sans Gemini (cap atteint) :
  * VOD officielle LEC : l'offset epoch/getEventDetails suffit → modèle
    'constant' confiance 0.5, sync_method='official_epoch', à re-valider
    quand le quota revient. AUCUN appel vision.
  * Autres sources : si l'OCR est calibré on continue en full-local ;
    sinon on reporte (return None) au lieu de produire un offset faux.

Validé par worker/vod_time_maps.json (prototype reclip_calibrated.py) :
sur une vraie VOD l'offset observé passe de 3509 s → 3525 s → 3562 s au
fil de la game — un offset unique ne peut pas être juste partout.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import statistics
import subprocess
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

import structlog

from config import config
from scheduler import scheduler
from services.supabase_client import get_db, safe_select, safe_update, safe_insert
from modules import timer_ocr

log = structlog.get_logger()

# ─── Constantes ────────────────────────────────────────────────────────

PROBE_FRACTIONS = (0.05, 0.20, 0.40, 0.60, 0.80, 0.95)
MIN_PROBE_GT = 90              # jamais avant 1:30 (chargement/plateau)
OFFSET_JUMP_THRESHOLD = 5.0    # s — au-delà entre 2 samples → breakpoint
OUTLIER_MAD_FACTOR = 6.0       # rejet : |offset - médiane| > 6×MAD (min 15 s)
MIN_SAMPLES_MODEL = 3          # sous ça : modèle 'constant' dégradé
DRIFT_TOLERANCE = 30           # s — seuil unique de drift acceptable (remplace
                               # le double standard 45 s réel / 30 s documenté)
FRAME_TIMEOUT = 45
DEFAULT_GEMINI_BUDGET = 12     # lectures Gemini max par (game × source)

TIMER_PROMPT = (
    "Read the in-game League of Legends match timer on screen. It is "
    "usually at the top (center, or left near the team kill scores) and "
    "counts match time as MM:SS. Reply ONLY with MM:SS. Ignore real-world "
    "clocks. If no LoL gameplay is visible (interview, draft, panel, "
    "replay menu, ad), reply NONE."
)


# ─── Datamodel ─────────────────────────────────────────────────────────

@dataclass
class DriftSample:
    game_time: int          # secondes in-game lues sur la frame
    vod_time: int           # position VOD de la frame
    timer_read: str         # "MM:SS" brut
    method: str             # 'ocr' | 'gemini' | 'epoch' | 'manual'
    confidence: float       # 0-1
    sampled_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def offset(self) -> float:
        return self.vod_time - self.game_time


@dataclass
class DriftModel:
    type: str                        # 'constant' | 'piecewise'
    segments: list[dict]             # [{gt_from, gt_to, offset}] gt_to=None → ∞
    breakpoints: list[list[float]]   # zones d'incertitude [[gt_a, gt_b], ...]
    residual_p95: float
    n_samples: int
    method_mix: dict[str, int]

    def to_json(self) -> dict:
        return asdict(self)


@dataclass
class ResolveResult:
    vod_time: float
    offset: float
    confidence: float
    in_uncertainty_zone: bool


# ─── 1. Fit du modèle ──────────────────────────────────────────────────

def reject_outliers(samples: list[DriftSample]) -> tuple[list[DriftSample], list[DriftSample]]:
    """MAD filter sur les offsets. Une lecture de timer fausse (replay à
    l'écran, OCR qui confond un 3 et un 8) donne un offset aberrant de
    plusieurs minutes — on la retire avant le fit."""
    if len(samples) < 3:
        return list(samples), []
    offsets = [s.offset for s in samples]
    med = statistics.median(offsets)
    mad = statistics.median(abs(o - med) for o in offsets)
    threshold = max(15.0, OUTLIER_MAD_FACTOR * mad)
    kept, rejected = [], []
    for s in samples:
        (kept if abs(s.offset - med) <= threshold else rejected).append(s)
    if rejected:
        log.info("decryptage_outliers_rejected",
                 n=len(rejected), kept=len(kept),
                 offsets=[round(s.offset) for s in rejected])
    return kept, rejected


def fit_drift_model(samples: list[DriftSample]) -> tuple[Optional[DriftModel], float]:
    """Fit du mapping gt→vt. Retourne (model, confidence 0-1).

    Physique du problème : VOD et horloge in-game avancent toutes deux en
    temps réel → pente 1 par segment. Pauses in-game / coupes de stream =
    sauts d'offset. Donc : offset constant par segment (piecewise-constant),
    breakpoint là où deux samples consécutifs divergent de plus de
    OFFSET_JUMP_THRESHOLD.
    """
    if not samples:
        return None, 0.0
    clean, rejected = reject_outliers(sorted(samples, key=lambda s: s.game_time))
    if not clean:
        return None, 0.0

    # Clustering séquentiel par offset
    segments: list[list[DriftSample]] = [[clean[0]]]
    for s in clean[1:]:
        if abs(s.offset - statistics.mean(x.offset for x in segments[-1])) <= OFFSET_JUMP_THRESHOLD:
            segments[-1].append(s)
        else:
            segments.append([s])

    seg_dicts: list[dict] = []
    breakpoints: list[list[float]] = []
    for i, seg in enumerate(segments):
        gt_from = 0 if i == 0 else float(segments[i - 1][-1].game_time)
        gt_to = None if i == len(segments) - 1 else float(segments[i + 1][0].game_time)
        seg_dicts.append({
            "gt_from": gt_from,
            "gt_to": gt_to,
            "offset": round(statistics.mean(s.offset for s in seg), 2),
            "n": len(seg),
            "gt_first_sample": seg[0].game_time,
            "gt_last_sample": seg[-1].game_time,
        })
        if i < len(segments) - 1:
            # zone d'incertitude : entre le dernier sample du segment i et
            # le premier du segment i+1, on ne sait pas où tombe le saut
            breakpoints.append([float(seg[-1].game_time),
                                float(segments[i + 1][0].game_time)])

    # Résidus intra-segment
    residuals = []
    for seg, sd in zip(segments, seg_dicts):
        residuals.extend(abs(s.offset - sd["offset"]) for s in seg)
    residuals.sort()
    p95 = residuals[int(0.95 * (len(residuals) - 1))] if residuals else 0.0

    method_mix: dict[str, int] = {}
    for s in clean:
        method_mix[s.method] = method_mix.get(s.method, 0) + 1

    model = DriftModel(
        type="constant" if len(segments) == 1 else "piecewise",
        segments=seg_dicts,
        breakpoints=breakpoints,
        residual_p95=round(p95, 2),
        n_samples=len(clean),
        method_mix=method_mix,
    )

    # Confiance : couverture + cohérence + volume
    n_total = len(clean) + len(rejected)
    keep_ratio = len(clean) / n_total if n_total else 0.0
    volume = min(1.0, len(clean) / 5.0)
    coherence = max(0.0, 1.0 - p95 / 10.0)
    mean_sample_conf = statistics.mean(s.confidence for s in clean)
    confidence = round(keep_ratio * 0.25 + volume * 0.25
                       + coherence * 0.25 + mean_sample_conf * 0.25, 3)
    return model, confidence


def resolve_vod_time(model: dict | DriftModel, game_time: float) -> Optional[ResolveResult]:
    """Position VOD d'un game_time selon le modèle. Signale les zones
    d'incertitude (kill entre deux segments divergents)."""
    if model is None:
        return None
    m = model.to_json() if isinstance(model, DriftModel) else model
    segments = m.get("segments") or []
    if not segments:
        return None

    in_zone = any(a < game_time < b for a, b in (m.get("breakpoints") or []))

    chosen = None
    for seg in segments:
        gt_from = seg.get("gt_from", 0) or 0
        gt_to = seg.get("gt_to")
        if game_time >= gt_from and (gt_to is None or game_time < gt_to):
            chosen = seg
            break
    if chosen is None:
        chosen = segments[-1]

    base_conf = 0.9 if len(segments) == 1 else 0.85
    conf = base_conf * (0.35 if in_zone else 1.0)
    offset = float(chosen["offset"])
    return ResolveResult(
        vod_time=game_time + offset,
        offset=offset,
        confidence=round(conf, 3),
        in_uncertainty_zone=in_zone,
    )


# ─── 2. Lecture de frames (OCR d'abord, Gemini en arbitre) ────────────

class ProbeBudget:
    """Budget de lectures Gemini pour une session de décryptage. L'OCR
    local est gratuit et n'est pas compté."""

    def __init__(self, gemini_calls: int = DEFAULT_GEMINI_BUDGET):
        self.gemini_calls = gemini_calls

    def take_gemini(self) -> bool:
        if self.gemini_calls <= 0:
            return False
        self.gemini_calls -= 1
        return True


async def _extract_frame(source: str, vod_seconds: int, out_path: str) -> bool:
    """Extrait 1 frame JPEG depuis un fichier local ou une URL directe."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-ss", str(int(vod_seconds)), "-i", source,
            "-frames:v", "1", "-q:v", "2", "-vf", "scale=1920:-1", out_path,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=FRAME_TIMEOUT)
        return proc.returncode == 0 and os.path.exists(out_path)
    except (asyncio.TimeoutError, OSError):
        try:
            proc.kill()
        except Exception:
            pass
        return False


async def _read_timer_gemini(frame_path: str) -> Optional[int]:
    """Lecture Gemini d'une frame (1 image, pas de vidéo — 100× moins de
    tokens que qc.py::validate_clip qui uploadait le clip entier)."""
    if not await scheduler.wait_for("gemini"):
        return None
    from services.gemini_client import get_client, _wait_for_file_active, handle_gemini_exception
    try:
        from google.genai import types  # type: ignore
        client = get_client()
        if client is None:
            return None
        img = await asyncio.to_thread(
            client.files.upload,
            file=frame_path,
            config=types.UploadFileConfig(mime_type="image/jpeg"),
        )
        if not await _wait_for_file_active(client, img, timeout=30):
            return None
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=config.GEMINI_MODEL_OFFSET,
            contents=[TIMER_PROMPT, img],
        )
        text = (resp.text or "").strip()
        m = re.match(r"(\d+):(\d{2})", text)
        if not m:
            return None
        return int(m.group(1)) * 60 + int(m.group(2))
    except Exception as e:
        handle_gemini_exception(e, where="decryptage_read_timer")
        return None


async def read_timer_at(
    source: str,
    vod_seconds: int,
    budget: ProbeBudget,
    tmp_dir: Optional[str] = None,
) -> Optional[DriftSample]:
    """Lit le timer à vod_seconds. Essaie ±0/+17/-17 s pour esquiver les
    replays plein écran. OCR local d'abord ; Gemini si l'OCR ne sait pas,
    et chaque succès Gemini entraîne l'OCR (learn)."""
    tmp_dir = tmp_dir or getattr(config, "CLIPS_DIR", None) or os.path.join(
        os.path.dirname(__file__), "..", "clips")
    os.makedirs(tmp_dir, exist_ok=True)

    for delta in (0, 17, -17):
        pos = max(0, vod_seconds + delta)
        frame = os.path.join(tmp_dir, f"decrypt_{abs(hash(source)) % 99999}_{pos}.jpg")
        try:
            if not await _extract_frame(source, pos, frame):
                continue

            # 1) OCR local — gratuit
            seconds, conf, profile = timer_ocr.read(frame)
            if seconds is not None:
                log.info("decryptage_timer_ocr",
                         vod_s=pos, timer=seconds, conf=conf, profile=profile)
                return DriftSample(
                    game_time=seconds, vod_time=pos,
                    timer_read=f"{seconds // 60}:{seconds % 60:02d}",
                    method="ocr", confidence=conf,
                )

            # 2) Gemini — budgété, et il enseigne à l'OCR
            if budget.take_gemini():
                seconds = await _read_timer_gemini(frame)
                if seconds is not None:
                    try:
                        timer_ocr.learn(frame, seconds)
                    except Exception as e:
                        log.warn("timer_ocr_learn_failed", error=str(e)[:80])
                    log.info("decryptage_timer_gemini", vod_s=pos, timer=seconds)
                    return DriftSample(
                        game_time=seconds, vod_time=pos,
                        timer_read=f"{seconds // 60}:{seconds % 60:02d}",
                        method="gemini", confidence=0.95,
                    )
        finally:
            if os.path.exists(frame):
                try:
                    os.remove(frame)
                except OSError:
                    pass
    return None


# ─── 3. Décryptage d'une source ───────────────────────────────────────

def _plan_probe_times(duration_seconds: int) -> list[int]:
    dur = duration_seconds if duration_seconds and duration_seconds > 300 else 1800
    times = sorted({max(MIN_PROBE_GT, int(dur * f)) for f in PROBE_FRACTIONS})
    return times


async def refine_breakpoint(
    source: str,
    zone: tuple[float, float],
    offset_before: float,
    budget: ProbeBudget,
) -> list[DriftSample]:
    """Bissection d'une zone d'incertitude : 2-3 probes pour localiser le
    saut d'offset à ±30 s près. Appelé quand un kill tombe dans la zone."""
    samples: list[DriftSample] = []
    lo, hi = zone
    for _ in range(3):
        if hi - lo <= 30:
            break
        mid_gt = (lo + hi) / 2
        probe_vt = int(mid_gt + offset_before)
        s = await read_timer_at(source, probe_vt, budget)
        if s is None:
            break
        samples.append(s)
        # la frame lue nous dit de quel côté du saut on est
        if abs(s.offset - offset_before) <= OFFSET_JUMP_THRESHOLD:
            lo = s.game_time
        else:
            hi = s.game_time
    return samples


async def decrypt_source(
    *,
    game: dict,
    source_video: str,
    offset_hint: Optional[float],
    duration_seconds: Optional[int],
    budget: Optional[ProbeBudget] = None,
    is_official: bool = False,
    extra_probe_gts: Optional[list[int]] = None,
) -> tuple[Optional[DriftModel], float, list[DriftSample], str]:
    """Échantillonne + fit pour UNE source VOD d'une game.

    Args:
        game: row games (id, external_id, duration_seconds…)
        source_video: chemin local du VOD (préféré — backfill télécharge
            une fois) ou URL directe de flux.
        offset_hint: offset a priori (officiel getEventDetails, epoch
            Twitch, ou games.vod_offset_seconds existant).
        is_official: VOD officielle LEC → dégradation epoch sans vision.
        extra_probe_gts: game_times supplémentaires à sonder (ex. les
            game_time des kills importants de la game).

    Returns: (model, confidence, samples, sync_method)
    """
    budget = budget or ProbeBudget()
    duration = duration_seconds or game.get("duration_seconds") or 1800
    probe_gts = _plan_probe_times(duration)
    if extra_probe_gts:
        probe_gts = sorted(set(probe_gts) | {int(g) for g in extra_probe_gts})

    hint = offset_hint if offset_hint is not None else 0.0
    samples: list[DriftSample] = []
    for gt in probe_gts:
        s = await read_timer_at(source_video, int(gt + hint), budget)
        if s is not None:
            samples.append(s)
            # affiner le hint au fil de l'eau : les probes suivantes visent
            # mieux si l'offset réel diffère du hint initial
            hint = s.offset

    if len(samples) >= MIN_SAMPLES_MODEL:
        model, conf = fit_drift_model(samples)
        method = ("ocr_multipoint"
                  if all(s.method == "ocr" for s in samples)
                  else "gemini_multipoint"
                  if all(s.method == "gemini" for s in samples)
                  else "hybrid_multipoint")
        return model, conf, samples, method

    # ── Dégradation ──
    if samples:
        # 1-2 points : modèle constant sur ce qu'on a
        model, conf = fit_drift_model(samples)
        return model, min(conf, 0.55), samples, "single_point_legacy"

    if is_official and offset_hint is not None:
        # Zéro vision dispo (quota mort + OCR pas calibré) mais VOD
        # officielle : l'offset epoch/getEventDetails est fiable.
        model = DriftModel(
            type="constant",
            segments=[{"gt_from": 0, "gt_to": None, "offset": float(offset_hint),
                       "n": 0, "gt_first_sample": None, "gt_last_sample": None}],
            breakpoints=[], residual_p95=0.0, n_samples=0,
            method_mix={"epoch": 1},
        )
        return model, 0.5, [], "official_epoch"

    return None, 0.0, [], "none"


# ─── 4. Persistance ────────────────────────────────────────────────────

def _ensure_official_source_row(game: dict) -> Optional[dict]:
    """Chaque game avec un vod_youtube_id doit avoir sa ligne
    game_vod_sources official_lec — c'est la clé du multi-source. La crée
    si absente (idempotent : UNIQUE(game_id, source_type))."""
    yt = game.get("vod_youtube_id")
    if not yt:
        return None
    rows = safe_select("game_vod_sources", "*",
                       game_id=game["id"], source_type="official_lec")
    if rows:
        return rows[0]
    created = safe_insert("game_vod_sources", {
        "game_id": game["id"],
        "source_type": "official_lec",
        "platform": "youtube",
        "video_id": yt,
        "offset_seconds": game.get("vod_offset_seconds"),
        "priority": 100,
    })
    return created


def persist_decryptage(
    *,
    game: dict,
    source_row: dict,
    model: DriftModel,
    confidence: float,
    samples: list[DriftSample],
    sync_method: str,
) -> bool:
    """Écrit le résultat dans game_vod_sources (+ games compat legacy).

    ⚠️ jamais de content_hash ni d'autre colonne UNIQUE dans ces PATCH
    (piège 23505 — cf. spec §P4)."""
    ok = safe_update("game_vod_sources", {
        "drift_samples": [asdict(s) for s in samples],
        "drift_model": model.to_json(),
        "offset_confidence": confidence,
        "sync_method": sync_method,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "sync_validated": confidence >= 0.75,
        "offset_seconds": int(model.segments[0]["offset"]) if model.segments else None,
    }, "id", source_row["id"])

    # Compat legacy : le clipper lit encore games.vod_offset_seconds
    if source_row.get("source_type") == "official_lec" and model.segments:
        safe_update("games", {
            "vod_offset_seconds": int(model.segments[0]["offset"]),
        }, "id", game["id"])
    return bool(ok)


# ─── 5. Entrée module (une game complète) ─────────────────────────────

async def decrypt_game(
    game_id: str,
    *,
    local_vod_path: Optional[str] = None,
    gemini_budget: int = DEFAULT_GEMINI_BUDGET,
    kill_game_times: Optional[list[int]] = None,
) -> Optional[dict]:
    """Décrypte la source officielle d'une game. Retourne un résumé ou
    None si rien n'a pu être fait (pas de VOD, pas de vision dispo…)."""
    rows = safe_select("games", "*", id=game_id)
    if not rows:
        return None
    game = rows[0]
    yt = game.get("vod_youtube_id")
    if not yt:
        log.info("decryptage_no_vod", game_id=game_id[:8])
        return None

    source_row = _ensure_official_source_row(game)
    if source_row is None:
        return None

    source = local_vod_path
    if source is None:
        # flux distant : URL directe via yt-dlp -g (1 appel scheduler)
        if not await scheduler.wait_for("ytdlp"):
            return None
        from services import youtube_cookies
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "yt_dlp", *youtube_cookies.cli_args(),
                 "--js-runtimes", "node", "-g", "-f", "best[height<=720]",
                 "--no-playlist", f"https://youtu.be/{yt}"],
                capture_output=True, text=True, timeout=30,
            )
            if proc.returncode != 0:
                log.warn("decryptage_stream_url_failed", yt=yt)
                return None
            source = proc.stdout.strip().splitlines()[0]
        except Exception as e:
            log.warn("decryptage_ytdlp_error", error=str(e)[:120])
            return None

    budget = ProbeBudget(gemini_budget)
    model, conf, samples, method = await decrypt_source(
        game=game,
        source_video=source,
        offset_hint=game.get("vod_offset_seconds"),
        duration_seconds=game.get("duration_seconds"),
        budget=budget,
        is_official=True,
        extra_probe_gts=kill_game_times,
    )
    if model is None:
        log.warn("decryptage_failed", game_id=game_id[:8])
        return None

    persist_decryptage(game=game, source_row=source_row, model=model,
                       confidence=conf, samples=samples, sync_method=method)
    log.info("decryptage_done", game_id=game_id[:8],
             segments=len(model.segments), confidence=conf,
             method=method, n_samples=model.n_samples,
             gemini_left=budget.gemini_calls)
    return {
        "game_id": game_id,
        "model": model.to_json(),
        "confidence": conf,
        "sync_method": method,
        "n_samples": model.n_samples,
        "source_row_id": source_row["id"],
    }
