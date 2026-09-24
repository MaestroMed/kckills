# -*- coding: utf-8 -*-
"""
EDIT V4 — montage lisible (retour de Mehdi sur la V3 le 24/09/2026 : « pas
terrible ni lisible »).

Ce qui n'allait pas dans la V3 : 38 plans en 59 s (1,3 s par plan, le penta
tenait en 2,6 s), crop 9:16 serré au centre d'une image 16:9 (un tiers de la
largeur, flou), nom + tag posés sur les champions 38 fois, flashs blancs.

La V4 :
  - 5 moments montrés EN ENTIER, fenêtres calées à l'image sur les bannières
    du broadcast (DOUBLE/TRIPLE/QUADRA/PENTAKILL, « has stolen the Elder »),
    pas sur les horodatages du feed (en retard jusqu'à 10 s sur un penta) ;
  - le broadcast en 4:3 au centre (scores, chrono, caméras des joueurs),
    fond flouté du même plan ;
  - titre au-dessus, contexte et compteur en dessous : jamais sur l'action ;
  - coupes franches, voix des casteurs conservées, loudnorm -14 LUFS ;
  - teaser de 1,6 s sur la bannière PENTAKILL en ouverture (accroche).

Sources : clips 1080p60 du juge v3 (edit_summer/obj_v3) et section Twitch
calée de la game du penta (vods/twitch_*_<game>.mp4).

Usage :
  python tools/edit/build_v4.py --out "%USERPROFILE%\\Downloads\\KC_Summer2026_edit_V4.mp4"
  python tools/edit/build_v4.py --out ... --music 94.mp3 --music-offset 12.0
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import assemble  # noqa: E402  (render_card, run, CFR_VIDEO, polices)

W, H, FPS = 1080, 1920, 30
FG_W, FG_H, FG_Y = 1080, 810, 545          # bande 4:3 du broadcast
GOLD = "0xC8AA6E"
OSWALD = "D:/kckills_worker/edit_summer/assets/Oswald.ttf"
IMPACT = "C:/Windows/Fonts/impact.ttf"
OBJ = Path(r"D:\kckills_worker\edit_summer\obj_v3")
PENTA_SECTION = r"D:\kckills_worker\vods\twitch_v2865807973_115548681803406292.mp4"
LOGO = r"D:\kckills_worker\edit_summer\assets\kc-logo.png"
ENC = ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "19", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]

# Fenêtres vérifiées à l'image le 24/09/2026 (planches contact 1 image/s).
SHOTS = [
    {"id": "teaser", "src": PENTA_SECTION, "start": 2675.0, "dur": 1.6,
     "title": ("LE SUMMER 2026", "DE LA KC"), "sub": "9-0 EN SAISON · CAP SUR LES WORLDS"},
    # « Blue team has stolen the Elder Dragon! » à 8 s, SHUT DOWN à 11-13 s
    {"id": "steal", "src": OBJ / "115548681803406261_2476.mp4", "start": 3.5, "dur": 8.5, "n": 1,
     "title": ("LE STEAL D'ELDER", "DE YIKE"), "sub": "vs SK · GAME 2"},
    # engage à ~9,5 s (juge : « le R de Kyeahoo touche 4 joueurs »), kills jusqu'à 16 s
    {"id": "kyeahoo", "src": OBJ / "115548681803406226_1955.mp4", "start": 7.0, "dur": 8.5, "n": 2,
     "title": ("L'ULTI DE KYEAHOO", "4 JOUEURS TOUCHÉS"), "sub": "vs SHFT · GAME 3"},
    # SHUT DOWN 52,5 s -> DOUBLE 55,5 -> TRIPLE 58,5 -> QUADRA 60,5
    {"id": "quadra_sk", "src": OBJ / "6998ab85-a790-40fb-8f95-2cd933cc5d37.mp4", "start": 51.8, "dur": 11.0, "n": 3,
     "title": ("LE QUADRA", "DE CALISTE"), "sub": "vs SK · GAME 1 · EZREAL"},
    # rampage 4-6 s -> DOUBLE 7 s -> QUADRA 12 s -> ACE 15 s
    {"id": "quadra_gx", "src": OBJ / "c452e097-78c3-48c1-8d40-a561c1cb3752.mp4", "start": 3.8, "dur": 12.2, "n": 4,
     "title": ("LE QUADRA", "DE YIKE"), "sub": "vs GX · GAME 2 · QIYANA"},
    # 1er kill 2663 -> DOUBLE 2667 -> QUADRA 2671 -> PENTAKILL 2675-2677 -> ACE 2679
    {"id": "penta", "src": PENTA_SECTION, "start": 2661.0, "dur": 19.0, "n": 5,
     "title": ("LE PENTAKILL", "DE CANNA"), "sub": "PLAYOFFS vs GX · JAYCE"},
]
TOTAL_MOMENTS = sum(1 for s in SHOTS if s.get("n"))


def _ff_path(p: str | Path) -> str:
    """Chemin utilisable dans un filtre ffmpeg (C:/... avec ':' échappé)."""
    return str(p).replace("\\", "/").replace(":", "\\:")


def _text(tmp: Path, name: str, value: str) -> str:
    p = tmp / f"{name}.txt"
    p.write_text(value, encoding="utf-8")
    return _ff_path(p)


def _drawtext(textfile: str, font: str, size: int, color: str, y: int, t0: float = 0.0,
              border: int = 6) -> str:
    fade = f":alpha='min(1,max(0,(t-{t0:.2f})/0.15))'" if t0 >= 0 else ""
    return (f"drawtext=fontfile='{_ff_path(font)}':textfile='{textfile}':fontsize={size}:fontcolor={color}:"
            f"borderw={border}:bordercolor=black:x=(w-text_w)/2:y={y}{fade}")


def layout_filter(shot: dict, tmp: Path) -> str:
    """fond flouté + broadcast 4:3 au centre + textes dans les bandes."""
    t1, t2 = shot["title"]
    parts = [
        f"[0:v]fps={FPS},split=2[bg][fg]",
        f"[bg]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
        "boxblur=28:2,eq=brightness=-0.30:saturation=0.75[bgb]",
        f"[fg]crop=ih*4/3:ih,scale={FG_W}:{FG_H}:flags=lanczos,eq=contrast=1.04:saturation=1.08[fgs]",
        f"[bgb][fgs]overlay=0:{FG_Y}[base]",
    ]
    draw = [
        f"drawbox=x=0:y={FG_Y - 3}:w={W}:h=3:color={GOLD}@0.9:t=fill",
        f"drawbox=x=0:y={FG_Y + FG_H}:w={W}:h=3:color={GOLD}@0.9:t=fill",
        _drawtext(_text(tmp, shot["id"] + "_t1", t1), OSWALD, 124, "white", 175),
        _drawtext(_text(tmp, shot["id"] + "_t2", t2), OSWALD, 124, GOLD, 318, t0=0.08),
        _drawtext(_text(tmp, shot["id"] + "_sub", shot["sub"]), IMPACT, 60, "white", FG_Y + FG_H + 45, t0=0.12, border=4),
    ]
    if shot.get("n"):
        draw.append(_drawtext(_text(tmp, shot["id"] + "_n", f"{shot['n']} / {TOTAL_MOMENTS}"), IMPACT, 50, GOLD,
                              FG_Y + FG_H + 140, t0=0.12, border=3))
    draw.append(_drawtext(_text(tmp, shot["id"] + "_wm", "KCKILLS.COM"), IMPACT, 44, "white@0.75", 1765, t0=-1, border=3))
    parts.append("[base]" + ",".join(draw) + "[v]")
    return ";".join(parts)


def render_shot(shot: dict, tmp: Path) -> Path:
    dst = tmp / f"{shot['id']}.mp4"
    dur = float(shot["dur"])
    fc = layout_filter(shot, tmp) + (
        f";[0:a]aresample=48000,afade=t=in:st=0:d=0.04,afade=t=out:st={max(0.0, dur - 0.06):.3f}:d=0.06[a]")
    assemble.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{float(shot['start']):.3f}",
                  "-t", f"{dur + 0.4:.3f}", "-i", str(shot["src"]), "-filter_complex", fc,
                  "-map", "[v]", "-map", "[a]", "-r", str(FPS), "-t", f"{dur:.3f}"] + ENC + [str(dst)])
    return dst


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--music", default=None, help="MP3 : les casters passent dessous (--caster-db)")
    ap.add_argument("--music-offset", type=float, default=0.0)
    ap.add_argument("--caster-db", type=float, default=-12.0)
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="kcedit_v4_"))
    try:
        parts = []
        for shot in SHOTS:
            if not os.path.exists(shot["src"]):
                raise SystemExit(f"source absente : {shot['src']}")
            parts.append(render_shot(shot, tmp))
            print(f"  {shot['id']:<10} {shot['dur']:>5.1f} s ok", flush=True)
        outro = tmp / "outro.mp4"
        assemble.render_card("KCKILLS.COM", "EVERY KILL. RATED.", 2.2, str(outro), LOGO)
        parts.append(outro)
        lst = tmp / "list.txt"
        lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
        concat = tmp / "concat.mp4"
        assemble.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                      "-i", str(lst), "-c", "copy", str(concat)])
        if args.music and os.path.exists(args.music):
            mix = (f"[0:a]volume={args.caster_db}dB[c];[1:a][c]amix=inputs=2:duration=first:dropout_transition=0,"
                   "loudnorm=I=-14:TP=-1.5:LRA=9[a]")
            assemble.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(concat),
                          "-ss", f"{args.music_offset:.3f}", "-i", args.music, "-filter_complex", mix,
                          "-map", "0:v", "-map", "[a]", *assemble.CFR_VIDEO, "-c:a", "aac", "-b:a", "192k",
                          "-movflags", "+faststart", "-shortest", args.out])
        else:
            assemble.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(concat),
                          "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", *assemble.CFR_VIDEO, "-c:a", "aac", "-b:a", "192k",
                          "-movflags", "+faststart", args.out])
        dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.out],
                             capture_output=True, text=True).stdout.strip()
        print(f"OK {args.out} — {float(dur or 0):.1f} s, {len(parts)} plans")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
