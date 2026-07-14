"""
CLIP_QC_V2 — QC multi-vérification par clip (« bon départ, bon clip »).

Remplace le single-check de clip_qc.py par une batterie de checks
indépendants, stockés en détail dans clip_ledger.qc_checks :

  BLOQUANTS (un échec → needs_review, JAMAIS published) :
    * duration_sane   — ffprobe local : durée dans les bornes, flux vidéo OK
    * audio_present   — ffprobe local : piste audio existante
                        (212 clips publiés muets au 2026-07-14 — plus jamais)
    * timer_matches   — le timer lu dans le clip ≈ game_time attendu
                        (multi-frames, OCR local d'abord, drift ≤ 30 s)
    * start_is_gameplay — la 1re seconde est du gameplay (pas draft/pub)

  PERMISSIFS (échec explicite → bloque ; indisponible → passe) :
    * kill_visible    — le kill est à l'écran (vision, 1 appel Gemini)
    * actors_match    — champions killer/victim vus == métadonnées

Économie : les checks ffprobe/OCR sont GRATUITS et couvrent les 4
bloquants dans le cas nominal. Les checks vision sont regroupés en UN
SEUL appel Gemini (une frame mi-clip, un prompt JSON qui répond timer +
gameplay + champions + kill visible d'un coup) — jamais un appel par
check. Sans budget Gemini : les permissifs sont 'skipped' et les
bloquants s'appuient sur OCR ; si l'OCR non plus n'est pas calibré, le
verdict est needs_review (on ne publie pas à l'aveugle), sauf
allow_degraded=True (modèle de drift à haute confiance en amont).

Le verdict alimente ensuite les gates game_events (qc_clip_validated,
qc_visible) — la publication reste pilotée par is_publishable.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import structlog

from config import config
from scheduler import scheduler
from modules import timer_ocr
from modules.decryptage import DRIFT_TOLERANCE, ProbeBudget, _extract_frame

log = structlog.get_logger()

FFPROBE_TIMEOUT = 30
MIN_DURATION_S = 8            # un clip kill fait ≥ 10 s par construction
MAX_DURATION_S = 120
VISION_PROMPT = (
    "You are auditing a League of Legends esports clip frame. Reply ONLY "
    "valid JSON: {\"is_gameplay\": bool, \"timer\": \"MM:SS\" or null, "
    "\"champions_visible\": [strings], \"kill_or_fight_visible\": bool}. "
    "is_gameplay=false for analyst desk, draft, ads, replays with big "
    "overlay. timer = the in-game match clock (top center or top left). "
    "champions_visible = champion names you can identify on screen. "
    "kill_or_fight_visible = a fight, kill or takedown is happening."
)


@dataclass
class QCCheck:
    name: str
    verdict: str            # 'pass' | 'fail' | 'skipped'
    blocking: bool
    score: Optional[float] = None
    method: str = ""
    detail: str = ""
    checked_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_json(self) -> dict:
        return {
            "name": self.name, "verdict": self.verdict,
            "blocking": self.blocking, "score": self.score,
            "method": self.method, "detail": self.detail,
            "checked_at": self.checked_at,
        }


@dataclass
class QCResult:
    checks: list[QCCheck]
    verdict: str            # 'pass' | 'needs_review' | 'reject'
    drift_seconds: Optional[int] = None
    # Vague 2 (flywheel) — lectures brutes (pos_dans_clip, timer_lu,
    # méthode) : l'appelant les convertit en DriftSamples et les
    # réinjecte dans le modèle de la source (append_drift_samples).
    # Chaque clip vérifié améliore le placement de tous les suivants.
    timer_reads: list = field(default_factory=list)

    @property
    def pass_count(self) -> int:
        return sum(1 for c in self.checks if c.verdict == "pass")

    def to_json(self) -> dict:
        return {
            "checks": [c.to_json() for c in self.checks],
            "verdict": self.verdict,
            "drift_seconds": self.drift_seconds,
        }


# ─── Checks locaux (ffprobe — gratuits) ───────────────────────────────

async def _ffprobe_streams(path: str) -> Optional[dict]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries",
            "stream=codec_type,codec_name,duration:format=duration",
            "-of", "json", path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=FFPROBE_TIMEOUT)
        if proc.returncode != 0:
            return None
        return json.loads(out or b"{}")
    except (asyncio.TimeoutError, OSError, json.JSONDecodeError):
        try:
            proc.kill()
        except Exception:
            pass
        return None


async def check_media_sanity(clip_path: str) -> tuple[QCCheck, QCCheck]:
    """duration_sane + audio_present en un seul ffprobe."""
    info = await _ffprobe_streams(clip_path)
    if info is None:
        fail = dict(verdict="fail", method="ffprobe", detail="ffprobe failed")
        return (QCCheck("duration_sane", blocking=True, **fail),
                QCCheck("audio_present", blocking=True, **fail))

    streams = info.get("streams", [])
    has_video = any(s.get("codec_type") == "video" for s in streams)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    try:
        duration = float(info.get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0

    dur_ok = has_video and MIN_DURATION_S <= duration <= MAX_DURATION_S
    dur = QCCheck(
        "duration_sane", "pass" if dur_ok else "fail", blocking=True,
        score=1.0 if dur_ok else 0.0, method="ffprobe",
        detail=f"duration={duration:.1f}s video={has_video}",
    )
    aud = QCCheck(
        "audio_present", "pass" if has_audio else "fail", blocking=True,
        score=1.0 if has_audio else 0.0, method="ffprobe",
        detail=", ".join(s.get("codec_name", "?") for s in streams
                         if s.get("codec_type") == "audio") or "no audio stream",
    )
    return dur, aud


async def check_start_frames(clip_path: str) -> QCCheck:
    """Frame noire / image gelée sur les 4 premières secondes (spec §7
    duration_sane : « pas de gel/frame noire »). ffmpeg blackdetect +
    freezedetect, local, gratuit."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-t", "4", "-i", clip_path,
            "-vf", "blackdetect=d=1.5:pic_th=0.98,freezedetect=n=-60dB:d=2.5",
            "-an", "-f", "null", "-",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, err = await asyncio.wait_for(proc.communicate(), timeout=60)
        text = err.decode(errors="replace")
        black = "blackdetect" in text and "black_start" in text
        frozen = "freezedetect" in text and "freeze_start" in text
        ok = not (black or frozen)
        detail = ("black_start" if black else "") + (
            (" " if black and frozen else "") + ("freeze_start" if frozen else ""))
        return QCCheck("start_not_frozen", "pass" if ok else "fail",
                       blocking=True, score=1.0 if ok else 0.0,
                       method="ffmpeg", detail=detail or "clean")
    except Exception as e:
        try:
            proc.kill()
        except Exception:
            pass
        return QCCheck("start_not_frozen", "skipped", blocking=True,
                       method="ffmpeg", detail=str(e)[:80])


async def quick_media_gate(path_or_url: str) -> tuple[bool, str]:
    """Gate minimal GRATUIT (ffprobe, marche aussi sur une URL R2) :
    flux vidéo + piste audio + durée dans les bornes. À appeler partout
    où un clip s'apprête à franchir qc_clip_validated — notamment le
    chemin dégradé de l'analyzer qui validait en aveugle quand Gemini
    était down (les 212 clips muets publiés sont passés par là)."""
    dur, aud = await check_media_sanity(path_or_url)
    if dur.verdict == "fail":
        return False, f"duration_sane: {dur.detail}"
    if aud.verdict == "fail":
        return False, f"audio_present: {aud.detail}"
    return True, "ok"


# ─── Check vision groupé (1 frame, 1 appel) ───────────────────────────

async def _vision_audit_frame(frame_path: str) -> Optional[dict]:
    if not await scheduler.wait_for("gemini"):
        return None
    from services.gemini_client import (
        get_client, _wait_for_file_active, handle_gemini_exception,
    )
    try:
        from google.genai import types  # type: ignore
        client = get_client()
        if client is None:
            return None
        img = await asyncio.to_thread(
            client.files.upload, file=frame_path,
            config=types.UploadFileConfig(mime_type="image/jpeg"),
        )
        if not await _wait_for_file_active(client, img, timeout=30):
            return None
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=config.GEMINI_MODEL_QC,
            contents=[VISION_PROMPT, img],
            config=types.GenerateContentConfig(
                response_mime_type="application/json"),
        )
        return json.loads((resp.text or "{}").strip())
    except Exception as e:
        handle_gemini_exception(e, where="clip_qc_v2_vision")
        return None


def _parse_timer_str(t: Optional[str]) -> Optional[int]:
    if not t:
        return None
    m = re.match(r"(\d+):(\d{2})", str(t).strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


# ─── QC complet d'un clip ─────────────────────────────────────────────

async def run_qc(
    clip_path: str,
    *,
    expected_timer_at: dict[int, int],
    killer_champion: Optional[str] = None,
    victim_champion: Optional[str] = None,
    budget: Optional[ProbeBudget] = None,
    allow_degraded: bool = False,
    is_duplicate: bool = False,
) -> QCResult:
    """Batterie complète sur un clip LOCAL.

    Args:
        expected_timer_at: {position_dans_le_clip_s: game_time_attendu_s}.
            Ex. pour un kill à gt=900 clippé avec pad -30 s :
            {15: 885, 32: 902}. Deux positions = vote multi-frames.
        budget: lectures Gemini autorisées (défaut : 2).
        allow_degraded: True quand le modèle de drift amont a une
            confiance ≥ 0.75 — un timer illisible ne bloque alors pas.
        is_duplicate: résultat du plan de dédup (check not_duplicate).
    """
    budget = budget or ProbeBudget(2)
    checks: list[QCCheck] = []
    drift_measured: Optional[int] = None

    # 0) not_duplicate — décidé en amont par modules/dedup.py
    checks.append(QCCheck(
        "not_duplicate", "fail" if is_duplicate else "pass", blocking=True,
        method="dedup_plan", detail="marked duplicate" if is_duplicate else "",
    ))

    # 1) sanité média (gratuit)
    dur, aud = await check_media_sanity(clip_path)
    checks.extend([dur, aud])

    # 1bis) frame noire / gel au départ (gratuit)
    if dur.verdict == "pass":
        checks.append(await check_start_frames(clip_path))

    tmp = clip_path + ".qcframe.jpg"
    vision_result: Optional[dict] = None

    # 2) timer_matches — multi-frames, OCR d'abord
    timer_reads: list[tuple[int, int, str]] = []   # (pos, lu, method)
    if dur.verdict == "pass":
        for pos, expected_gt in expected_timer_at.items():
            if not await _extract_frame(clip_path, pos, tmp):
                continue
            seconds, conf, _prof = timer_ocr.read(tmp)
            method = "ocr"
            if seconds is None and budget.take_gemini():
                vision_result = await _vision_audit_frame(tmp)
                if vision_result:
                    seconds = _parse_timer_str(vision_result.get("timer"))
                    method = "gemini"
                    if seconds is not None:
                        try:
                            timer_ocr.learn(tmp, seconds)
                        except Exception:
                            pass
            if seconds is not None:
                timer_reads.append((pos, seconds, method))
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass

    if timer_reads:
        drifts = [read - expected_timer_at[pos] for pos, read, _ in timer_reads]
        drift_measured = int(sorted(drifts)[len(drifts) // 2])  # médiane
        ok = abs(drift_measured) <= DRIFT_TOLERANCE
        checks.append(QCCheck(
            "timer_matches", "pass" if ok else "fail", blocking=True,
            score=max(0.0, 1.0 - abs(drift_measured) / 60.0),
            method="+".join(sorted({m for _, _, m in timer_reads})),
            detail=f"drift={drift_measured:+d}s sur {len(timer_reads)} frame(s)",
        ))
    else:
        checks.append(QCCheck(
            "timer_matches", "skipped" if allow_degraded else "fail",
            blocking=True, method="none",
            detail="timer illisible (OCR non calibré, Gemini indisponible)",
        ))

    # 3) start_is_gameplay — frame à t=1 s, OCR/vision
    start_verdict, start_method, start_detail = "skipped", "none", ""
    if dur.verdict == "pass" and await _extract_frame(clip_path, 1, tmp):
        seconds, conf, _prof = timer_ocr.read(tmp)
        if seconds is not None:
            start_verdict, start_method = "pass", "ocr"
            start_detail = f"timer lisible à t=1s ({seconds // 60}:{seconds % 60:02d})"
        elif vision_result is None and budget.take_gemini():
            vision_result = await _vision_audit_frame(tmp)
        if start_verdict == "skipped" and vision_result is not None:
            gp = bool(vision_result.get("is_gameplay"))
            start_verdict = "pass" if gp else "fail"
            start_method = "gemini"
            start_detail = f"is_gameplay={gp}"
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
    if (start_verdict == "skipped" and drift_measured is not None
            and abs(drift_measured) <= DRIFT_TOLERANCE):
        # le timer mi-clip a été lu ET matche → la fenêtre de 40 s couvre
        # du gameplay ; le départ l'est très probablement aussi
        start_verdict, start_method = "pass", "inferred_from_timer"
    if start_verdict == "skipped" and not allow_degraded:
        start_verdict = "fail"
        start_detail = start_detail or "aucune vérification possible"
    checks.append(QCCheck(
        "start_is_gameplay", start_verdict,
        blocking=True, method=start_method, detail=start_detail,
    ))

    # 4) permissifs — kill_visible + actors_match (depuis le même appel
    #    vision que le timer ; zéro coût additionnel)
    if vision_result is not None:
        kv = vision_result.get("kill_or_fight_visible")
        checks.append(QCCheck(
            "kill_visible", "pass" if kv else "fail", blocking=False,
            method="gemini", detail=f"kill_or_fight_visible={kv}",
        ))
        seen = {str(c).lower() for c in vision_result.get("champions_visible") or []}
        expected = {c.lower() for c in (killer_champion, victim_champion) if c}
        if expected and seen:
            overlap = expected & seen
            checks.append(QCCheck(
                "actors_match", "pass" if overlap else "fail", blocking=False,
                score=len(overlap) / len(expected),
                method="gemini",
                detail=f"vus={sorted(seen)[:6]} attendus={sorted(expected)}",
            ))
        else:
            checks.append(QCCheck("actors_match", "skipped", blocking=False,
                                  method="gemini", detail="pas de données"))
    else:
        checks.append(QCCheck("kill_visible", "skipped", blocking=False,
                              method="none"))
        checks.append(QCCheck("actors_match", "skipped", blocking=False,
                              method="none"))

    # ── Verdict agrégé ──
    blocking_fail = any(c.blocking and c.verdict == "fail" for c in checks)
    permissive_fail = any(not c.blocking and c.verdict == "fail" for c in checks)
    if blocking_fail:
        verdict = "needs_review"
    elif permissive_fail:
        verdict = "needs_review"
    else:
        verdict = "pass"

    result = QCResult(checks=checks, verdict=verdict,
                      drift_seconds=drift_measured,
                      timer_reads=timer_reads)
    log.info("clip_qc_v2_done", clip=os.path.basename(clip_path),
             verdict=verdict, drift=drift_measured,
             passed=result.pass_count, total=len(checks))
    return result
