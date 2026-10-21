"""E4 — Titres de clip écrits depuis les données du feed (0 jeton).

Remplace la description Gemini (1 appel vidéo par clip, premium 3.8-flash
sur les first blood et multi-kills). Tout ce qui est dit est vrai par
construction : qui, sur qui, quand, first blood, multi-kill, en solo, PV
restants du tueur, taille du combat. Gemini ne fait plus que, au mieux,
réécrire ce titre — jamais le deviner.
"""
from __future__ import annotations

import re

from qc3.timeline import KillMoment, Timeline

MAX_LEN = 120
LOW_HP = 0.15
TEAMFIGHT_WINDOW_MS = 15_000
TEAMFIGHT_MIN_KILLS = 4

_SPECIAL = {
    "MonkeyKing": "Wukong", "KSante": "K'Santé", "Kaisa": "Kai'Sa", "Khazix": "Kha'Zix",
    "Chogath": "Cho'Gath", "Velkoz": "Vel'Koz", "Reksai": "Rek'Sai", "KogMaw": "Kog'Maw",
    "Belveth": "Bel'Veth", "Leblanc": "LeBlanc", "JarvanIV": "Jarvan IV", "DrMundo": "Dr. Mundo",
    "Nunu": "Nunu & Willump", "RenataGlasc": "Renata Glasc", "TahmKench": "Tahm Kench",
    "TwistedFate": "Twisted Fate", "XinZhao": "Xin Zhao", "MasterYi": "Master Yi",
    "MissFortune": "Miss Fortune", "AurelionSol": "Aurelion Sol", "LeeSin": "Lee Sin",
}
_MULTI = {"double": "Double kill", "triple": "Triple kill", "quadra": "QUADRAKILL", "penta": "PENTAKILL"}


def champion(cid: str | None) -> str:
    if not cid:
        return "?"
    return _SPECIAL.get(cid) or re.sub(r"(?<=[a-z])(?=[A-Z])", " ", cid)


def player(name: str | None) -> str:
    """« KC Caliste » → « Caliste »."""
    if not name:
        return "?"
    parts = name.strip().split(" ", 1)
    return parts[1] if len(parts) == 2 and parts[0].isupper() and len(parts[0]) <= 5 else name


def mmss(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 60}:{s % 60:02d}"


def fight_size(tl: Timeline, k: KillMoment) -> int:
    return sum(1 for o in tl.kills if abs(o.epoch_ms - k.epoch_ms) <= TEAMFIGHT_WINDOW_MS)


def title(tl: Timeline, k: KillMoment) -> str:
    killer = f"{player(k.killer_name)} ({champion(k.killer_champion)})"
    victim = f"{player(k.victim_name)} ({champion(k.victim_champion)})" if k.victim_pid else "un adversaire"
    if k.multi_kill:
        head = f"{_MULTI[k.multi_kill]} de {killer}"
    elif k.is_first_blood:
        head = f"Premier sang : {killer} sur {victim}"
    else:
        head = f"{killer} élimine {victim}"
    tail: list[str] = []
    if not k.multi_kill and not k.assist_pids and k.victim_pid:
        tail.append("en solo")
    if k.killer_hp_pct is not None and 0 < k.killer_hp_pct <= LOW_HP:
        tail.append(f"à {round(k.killer_hp_pct * 100)} % de PV")
    n = fight_size(tl, k)
    if n >= TEAMFIGHT_MIN_KILLS:
        tail.append(f"dans un combat à {n} morts")
    out = head + (" " + ", ".join(tail) if tail else "") + f" — {mmss(k.chrono_s)}"
    return out if len(out) <= MAX_LEN else out[:MAX_LEN - 1] + "…"


def _ign(player_id: str | None) -> str | None:
    if not player_id:
        return None
    try:
        from services.supabase_client import safe_select
        rows = safe_select("players", "ign", id=player_id) or []
        return rows[0]["ign"] if rows else None
    except Exception:
        return None


def title_from_row(kill: dict) -> str:
    """Titre depuis une ligne `kills` (analyzer, Gemini éteint) : mêmes règles
    que `title`, sans les PV (absents de la base) ni la taille du combat."""
    def who(pid, champ):
        name = _ign(pid)
        return f"{name} ({champion(champ)})" if name else champion(champ)

    killer = who(kill.get("killer_player_id"), kill.get("killer_champion"))
    victim = who(kill.get("victim_player_id"), kill.get("victim_champion"))
    mk = kill.get("multi_kill")
    if mk in _MULTI:
        head = f"{_MULTI[mk]} de {killer}"
    elif kill.get("is_first_blood"):
        head = f"Premier sang : {killer} sur {victim}"
    else:
        head = f"{killer} élimine {victim}"
    tail = []
    if not mk and not (kill.get("assistants") or []):
        tail.append("en solo")
    if int(kill.get("shutdown_bounty") or 0) >= 400:
        tail.append(f"pour une prime de {int(kill['shutdown_bounty'])} PO")
    out = head + (" " + ", ".join(tail) if tail else "")
    if kill.get("game_time_seconds") is not None:
        out += f" — {mmss(kill['game_time_seconds'])}"
    # le portail qc_described exige ≥ 50 caractères
    if len(out) < 50:
        out += " · le kill en vidéo sur KC KILLS"
    return out if len(out) <= MAX_LEN else out[:MAX_LEN - 1] + "…"
