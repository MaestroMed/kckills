"""REAL_DATA_EXPORT — fiche des séries de KC (scores, KDA, champions par game) publiée sur R2.

Le site lisait web/src/data/kc_matches.json, figé au 11/04/2026 : stats des
joueurs, /stats, /players, /compare, fiches joueur, compteurs… ne bougeaient
plus. Ce module régénère le même fichier (même forme : lib/real-data.ts côté
site) et le publie sur R2 sous `data/kc_matches.json`. Le site le relit
toutes les 30 min.

Incrémental : on repart du fichier publié (ou de celui du dépôt la première
fois, avec un parcours complet du calendrier) ; on ajoute les séries
nouvelles et on complète les games manquantes, MAX_GAMES_PER_RUN par passe
pour ne pas monopoliser le feed livestats. Une game sans stats est retentée
au plus MAX_ATTEMPTS fois (état local : real_data_export_state.json).

Corrige trois défauts du script d'origine (scripts/fetch_real_data.py) :
- le camp de KC était celui du MATCH, alors qu'il change d'une game à
  l'autre : 14 games sur 112 comptaient les joueurs adverses comme KC.
  Ici le camp se lit game par game (pseudos préfixés « KC ») ;
- 29 séries sur 83 n'avaient pas toutes leurs games ;
- seule la LEC était lue : les ligues suivies (Worlds, MSI, First Stand…)
  le sont aussi.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

import httpx
import structlog

from config import config
from modules.harvester import get_game_anchor
from services import league_config, livestats_api, lolesports_api
from services.observability import run_logged

log = structlog.get_logger()

R2_KEY = "data/kc_matches.json"
_HERE = os.path.dirname(os.path.abspath(__file__))
REPO_FALLBACK = os.path.join(_HERE, "..", "..", "web", "src", "data", "kc_matches.json")
STATE_PATH = os.path.join(_HERE, "..", "real_data_export_state.json")
MAX_PAGES_FULL = 40
RECHECK_DAYS = 30            # passe ordinaire : on relit le calendrier sur 30 jours
MAX_GAMES_PER_RUN = 25
MAX_ATTEMPTS = 3
FRAME_PROBES_MIN = (85, 70, 60, 50, 40, 30)


def _is_kc_name(name: str | None) -> bool:
    return (name or "").upper().startswith("KC ")


def _game_ok(g: dict) -> bool:
    return bool(g.get("kc_players")) and all(_is_kc_name(p.get("name")) for p in g["kc_players"])


def _expected_games(m: dict) -> int:
    return int(m.get("kc_score") or 0) + int(m.get("opp_score") or 0)


def _match_done(m: dict, state: dict) -> bool:
    ok = sum(1 for g in m.get("games") or [] if _game_ok(g))
    given_up = sum(1 for a in state["attempts"].values() if a.get("match") == m.get("id") and a.get("n", 0) >= MAX_ATTEMPTS)
    return ok + given_up >= _expected_games(m)


# ─── persistance ──────────────────────────────────────────────────────

def _load_previous() -> tuple[dict, bool]:
    """(fichier précédent, publié sur R2 ?)."""
    if config.R2_PUBLIC_URL:
        try:
            r = httpx.get(f"{config.R2_PUBLIC_URL.rstrip('/')}/{R2_KEY}",
                          params={"t": int(datetime.now().timestamp())}, timeout=30)
            if r.status_code == 200:
                return r.json(), True
        except Exception as e:
            log.warn("real_data_prev_fetch_failed", error=str(e)[:120])
    try:
        with open(REPO_FALLBACK, encoding="utf-8") as f:
            return json.load(f), False
    except Exception:
        return {"matches": []}, False


def _load_state() -> dict:
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            s = json.load(f)
        s.setdefault("attempts", {})
        return s
    except Exception:
        return {"attempts": {}}


def _save_state(state: dict) -> None:
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)


# ─── lecture d'une game ───────────────────────────────────────────────

async def _final_frame(game_id: str) -> tuple[dict | None, dict | None]:
    """(métadonnées des joueurs, dernière frame) d'une game terminée.

    Après la fin de partie, le feed ressert ses dernières frames : la
    première sonde (+85 min) suffit le plus souvent.
    """
    got = await get_game_anchor(game_id)
    if not got:
        return None, None
    anchor, anchor_data = got
    meta = (anchor_data or {}).get("gameMetadata") or {}
    best = None
    for minutes in FRAME_PROBES_MIN:
        ts = (anchor + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        w = await livestats_api.get_window(game_id, ts)
        frames = (w or {}).get("frames") or []
        if not frames:
            continue
        last = frames[-1]
        if last.get("gameState") == "finished":
            return meta, last
        kills = sum(int((last.get(s) or {}).get("totalKills") or 0) for s in ("blueTeam", "redTeam"))
        if best is None or kills > best[0]:
            best = (kills, last)
    return meta, (best[1] if best else None)


def build_game(game: dict, meta: dict, last: dict) -> dict | None:
    """Une game au format de kc_matches.json. None si le camp KC est introuvable."""
    pm = {}
    for side_meta, side in ((meta.get("blueTeamMetadata") or {}, "blue"), (meta.get("redTeamMetadata") or {}, "red")):
        for p in side_meta.get("participantMetadata") or []:
            pm[p.get("participantId")] = {
                "name": p.get("summonerName") or "?",
                "champion": p.get("championId") or "?",
                "role": p.get("role") or "",
                "side": side,
            }
    kc_sides = {v["side"] for v in pm.values() if _is_kc_name(v["name"])}
    if len(kc_sides) != 1:
        return None
    kc_side = kc_sides.pop()
    kc_players, opp_players = [], []
    for side_key, side in (("blueTeam", "blue"), ("redTeam", "red")):
        for p in (last.get(side_key) or {}).get("participants") or []:
            meta_p = pm.get(p.get("participantId"), {})
            row = {
                "name": meta_p.get("name", "?"),
                "champion": meta_p.get("champion", "?"),
                "role": meta_p.get("role", ""),
                "kills": p.get("kills", 0),
                "deaths": p.get("deaths", 0),
                "assists": p.get("assists", 0),
                "gold": p.get("totalGold", 0),
                "cs": p.get("creepScore", 0),
                "level": p.get("level", 1),
            }
            (kc_players if side == kc_side else opp_players).append(row)
    if not kc_players:
        return None
    team = last.get("blueTeam" if kc_side == "blue" else "redTeam") or {}
    return {
        "id": game.get("id"),
        "number": game.get("number"),
        "kc_side": kc_side,
        "kc_players": kc_players,
        "opp_players": opp_players,
        "kc_kills": sum(p["kills"] for p in kc_players),
        "opp_kills": sum(p["kills"] for p in opp_players),
        "kc_gold": team.get("totalGold", 0),
        "kc_towers": team.get("towers", 0),
        "kc_dragons": len(team.get("dragons") or []),
        "kc_barons": team.get("barons", 0),
        "vods": [{"provider": v.get("provider"), "parameter": v.get("parameter"), "locale": v.get("locale")}
                 for v in game.get("vods") or []],
    }


# ─── séries ───────────────────────────────────────────────────────────

def match_meta(event: dict) -> dict | None:
    """Champs de la série tirés d'un événement getSchedule (sans les games)."""
    match = event.get("match") or {}
    teams = match.get("teams") or []
    if len(teams) != 2:
        return None
    kc_team = next((t for t in teams if lolesports_api.is_kc(t)), None)
    if kc_team is None:
        return None
    opp_team = teams[1] if teams[0] is kc_team else teams[0]
    kc_res, opp_res = kc_team.get("result") or {}, opp_team.get("result") or {}
    return {
        "id": match.get("id"),
        "date": event.get("startTime"),
        "league": (event.get("league") or {}).get("name") or "LEC",
        "stage": event.get("blockName") or "",
        "kc_side": "blue" if teams[0] is kc_team else "red",
        "opponent": {"name": opp_team.get("name"), "code": opp_team.get("code"), "image": opp_team.get("image")},
        "kc_image": kc_team.get("image"),
        "kc_won": kc_res.get("outcome") == "win",
        "kc_score": kc_res.get("gameWins", 0),
        "opp_score": opp_res.get("gameWins", 0),
        "best_of": (match.get("strategy") or {}).get("count", 1),
    }


async def _fill_games(m: dict, state: dict, budget: int) -> tuple[int, bool]:
    """Complète les games d'une série. (lectures du feed consommées, série modifiée ?)."""
    detail = await lolesports_api.get_event_details(m["id"]) or {}
    api_games = [g for g in (detail.get("match") or {}).get("games") or [] if g.get("state") == "completed"]
    kept = {g["id"]: g for g in m.get("games") or [] if _game_ok(g)}
    games, used, changed = [], 0, False
    for game in api_games:
        gid = game.get("id")
        if gid in kept:
            games.append(kept[gid])
            continue
        att = state["attempts"].get(gid, {})
        if att.get("n", 0) >= MAX_ATTEMPTS or used >= budget:
            continue
        used += 1
        meta, last = await _final_frame(gid)
        g = build_game(game, meta or {}, last) if last else None
        if g:
            games.append(g)
            state["attempts"].pop(gid, None)
            changed = True
            log.info("real_data_game_filled", match_id=m["id"], game=game.get("number"), kc_side=g["kc_side"])
        else:
            state["attempts"][gid] = {"n": att.get("n", 0) + 1, "match": m["id"]}
            log.warn("real_data_game_no_stats", match_id=m["id"], game=game.get("number"),
                     attempt=state["attempts"][gid]["n"])
    # une game mal attribuée et non relue reste en place plutôt que de disparaître
    for g in m.get("games") or []:
        if g.get("id") not in {x.get("id") for x in games} and not _game_ok(g):
            games.append(g)
    if len(games) != len(m.get("games") or []) or changed:
        changed = True
    games.sort(key=lambda g: g.get("number") or 0)
    m["games"] = games
    return used, changed


async def _scan_schedule(league_id: str, full: bool, newest_known: str | None) -> list[dict]:
    """Séries KC terminées d'une ligue, les plus récentes d'abord."""
    cutoff = None
    if not full and newest_known:
        dt = datetime.fromisoformat(newest_known.replace("Z", "+00:00")) - timedelta(days=RECHECK_DAYS)
        cutoff = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    out, token = [], None
    for _ in range(MAX_PAGES_FULL):
        page, older = await lolesports_api.get_schedule(league_id, token)
        for ev in page:
            if ev.get("type") == "match" and ev.get("state") == "completed":
                meta = match_meta(ev)
                if meta and meta["id"]:
                    out.append(meta)
        if cutoff and page and min((ev.get("startTime") or "9999") for ev in page) < cutoff:
            break
        if not older:
            break
        token = older
    return out


@run_logged()
async def run(full: bool = False) -> int:
    prev, published = _load_previous()
    full = full or not published           # premier export : tout le calendrier
    state = _load_state()
    by_id = {m["id"]: m for m in prev.get("matches") or [] if m.get("id")}
    changed = 0

    for league in league_config.load_tracked_leagues():
        lid = getattr(league, "lolesports_league_id", None)
        if not lid:
            continue
        name = (league.short_name or "").lower()
        known = [m["date"] for m in by_id.values() if (m.get("league") or "").lower() == name and m.get("date")]
        for meta in await _scan_schedule(lid, full, max(known) if known else None):
            old = by_id.get(meta["id"])
            if old is None:
                by_id[meta["id"]] = {**meta, "games": []}
                changed += 1
            elif any(old.get(k) != v for k, v in meta.items()):
                old.update(meta)
                changed += 1

    budget = MAX_GAMES_PER_RUN
    todo = sorted((m for m in by_id.values() if not _match_done(m, state)),
                  key=lambda m: m.get("date") or "", reverse=True)
    for m in todo:
        if budget <= 0:
            break
        used, did = await _fill_games(m, state, budget)
        budget -= used
        changed += int(did)
    _save_state(state)

    pending = sum(1 for m in by_id.values() if not _match_done(m, state))
    if not changed:
        log.info("real_data_unchanged", matches=len(by_id), pending=pending)
        return 0

    matches = sorted(by_id.values(), key=lambda m: m.get("date") or "", reverse=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "LoL Esports API (worker real_data_export)",
        "team": "Karmine Corp",
        "total_matches": len(matches),
        "total_games": sum(len(m["games"]) for m in matches),
        "matches": matches,
    }
    from services import r2_client

    fd, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        url = await r2_client.upload(path, R2_KEY, content_type="application/json; charset=utf-8",
                                     cache_control="public, max-age=300")
    finally:
        os.remove(path)
    log.info("real_data_published", url=url, matches=len(matches), games=payload["total_games"],
             changed=changed, pending=pending)
    return changed


if __name__ == "__main__":
    import asyncio
    import sys

    asyncio.run(run(full="--full" in sys.argv))
