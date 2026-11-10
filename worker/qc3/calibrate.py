"""Apprentissage des chiffres du score (engine_v2.score) depuis le feed, sur
une vidéo synchronisée : aucun étiquetage à la main.

    python -m qc3.calibrate --game-ext <id> --video <fichier> --anchor <s> [--origin S]
                            --chrono-profile worlds26_row --score-profile worlds26
"""
from __future__ import annotations

import argparse
import asyncio

from engine_v2.chrono import ChronoReader
from engine_v2.score import ScoreReader
from qc3.sync import LocalVideo, VodSync
from qc3.timeline import Timeline, load_timeline

QUIET_MS = 6_000      # aucun kill à ±6 s : le score affiché est sans ambiguïté


def samples(tl: Timeline, vs: VodSync, step_s: float = 4.0):
    """(position, gauche, droite) aux instants calmes de la game."""
    kills = [k.epoch_ms for k in tl.kills]
    end = tl.clock.end_ms or tl.frames[-1][0]
    e = tl.start_ms + 60_000
    while e < end - 5_000:
        if all(abs(e - k) > QUIET_MS for k in kills):
            b, r = tl.team_kills_at(e)
            yield vs.pos(e), b, r
        e += int(step_s * 1000)


def learn(tl: Timeline, vs: VodSync, src, chrono: ChronoReader, score: ScoreReader,
          holdout_every: int = 3) -> dict:
    learned = tested = good = wrong = refused = 0
    for i, (pos, b, r) in enumerate(samples(tl, vs)):
        im = src.frame(pos)
        if im is None or chrono.read(im).seconds is None:
            continue          # pas en jeu (replay, coupure) : on n'apprend rien
        if i % holdout_every == 0 and len(score.templates) >= 8:
            tested += 1
            got = score.read(im)
            if got.left is None or got.right is None:
                refused += 1
            elif (got.left, got.right) == (b, r):
                good += 1
            else:
                wrong += 1
            continue
        learned += score.learn(im, b, r)
    return {"learned_digits": learned, "calibrated": score.calibrated, "tested": tested,
            "good": good, "wrong": wrong, "refused": refused,
            "templates": {k: len(v) for k, v in sorted(score.templates.items())}}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-ext", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--anchor", type=float, required=True)
    ap.add_argument("--origin", type=float, default=0.0)
    ap.add_argument("--chrono-profile", default="worlds26_row")
    ap.add_argument("--score-profile", default="worlds26")
    a = ap.parse_args()
    tl = asyncio.run(load_timeline(a.game_ext))
    vs = VodSync(tl.start_ms, a.anchor, 0.0)
    src = LocalVideo(a.video, a.origin)
    print(learn(tl, vs, src, ChronoReader(a.chrono_profile), ScoreReader(a.score_profile)))
    src.close()
