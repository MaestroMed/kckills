"""Rendu d'un clip vertical 9:16 cadré par la caméra virtuelle LoLscan.

La caméra (lolscan.camera) suit le fight à partir des barres de vie : plein
cadre 9:16 quand le cœur du fight tient dans 407 px de large, sinon bande
16:9 agrandie sur fond flouté. Au lieu du recadrage fixe au centre du
moteur actuel, qui coupe souvent l'action.

Encodage NVENC (GPU) en priorité basse, son de la diffusion conservé.
"""
from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass

import cv2

sys.path.insert(0, r"D:\PROJECTS\KC_ROAD_TO_WORLDS\_design_system")
from lolscan import camera as CA  # noqa: E402


@dataclass
class Fmt:
    w: int = 1080
    h: int = 1920
    fps: int = 30


def render_vertical(video: str, t0: float, t1: float, out: str, fmt: Fmt = Fmt()) -> dict:
    piste = CA.suivre_fight(video, t0, t1, ips=10)
    cap = cv2.VideoCapture(video)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 60
    cap.set(cv2.CAP_PROP_POS_MSEC, t0 * 1000)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    enc = subprocess.Popen(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{fmt.w}x{fmt.h}", "-r", str(fmt.fps), "-i", "-",
            "-ss", f"{t0:.3f}", "-t", f"{t1 - t0:.3f}", "-i", video,
            "-map", "0:v", "-map", "1:a?",
            "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "21", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", out,
        ],
        stdin=subprocess.PIPE,
        creationflags=getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0),
    )
    n_out = int((t1 - t0) * fmt.fps)
    step = src_fps / fmt.fps
    src_i, next_take, written = 0, 0.0, 0
    while written < n_out:
        ok = cap.grab()
        if not ok:
            break
        if src_i >= next_take:
            ok, im = cap.retrieve()
            if not ok:
                break
            t = t0 + src_i / src_fps
            enc.stdin.write(CA.rendre(im, piste(t), fmt).tobytes())
            written += 1
            next_take += step
        src_i += 1
    cap.release()
    enc.stdin.close()
    enc.wait()
    return {"out": out, "frames": written, "ok": enc.returncode == 0}
