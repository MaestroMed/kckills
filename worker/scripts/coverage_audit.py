# -*- coding: utf-8 -*-
"""
COVERAGE_AUDIT — tous les matchs KC sont-ils dans la base, avec leurs clips ?

Référence : Leaguepedia (Cargo, table ScoreboardGames) — chaque game où
« Karmine Corp » est Team1 ou Team2, 2021 → aujourd'hui. Comparaison par
JOUR : nombre de games attendues vs games en base ayant au moins un clip
visible (les doublons gol.gg/feed sont neutralisés au niveau des kills,
donc « games avec clip visible » compte des games uniques).

Lecture seule. Rapport par tournoi + liste des jours manquants.

Usage : python scripts/coverage_audit.py [--json out.json]
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env")
from services.supabase_client import get_db  # noqa: E402

CARGO = "https://lol.fandom.com/api.php"
UA = {"User-Agent": "KCKills-coverage-audit/1.0 (fan site; contact via kckills.com)"}


def leaguepedia_games() -> list[dict]:
    out, offset = [], 0
    while True:
        params = {
            "action": "cargoquery",
            "format": "json",
            "tables": "ScoreboardGames",
            "fields": "ScoreboardGames.GameId=gid,ScoreboardGames.DateTime_UTC=dt,ScoreboardGames.Tournament=tn,"
            "ScoreboardGames.Team1=t1,ScoreboardGames.Team2=t2,ScoreboardGames.Team1Kills=k1,ScoreboardGames.Team2Kills=k2",
            "where": 'ScoreboardGames.Team1="Karmine Corp" OR ScoreboardGames.Team2="Karmine Corp"',
            "order_by": "ScoreboardGames.DateTime_UTC",
            "limit": "500",
            "offset": str(offset),
        }
        data: dict = {}
        for _attempt in range(14):
            r = httpx.get(CARGO, params=params, headers=UA, timeout=60)
            data = r.json()
            if "cargoquery" in data:
                break
            time.sleep(75)  # limite de débit Leaguepedia (anonyme) : on attend qu'elle retombe
        if "cargoquery" not in data:
            raise SystemExit(f"Leaguepedia indisponible : {str(data)[:200]}")
        rows = [x["title"] for x in data.get("cargoquery", [])]
        out += rows
        if len(rows) < 500:
            return out
        offset += 500
        time.sleep(3)


def db_games_with_clips() -> dict[str, int]:
    """Par jour (UTC) : nombre de games distinctes ayant ≥ 1 clip visible."""
    db = get_db()
    client = db._get_client()
    per_day: dict[str, set[str]] = collections.defaultdict(set)
    off = 0
    while True:
        rows = client.get(f"{db.base}/kills", params=[
            ("select", "game_id,games!inner(matches!inner(scheduled_at))"),
            ("or", "(publication_status.eq.published,and(publication_status.is.null,status.eq.published))"),
            ("kill_visible", "eq.true"), ("clip_url_vertical", "not.is.null"),
            ("offset", str(off)), ("limit", "1000")]).json()
        for k in rows:
            d = (k["games"]["matches"]["scheduled_at"] or "")[:10]
            if d:
                per_day[d].add(k["game_id"])
        if len(rows) < 1000:
            break
        off += 1000
    return {d: len(s) for d, s in per_day.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    args = ap.parse_args()
    lp = leaguepedia_games()
    have = db_games_with_clips()
    by_tn: dict[str, dict] = collections.OrderedDict()
    exp_day: dict[str, int] = collections.Counter()
    tn_of_day: dict[str, str] = {}
    for g in lp:
        d = (g.get("dt") or "")[:10]
        exp_day[d] += 1
        tn_of_day[d] = g.get("tn") or "?"
    for d in sorted(exp_day):
        tn = tn_of_day[d]
        e = by_tn.setdefault(tn, {"expected": 0, "covered": 0, "missing_days": []})
        # tolérance d'un jour (gol.gg date parfois la veille/le lendemain en UTC)
        got = have.get(d, 0) or 0
        near = max(got, min(exp_day[d], have.get(_shift(d, -1), 0)), min(exp_day[d], have.get(_shift(d, 1), 0)))
        cov = min(exp_day[d], near)
        e["expected"] += exp_day[d]
        e["covered"] += cov
        if cov < exp_day[d]:
            e["missing_days"].append(f"{d} ({cov}/{exp_day[d]})")
    tot_e = sum(v["expected"] for v in by_tn.values())
    tot_c = sum(v["covered"] for v in by_tn.values())
    print(f"Leaguepedia : {len(lp)} games KC | couvertes avec clips : {tot_c}/{tot_e}")
    for tn, v in by_tn.items():
        flag = "OK " if v["covered"] == v["expected"] else "!! "
        print(f"{flag}{tn:48} {v['covered']:>3}/{v['expected']:<3} {' '.join(v['missing_days'][:6])}")
    if args.json:
        Path(args.json).write_text(json.dumps(by_tn, ensure_ascii=False, indent=1), encoding="utf-8")


def _shift(d: str, days: int) -> str:
    from datetime import date, timedelta

    return (date.fromisoformat(d) + timedelta(days=days)).isoformat()


if __name__ == "__main__":
    main()
