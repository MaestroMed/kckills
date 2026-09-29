# -*- coding: utf-8 -*-
"""
GAMEPLAY_GATE — « ce clip montre-t-il la partie ? », en local, sans Gemini.

Incident du 29/09/2026 : 1 149 clips publiés montraient la draft, le
plateau, une interview, la scène ou la facecam d'un streamer au lieu du kill
(offset VOD inconnu coupé à 0, VOD de série partagée, kill de fin de game).
L'analyzer ne classe plus le contexte du clip et son `kill_visible` disait
« vrai » sur des drafts ; rien n'arrêtait ces clips avant le feed.

Modèle : SigLIP 2 (open_clip `ViT-B-16-SigLIP2-256`, poids `webli`) + sonde
linéaire (gameplay_probe.npz, à côté de ce module) entraînée sur 645
vignettes annotées à l'œil. Validation croisée : précision 0,994, rappel
0,977 (« sans jeu ») ; sur les images de clips, 97 clips de jeu sur 100 sans
aucune image rejetée. Chaque image verticale (recadrage de la vignette) est
vue en deux carrés, haut et bas, concaténés.

Usages :
  * check_clip(mp4)          — 5 images à 10/30/50/70/90 % ; 'fail' si au
                               moins 3/5 sont sans jeu (règle de l'audit),
                               'warn' à 1-2, 'pass' à 0 ;
  * gameplay_candidates(...) — écarte des vignettes candidates celles qui
                               ne montrent pas le jeu (le sélecteur par
                               variance de luminance élisait les volets de
                               transition LFL / REPLAY / LEC Versus).

Dégradation (CLAUDE.md §5.9) : torch / open_clip absents, poids
introuvables ou erreur -> 'skipped', jamais bloquant. Dépendances :
requirements-vision.txt. KCKILLS_GAMEPLAY_GATE=0 coupe la porte.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path

import structlog

log = structlog.get_logger()

MODEL_NAME = "ViT-B-16-SigLIP2-256"
PRETRAINED = "webli"
PROBE_PATH = Path(__file__).with_name("gameplay_probe.npz")
POSITIONS = (0.10, 0.30, 0.50, 0.70, 0.90)
NG_THRESHOLD = 0.5          # p(sans jeu) d'une image
FAIL_MIN_FRAMES = 3         # >= 3 images sur 5 sans jeu -> clip hors jeu
# Même recadrage que la vignette / le clip vertical (clipper.clip_kill).
VERTICAL_CROP = "crop=ih*9/16:ih:iw/2-ih*9/32+iw*0.08:0,scale=540:960"

_lock = threading.Lock()
_state: dict = {"loaded": False, "error": None}


@dataclass
class GateResult:
    verdict: str                      # 'pass' | 'warn' | 'fail' | 'skipped'
    n_ng: int = 0
    p: list = field(default_factory=list)
    detail: str = ""


def enabled() -> bool:
    return os.environ.get("KCKILLS_GAMEPLAY_GATE", "1") not in ("0", "false", "off")


def verdict_from_scores(p: list) -> tuple[str, int]:
    """Règle pure (testée) : nombre d'images sans jeu -> verdict."""
    seen = [x for x in p if x is not None]
    if not seen:
        return "skipped", 0
    n = sum(1 for x in seen if x >= NG_THRESHOLD)
    if n >= FAIL_MIN_FRAMES:
        return "fail", n
    return ("warn" if n else "pass"), n


def _load() -> bool:
    """Charge modèle + sonde une seule fois (appelé sous _lock)."""
    if _state["loaded"]:
        return True
    if _state["error"]:
        return False
    try:
        import numpy as np
        import open_clip
        import torch

        torch.set_num_threads(int(os.environ.get("KCKILLS_GATE_THREADS", "4")))
        model, _, pre = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
        model.eval()
        probe = np.load(PROBE_PATH)
        if str(probe["model"]) != MODEL_NAME:
            raise ValueError(f"sonde entraînée pour {probe['model']}, pas {MODEL_NAME}")
        _state.update(loaded=True, model=model, pre=pre, torch=torch, np=np,
                      coef=probe["coef"][0].astype("float32"), b=float(probe["intercept"][0]))
        log.info("gameplay_gate_loaded", model=MODEL_NAME)
        return True
    except Exception as e:  # dépendance absente, pas de réseau pour les poids…
        _state["error"] = f"{type(e).__name__}: {str(e)[:160]}"
        log.warn("gameplay_gate_unavailable", error=_state["error"])
        return False


def score_images(images: list) -> list | None:
    """p(sans jeu) par image PIL (verticale, cadrage vignette). None si la
    porte est indisponible."""
    if not enabled() or not images:
        return None
    with _lock:
        if not _load():
            return None
        torch, np, pre, model = _state["torch"], _state["np"], _state["pre"], _state["model"]
        views = []
        for im in images:
            im = im.convert("RGB")
            w, h = im.size
            s = min(w, h)
            views += [pre(im.crop((0, 0, s, s))), pre(im.crop((0, h - s, s, h)))]
        with torch.no_grad():
            e = model.encode_image(torch.stack(views)).float()
        e = (e / e.norm(dim=-1, keepdim=True)).numpy().reshape(len(images), -1)
        z = e @ _state["coef"] + _state["b"]
        return [round(float(v), 4) for v in 1.0 / (1.0 + np.exp(-z))]


def score_paths(paths: list[str]) -> list | None:
    from PIL import Image

    ims = []
    for p in paths:
        try:
            ims.append(Image.open(p))
        except Exception:
            return None
    return score_images(ims)


def gameplay_candidates(paths: list[str]) -> list[str]:
    """Candidates de vignette qui montrent le jeu. Si la porte est
    indisponible, ou si aucune ne montre le jeu, renvoie la liste telle quelle
    (le sélecteur historique décide)."""
    if len(paths) < 2:
        return paths
    try:
        p = score_paths(paths)
    except Exception as e:
        log.warn("gameplay_gate_thumbnail_error", error=str(e)[:160])
        return paths
    if not p:
        return paths
    keep = [path for path, x in zip(paths, p) if x < NG_THRESHOLD]
    return keep or paths


async def _ffmpeg_frame(src: str, t: float, dst: str, crop: bool) -> bool:
    args = ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.2f}", "-i", src, "-frames:v", "1"]
    if crop:
        args += ["-vf", VERTICAL_CROP]
    args += ["-q:v", "3", "-y", dst]
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL,
                                                stderr=asyncio.subprocess.DEVNULL)
    try:
        await asyncio.wait_for(proc.wait(), timeout=60)
    except asyncio.TimeoutError:
        proc.kill()
        return False
    return proc.returncode == 0 and os.path.exists(dst)


async def _duration(src: str) -> float | None:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip())
    except ValueError:
        return None


async def check_clip(src: str, duration_s: float | None = None, crop_vertical: bool = True) -> GateResult:
    """5 images du clip (fichier local OU URL http) -> verdict.

    crop_vertical=True pour un clip horizontal (recadré comme la vignette) ;
    False pour un clip déjà vertical (clip_url_vertical)."""
    if not enabled():
        return GateResult("skipped", detail="désactivée")
    tmp = tempfile.mkdtemp(prefix="gpgate_")
    try:
        d = duration_s or await _duration(src)
        if not d:
            return GateResult("skipped", detail="durée illisible")
        paths = []
        for i, pos in enumerate(POSITIONS):
            dst = os.path.join(tmp, f"f{i}.jpg")
            if await _ffmpeg_frame(src, d * pos, dst, crop_vertical):
                paths.append(dst)
        if len(paths) < len(POSITIONS) - 1:
            return GateResult("skipped", detail=f"images extraites {len(paths)}/5")
        p = await asyncio.to_thread(score_paths, paths)
        if p is None:
            return GateResult("skipped", detail=_state.get("error") or "porte indisponible")
        verdict, n = verdict_from_scores(p)
        return GateResult(verdict, n, p, f"images_sans_jeu={n}/{len(p)}")
    except Exception as e:  # jamais bloquant
        return GateResult("skipped", detail=f"erreur: {str(e)[:120]}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
