"""E3 — Contrôle local d'un clip, sans IA payante, verdict définitif.

Preuve principale : le chrono lu à l'écran (engine_v2.chrono) dans les
secondes qui précèdent le kill vaut le chrono attendu (feed) à ±TIMER_TOL.
Ça prouve à la fois « c'est du jeu en direct » (le HUD n'est là qu'en jeu)
et « c'est le bon moment » — ce que la QC Gemini essayait de deviner sur une
image (kill_visible, actors_match : faux négatifs en série).

Preuve indépendante (la synchro E2 repose aussi sur le chrono, donc le
chrono seul ne peut pas déceler un décalage constant feed ↔ écran) : le
score de kills du bandeau du haut (engine_v2.score, appris depuis le feed)
vaut, juste avant le kill, ce que dit le feed, et celui de l'équipe du
tueur a augmenté juste après. 111/111 lectures justes sur KC–C9 G4-G5.
Les portraits du tableau du bas (hud_deaths) ne servent qu'en secours : la
régie change de mise en page pendant les combats (7 faux refus sur G4).

Verdicts :
  pass       chrono confirmé ET score avant/après conforme au feed
  pass_timer chrono confirmé, score illisible (bandeau masqué) : kill non
             observable, pas contredit
  off_air    aucune lecture du chrono autour du kill : la régie est ailleurs
             (foule, caméra joueur, replay sans HUD). Définitif : re-couper
             ne changera rien, c'est la diffusion.
  mistimed   chrono lu mais pas le bon : ancre fausse → la game repasse par
             la synchronisation, jamais clip par clip.
  broken     fichier illisible, trop court, sans son.

Aucun verdict ne déclenche de nouvelle tentative automatique.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass, field

import cv2

from engine_v2.chrono import ChronoReader, frame_at
from engine_v2.hud_deaths import portrait_sats

TIMER_TOL = 2.0          # s
MIN_TIMER_HITS = 2
READ_OFFSETS = (-8, -6, -4, -3, -2, -1, 0, 1)   # s autour du kill dans le clip
MIN_DURATION = 6.0


@dataclass
class ClipVerdict:
    verdict: str
    timer_hits: int = 0
    timer_reads: list[dict] = field(default_factory=list)   # {t, read, expected}
    duration_s: float | None = None
    audio: bool | None = None
    hud_death_t: float | None = None     # instant où le portrait de la victime grise (s du clip)
    hud_delta_s: float | None = None     # hud_death_t − kill_t
    detail: str = ""

    def to_json(self) -> dict:
        return asdict(self)


def _probe(path: str) -> tuple[float | None, bool | None]:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
                            "-of", "json", path], capture_output=True, text=True, timeout=30)
        d = json.loads(r.stdout or "{}")
        dur = float((d.get("format") or {}).get("duration") or 0) or None
        audio = any(s.get("codec_type") == "audio" for s in d.get("streams") or [])
        return dur, audio
    except Exception:
        return None, None


HUD_STEP = 0.5
HUD_RATIO = 0.45          # gris = saturation < 45 % de la référence « vivant »
HUD_MIN_GREY = 1.5        # s de gris continu
HUD_WINDOW = (-7.0, 2.0)  # mort attendue entre kill_t-7 et kill_t+2 (le feed suit l'écran de ~3 s)


def hud_death(path: str, slot: int, kill_t: float, dur: float, profile: str) -> tuple[float | None, bool]:
    """(instant où le portrait `slot` grise, tableau visible ?)."""
    cap = cv2.VideoCapture(path)
    T, S = [], []
    t = 0.0
    while t < dur - 0.2:
        im = frame_at(cap, t)
        if im is not None:
            T.append(t)
            S.append(portrait_sats(im, profile))
        t += HUD_STEP
    cap.release()
    if len(T) < 6:
        return None, False
    import numpy as np
    S = np.array(S)
    ref_rows = [i for i, x in enumerate(T) if x < kill_t + HUD_WINDOW[0]] or list(range(min(4, len(T))))
    ref = np.percentile(S[ref_rows], 75, axis=0)
    low = S < HUD_RATIO * np.maximum(ref, 1e-6)[None, :]
    hidden = low.sum(axis=1) >= 6
    visible = (~hidden).sum() >= len(T) * 0.5
    for i, x in enumerate(T):
        if hidden[i] or not low[i, slot]:
            continue
        j = i
        while j + 1 < len(T) and (low[j + 1, slot] or hidden[j + 1]):
            j += 1
        if T[j] - x + HUD_STEP >= HUD_MIN_GREY and kill_t + HUD_WINDOW[0] <= x <= kill_t + HUD_WINDOW[1]:
            return x, visible
    return None, visible


SCORE_BEFORE = (-8.0, -4.5)    # s autour du kill (instant du feed) dans le clip
SCORE_AFTER = (1.0, 6.0)
SCORE_STEP = 0.5


def score_check(path: str, kill_t: float, dur: float, score_reader, expected_at, killer_side: str) -> tuple[str, dict]:
    """('ok' | 'unreadable' | 'contradicts', détail). `expected_at(dt)` rend les
    scores (gauche, droite) admissibles à kill_t + dt (le feed suit l'écran de
    0 à ~4 s : plusieurs valeurs admises autour d'un kill)."""
    cap = cv2.VideoCapture(path)

    def read_at(t: float):
        im = frame_at(cap, t)
        if im is None:
            return None
        r = score_reader.read(im)
        return (r.left, r.right) if r.left is not None and r.right is not None else None

    def first_read(lo: float, hi: float):
        """Première lecture CONFIRMÉE (même score 0,5 s plus tard) : une
        incrustation sur le bandeau fait confondre 6 et 8 (KC–C9 G5 27:50)."""
        t = kill_t + lo
        while t + SCORE_STEP <= min(kill_t + hi, dur - 0.2):
            a = read_at(t)
            if a is not None and a == read_at(t + SCORE_STEP):
                return t - kill_t, a
            t += SCORE_STEP
        return None, None

    tb, before = first_read(*SCORE_BEFORE)
    ta, after = first_read(*SCORE_AFTER)
    cap.release()
    detail = {"before": before, "after": after, "t_before": tb, "t_after": ta}
    if before is None or after is None:
        return "unreadable", detail
    # un score ne descend pas et ne saute pas de 6 kills en 10 s : lecture fausse
    if any(a < b or a - b > 5 for a, b in zip(after, before)):
        return "unreadable", detail
    i = 0 if killer_side == "blue" else 1
    ok = before in expected_at(tb) and after in expected_at(ta) and after[i] > before[i]
    return ("ok" if ok else "contradicts"), detail


def verify_clip(path: str, kill_t: float, expected_chrono_at_kill: float, reader: ChronoReader,
                victim_slot: int | None = None, hud_profile: str = "worlds26",
                require_audio: bool = True, score_reader=None, expected_score_at=None,
                killer_side: str | None = None) -> ClipVerdict:
    """`kill_t` = position du kill dans le clip (s) ; `expected_chrono_at_kill`
    = chrono du feed à l'instant du kill. Le chrono attendu à kill_t + dt
    vaut expected + dt (pas de pause dans 10 s de clip ; sinon la lecture
    échoue et le verdict le dit)."""
    dur, audio = _probe(path)
    if not dur or dur < MIN_DURATION:
        return ClipVerdict("broken", duration_s=dur, audio=audio, detail="durée")
    if require_audio and audio is False:
        return ClipVerdict("broken", duration_s=dur, audio=audio, detail="sans son")
    cap = cv2.VideoCapture(path)
    reads, hits, misses = [], 0, 0
    for dt in READ_OFFSETS:
        t = kill_t + dt
        if t < 0 or t > dur - 0.2:
            continue
        im = frame_at(cap, t)
        rd = reader.read(im) if im is not None else None
        exp = expected_chrono_at_kill + dt
        reads.append({"t": round(t, 2), "read": rd.seconds if rd else None, "expected": round(exp, 1)})
        if rd and rd.seconds is not None:
            if abs(rd.seconds + 0.5 - exp) <= TIMER_TOL:
                hits += 1
            else:
                misses += 1
    cap.release()
    if hits >= MIN_TIMER_HITS and hits > misses:
        if score_reader is not None and expected_score_at is not None and killer_side:
            st, det = score_check(path, kill_t, dur, score_reader, expected_score_at, killer_side)
            if st == "ok":
                return ClipVerdict("pass", hits, reads, dur, audio, detail=f"score {det['before']}→{det['after']}")
            if st == "contradicts":
                return ClipVerdict("mistimed", hits, reads, dur, audio,
                                   detail=f"score lu {det['before']}→{det['after']} ≠ feed")
            # illisible : secours par les portraits du bas
        if victim_slot is None:
            return ClipVerdict("pass_timer", hits, reads, dur, audio, detail="victime inconnue")
        ht, board = hud_death(path, victim_slot, kill_t, dur, hud_profile)
        if ht is not None:
            return ClipVerdict("pass", hits, reads, dur, audio, ht, round(ht - kill_t, 1))
        # Les portraits ne font que confirmer : la régie change la mise en
        # page du tableau pendant les combats, une mort « non vue » ne
        # contredit rien.
        return ClipVerdict("pass_timer", hits, reads, dur, audio,
                           detail="score illisible, mort non observée" if board else "score et tableau masqués")
    if misses == 0:
        return ClipVerdict("off_air", hits, reads, dur, audio, "chrono illisible autour du kill")
    return ClipVerdict("mistimed", hits, reads, dur, audio, f"{misses} lecture(s) hors tolérance")
