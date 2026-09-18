# -*- coding: utf-8 -*-
"""
BEATS — analyse la musique : tempo, grille de temps (beats) et fenêtre la plus
énergique (le drop) pour caler l'edit. Sortie : beats.json
Usage : python beats.py <fichier audio> [--window 60] [--start-hint 0]
"""
import argparse
import json
import sys

import librosa
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("audio")
ap.add_argument("--window", type=float, default=60.0, help="durée de l'edit (s)")
ap.add_argument("--start-hint", type=float, default=None, help="forcer le départ (s) au lieu du drop auto")
ap.add_argument("--out", default=r"D:\kckills_worker\edit_summer\beats.json")
a = ap.parse_args()

y, sr = librosa.load(a.audio, sr=22050, mono=True)
dur = len(y) / sr
tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames", trim=False)
tempo = float(np.atleast_1d(tempo)[0])
beats = librosa.frames_to_time(beat_frames, sr=sr)
# énergie RMS lissée par mesure pour trouver le passage le plus chaud
rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
t_rms = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
win = a.window
best_t, best_e = 0.0, -1
if a.start_hint is None:
    for b in beats:
        if b + win > dur:
            break
        m = (t_rms >= b) & (t_rms < b + win)
        e = float(rms[m].mean()) if m.any() else 0
        if e > best_e:
            best_e, best_t = e, float(b)
else:
    # on aligne le hint sur le beat le plus proche
    best_t = float(beats[np.argmin(np.abs(beats - a.start_hint))])
sel = [float(b) for b in beats if best_t <= b <= best_t + win + 1.0]
# downbeats approximatifs : on suppose 4/4, le 1er beat du drop = temps 1
out = {"audio": a.audio, "duration": round(dur, 2), "tempo_bpm": round(tempo, 2), "beat_period": round(60.0 / tempo, 4),
       "n_beats": len(beats), "edit_start": round(best_t, 3), "edit_window": win, "beats_in_window": [round(b, 3) for b in sel]}
json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1)
print(f"tempo {tempo:.1f} BPM | durée {dur:.0f}s | départ conseillé {best_t:.2f}s (énergie max sur {win:.0f}s) | {len(sel)} temps dans la fenêtre -> {a.out}")
