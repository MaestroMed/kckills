"""Backfill games.vod_youtube_id + vod_offset_seconds from Leaguepedia.

Root cause the recon found: the gol.gg backfill never writes a VOD to its
games, and the transitioner gates the whole clip pipeline on
`games.vod_youtube_id IS NOT NULL` (transitioner.py:111). So 79/80 target
games are stuck at status='raw' forever. Fill the VOD -> the pipeline flows
on its own (no pipeline code change; nothing discriminates by data_source).

Source: Leaguepedia Cargo table MatchScheduleGame.VodGameStart, a URL of the
form `youtu.be/<id>?t=<seconds>` = the EXACT game start in the broadcast VOD.
Verified by recon: 100% coverage of the 80 target games. Per-kill clip start
= vod_offset_seconds + kill.game_time_seconds.

Mapping (DB game <- Leaguepedia game): group both sides by KC's opponent,
then align chronologically within each opponent group (our games sorted by
gol.gg id, LP games sorted by MatchId+N_GameInMatch). Robust to KC playing the
same opponent twice in a split. game_number vs N_GameInMatch is a sanity check.

Leaguepedia rate-limits HARD (mediawiki-api-error: ratelimited) -> exponential
backoff + one query per tournament + inter-query delay.

Usage:
  python scripts/backfill_vods_leaguepedia.py --dry-run
  python scripts/backfill_vods_leaguepedia.py                      # apply
  python scripts/backfill_vods_leaguepedia.py --tournament "MSI 2026"
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_WORKER_ROOT))

# ── env / Supabase ───────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(_WORKER_ROOT / ".env")
except Exception:
    pass

SB_URL = (os.environ.get("SUPABASE_URL")
          or "https://guasqaistzpeapxoyxrc.supabase.co").rstrip("/")
SB_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
          or os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
if not SB_KEY:
    print("FATAL: no SUPABASE_SERVICE_ROLE_KEY in env/.env", file=sys.stderr)
    sys.exit(1)
SB_H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}

LP_UA = "kckills-data-retrieval/1.0 (meehdi.n@gmail.com)"

# ── targets: our tournaments.name -> Leaguepedia OverviewPage ─────────
TARGETS = [
    ("LFL Summer 2023",                  "LFL/2023 Season/Summer Season",                 18),
    ("LEC 2026 Spring Season",           "LEC/2026 Season/Spring Season",                 23),
    ("LEC 2026 Spring Playoffs",         "LEC/2026 Season/Spring Playoffs",               19),
    ("MSI 2026",                         "2026 Mid-Season Invitational",                   9),
    ("EWC 2026 Online Qualifier - EMEA", "Esports World Cup 2026/Online Qualifiers/EMEA",  11),
    # ── Full-history extension (2026-07-10) — pages confirmed by a KC
    # OverviewPage discovery scan where possible; LFL pages follow the
    # "LFL/{year} Season/{Split} {Phase}" pattern verified on 2023 Summer.
    # A page that 404s just skips its tournament (cheap).
    ("LFL Spring 2021",                  "LFL/2021 Season/Spring Season",                  0),
    ("LFL Spring Playoffs 2021",         "LFL/2021 Season/Spring Playoffs",                0),
    ("LFL Summer 2021",                  "LFL/2021 Season/Summer Season",                  0),
    ("LFL Summer Playoffs 2021",         "LFL/2021 Season/Summer Playoffs",                0),
    ("LFL Finals 2021",                  "LFL/2021 Season/Finals",                         0),
    ("EU Masters Spring 2021",           "European Masters/2021 Season/Spring Main Event", 0),
    ("EU Masters Summer 2021",           "European Masters/2021 Season/Summer Main Event", 0),
    ("LFL Spring 2022",                  "LFL/2022 Season/Spring Season",                  0),
    ("LFL Spring Playoffs 2022",         "LFL/2022 Season/Spring Playoffs",                0),
    ("LFL Summer 2022",                  "LFL/2022 Season/Summer Season",                  0),
    ("LFL Summer Playoffs 2022",         "LFL/2022 Season/Summer Playoffs",                0),
    ("EU Masters Spring 2022",           "European Masters/2022 Season/Spring Main Event", 0),
    ("EU Masters Spring Play-In 2022",   "European Masters/2022 Season/Spring Play-In",    0),
    ("LFL Spring 2023",                  "LFL/2023 Season/Spring Season",                  0),
    ("LFL Summer Playoffs 2023",         "LFL/2023 Season/Summer Playoffs",                0),
    ("EMEA Masters Summer 2023",         "EMEA Masters/2023 Season/Summer Main Event",     0),
    ("LEC Winter Season 2024",           "LEC/2024 Season/Winter Season",                  0),
    ("LEC Spring Season 2024",           "LEC/2024 Season/Spring Season",                  0),
    ("LEC Summer Season 2024",           "LEC/2024 Season/Summer Season",                  0),
    ("LEC Summer Playoffs 2024",         "LEC/2024 Season/Summer Playoffs",                0),
    ("LEC Season Finals 2024",           "LEC/2024 Season/Season Finals",                  0),
    # DB row is uppercase "LEC WINTER 2025" (unlike its KC_TOURNAMENTS label)
    ("LEC WINTER 2025",                  "LEC/2025 Season/Winter Season",                  0),
    ("LEC 2025 Winter Playoffs",         "LEC/2025 Season/Winter Playoffs",                0),
    ("LEC 2025 Spring Season",           "LEC/2025 Season/Spring Season",                  0),
    ("LEC 2025 Spring Playoffs",         "LEC/2025 Season/Spring Playoffs",                0),
    ("LEC 2025 Summer Season",           "LEC/2025 Season/Summer Season",                  0),
    ("LEC 2025 Summer Playoffs",         "LEC/2025 Season/Summer Playoffs",                0),
    ("First Stand 2025",                 "2025 First Stand",                               0),
    ("LEC 2026 Versus Season",           "LEC/2026 Season/Versus Season",                  0),
    ("LEC 2026 Versus Playoffs",         "LEC/2026 Season/Versus Playoffs",                0),
]


# ── Supabase REST helpers ────────────────────────────────────────────
def sb_get(path: str) -> list[dict]:
    r = requests.get(f"{SB_URL}/rest/v1/{path}", headers=SB_H, timeout=40)
    r.raise_for_status()
    return r.json()


def sb_patch(path: str, body: dict) -> None:
    r = requests.patch(
        f"{SB_URL}/rest/v1/{path}",
        headers={**SB_H, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=body, timeout=40,
    )
    r.raise_for_status()


def _in(vals) -> str:
    return "(" + ",".join(str(v) for v in vals) + ")"


# ── Leaguepedia response cache (iterate on mapping w/o re-hitting the
#    rate-limited API — one good pass populates it, then it's instant) ─
_LP_CACHE_PATH = _WORKER_ROOT / ".lp_cache.json"
try:
    _LP_CACHE: dict = json.loads(_LP_CACHE_PATH.read_text(encoding="utf-8"))
except Exception:
    _LP_CACHE = {}


def _lpg(row: dict, name: str):
    """Cargo returns field names with SPACES where the query used underscores
    (e.g. 'N GameInMatch' not 'N_GameInMatch'). Try both forms."""
    for k in (name, name.replace("_", " "), name.replace(" ", "_")):
        if k in row:
            return row[k]
    return None


# ── Leaguepedia Cargo (rate-limit aware) ─────────────────────────────
def lp_query(tables: str, fields: str, where: str, limit: int = 300,
             retries: int = 12, join_on: str | None = None) -> list[dict]:
    ckey = f"{tables}||{fields}||{where}||{limit}||{join_on}"
    if ckey in _LP_CACHE:
        print("    lp cache hit", flush=True)
        return _LP_CACHE[ckey]
    for attempt in range(retries):
        try:
            params = {"action": "cargoquery", "format": "json",
                      "tables": tables, "fields": fields, "where": where,
                      "limit": str(limit)}
            if join_on:
                params["join on"] = join_on
            r = requests.get(
                "https://lol.fandom.com/api.php",
                params=params,
                headers={"User-Agent": LP_UA}, timeout=60,
            )
        except requests.RequestException as e:
            wait = min(300, 15 * (2 ** attempt))
            print(f"    lp network err ({e}); wait {wait}s", flush=True)
            time.sleep(wait)
            continue
        ratelimited = (r.headers.get("mediawiki-api-error") == "ratelimited"
                       or ("ratelimit" in r.text.lower() and '"error"' in r.text))
        if ratelimited:
            # Cap at 5 min: long enough to let the anon token bucket refill
            # without hammering (each hit keeps the window hot).
            wait = min(300, 20 * (2 ** attempt))
            print(f"    lp ratelimited; backoff {wait}s (try {attempt + 1}/{retries})", flush=True)
            time.sleep(wait)
            continue
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"leaguepedia error: {data['error']}")
        rows = [row["title"] for row in data.get("cargoquery", [])]
        _LP_CACHE[ckey] = rows
        try:
            _LP_CACHE_PATH.write_text(json.dumps(_LP_CACHE), encoding="utf-8")
        except Exception:
            pass
        return rows
    raise RuntimeError("leaguepedia: retries exhausted (still ratelimited)")


# ── parsing / normalisation ──────────────────────────────────────────
def parse_vod_gamestart(vgs: str | None):
    """youtu.be/ID?t=SEC | youtube.com/live/ID?t=SEC | watch?v=ID&t=SEC -> (id, offset)."""
    if not vgs:
        return None
    s = html.unescape(vgs).strip()
    m = re.search(r"(?:youtu\.be/|/live/|[?&]v=)([A-Za-z0-9_-]{11})", s)
    if not m:
        return None
    yid = m.group(1)
    tm = re.search(r"[?&]t=(\d+)", s)
    off = int(tm.group(1)) if tm else 0
    return yid, off


def norm_team(name: str | None) -> str:
    if not name:
        return ""
    n = name.lower()
    for junk in ("esports", "e-sports", "gaming", "academy", "team"):
        n = n.replace(junk, "")
    return re.sub(r"[^a-z0-9]", "", n)


def is_kc(norm: str) -> bool:
    return norm.startswith("karminecorp") or norm in ("kc", "kcorp", "kcb")


def golgg_num(external_id: str) -> int:
    m = re.search(r"(\d+)", external_id or "")
    return int(m.group(1)) if m else 0


def _natkey(s: str):
    """Natural sort key so MatchId '..._10' sorts after '..._2'."""
    return [int(x) if x.isdigit() else x for x in re.findall(r"\d+|\D+", s or "")]


def _match_opp(opp: str, lp_by_opp: dict) -> list:
    """Find the LP opponent bucket for our normalized opp name. Exact, else
    prefix either direction (min 4 chars) — handles Vitality.Bee vs vitality,
    'Karmine Corp Blue' academy naming, etc."""
    if opp in lp_by_opp:
        return lp_by_opp[opp]
    if len(opp) >= 4:
        for k, v in lp_by_opp.items():
            if len(k) >= 4 and (k.startswith(opp) or opp.startswith(k)):
                return v
    return []


# ── main ─────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--tournament", help="filtre exact sur le nom de tournoi cible")
    ap.add_argument("--delay", type=float, default=12.0, help="délai entre tournois (s)")
    ap.add_argument("--force", action="store_true",
                    help="réécrit le VOD même si déjà posé (pour re-mapper)")
    ap.add_argument("--allow-vod-only", action="store_true",
                    help="accepte le champ Vod sans VodGameStart (offset "
                         "calibré ensuite par vod_offset_finder)")
    args = ap.parse_args()

    targets = [t for t in TARGETS if not args.tournament or t[0] == args.tournament]
    if not targets:
        print(f"aucun tournoi cible ne matche {args.tournament!r}")
        print("cibles connues:", [t[0] for t in TARGETS])
        return

    teams = {t["id"]: t for t in sb_get("teams?select=id,name,code,slug")}
    kc_team_ids = {tid for tid, t in teams.items()
                   if (t.get("code") or "").upper() == "KC" or is_kc(norm_team(t.get("name")))}
    tour_rows = sb_get("tournaments?select=id,name")
    ids_by_name: dict[str, list[str]] = defaultdict(list)
    for t in tour_rows:
        ids_by_name[t["name"]].append(t["id"])

    print(f"KC team ids: {len(kc_team_ids)} | mode: {'DRY-RUN' if args.dry_run else 'APPLY'}\n")
    grand = {"matched": 0, "set": 0, "already": 0, "unmatched": 0, "novod": 0}

    for i, (name, overview, expected) in enumerate(targets):
        print(f"━━ {name}  (Leaguepedia: {overview}) ━━")
        tids = ids_by_name.get(name, [])
        if not tids:
            print(f"  ⚠ aucun tournament_id en base pour {name!r} — skip\n")
            continue

        matches = sb_get(f"matches?tournament_id=in.{_in(tids)}"
                         f"&select=id,team_blue_id,team_red_id,scheduled_at")
        if not matches:
            print("  ⚠ aucun match en base — skip\n")
            continue
        m_by_id = {m["id"]: m for m in matches}
        games = sb_get(f"games?match_id=in.{_in(m_by_id)}&data_source=eq.gol_gg"
                       f"&select=id,external_id,game_number,duration_seconds,vod_youtube_id,match_id")
        print(f"  DB: {len(matches)} matches, {len(games)} games (attendu ~{expected})")

        # our games -> opponent group
        ours_by_opp: dict[str, list[dict]] = defaultdict(list)
        for g in games:
            m = m_by_id.get(g["match_id"]) or {}
            tb, tr = m.get("team_blue_id"), m.get("team_red_id")
            opp_id = tr if tb in kc_team_ids else tb
            opp = teams.get(opp_id, {})
            g["_opp"] = norm_team(opp.get("name")) or norm_team(opp.get("code"))
            g["_num"] = golgg_num(g["external_id"])
            ours_by_opp[g["_opp"]].append(g)

        # leaguepedia rows
        if i > 0:
            time.sleep(args.delay)
        try:
            # Join MatchSchedule for the match DateTime: MatchId sorts
            # ALPHABETICALLY ('Finals' < 'Round 1') which inverted the two G2
            # playoff series. DateTime_UTC exists on MatchSchedule (asking for
            # it on MatchScheduleGame is what threw MWException before).
            rows = lp_query(
                "MatchScheduleGame=MSG,MatchSchedule=MS",
                "MSG.Blue,MSG.Red,MSG.VodGameStart,MSG.Vod,MSG.MatchId,MS.DateTime_UTC",
                f'MSG.OverviewPage="{overview}" AND (MSG.Blue LIKE "Karmine%" OR MSG.Red LIKE "Karmine%")',
                join_on="MSG.MatchId=MS.MatchId",
            )
        except Exception as e:
            print(f"  ⚠ Leaguepedia KO: {e}\n")
            continue
        lp_by_opp: dict[str, list[dict]] = defaultdict(list)
        lp_novod = 0
        for row in rows:
            blue, red = _lpg(row, "Blue"), _lpg(row, "Red")
            opp = red if is_kc(norm_team(blue)) else blue
            parsed = parse_vod_gamestart(_lpg(row, "VodGameStart"))
            if not parsed and args.allow_vod_only:
                # Fallback: general per-game Vod without a game-start offset.
                # We store vod_youtube_id with offset NULL; the daemon's
                # vod_offset_finder (games WHERE offset IS NULL) calibrates
                # it by reading the in-game timer, and the QC gates keep any
                # miscalibrated clip from publishing.
                v = parse_vod_gamestart(_lpg(row, "Vod"))
                if v:
                    parsed = (v[0], None)
            if not parsed:
                # Keep as a positional HOLE: dropping it shifts every later
                # game of that opponent onto the wrong VOD (LFL bo1 pairs).
                lp_novod += 1
                parsed = (None, None)
            lp_by_opp[norm_team(opp)].append({
                "opp": norm_team(opp),
                "matchid": str(_lpg(row, "MatchId") or ""),
                "dt": str(_lpg(row, "DateTime_UTC") or ""),
                "yid": parsed[0], "off": parsed[1],
            })
        print(f"  Leaguepedia: {len(rows)} games KC, {lp_novod} sans VodGameStart")

        # Align per opponent, chronological on BOTH sides: ours by gol.gg id
        # (monotonic in real time), LP by (match DateTime, offset-in-VOD).
        # Holes (no VodGameStart) sort last within their match.
        updates = []  # (game, yid, off, warn)
        for opp, our_list in ours_by_opp.items():
            lp_list = _match_opp(opp, lp_by_opp)
            our_sorted = sorted(our_list, key=lambda g: g["_num"])
            lp_sorted = sorted(lp_list, key=lambda r: (
                r["dt"], _natkey(r["matchid"]),
                r["off"] is None, r["off"] if r["off"] is not None else 0))
            if not lp_sorted:
                for g in our_sorted:
                    updates.append((g, None, None, f"opp {opp!r} absent Leaguepedia"))
                continue
            if len(our_sorted) != len(lp_sorted):
                print(f"    ⚠ opp {opp!r}: {len(our_sorted)} DB vs {len(lp_sorted)} LP (align best-effort)")
            for idx, g in enumerate(our_sorted):
                if idx < len(lp_sorted):
                    lp = lp_sorted[idx]
                    if lp["yid"] is None:
                        updates.append((g, None, None, "LP sans VodGameStart"))
                    else:
                        updates.append((g, lp["yid"], lp["off"], ""))
                else:
                    updates.append((g, None, None, f"pas de LP pour idx {idx}"))

        # apply
        for g, yid, off, warn in sorted(updates, key=lambda u: u[0]["_num"]):
            tag = f"  [{warn}]" if warn else ""
            if yid is None:
                grand["unmatched"] += 1
                print(f"    ✗ {g['external_id']} g{g['game_number']} opp={g['_opp']!r} → NON MAPPÉ{tag}")
                # A previous (buggier) run may have written a wrong VOD here;
                # within the 5 target tournaments every VOD came from us, so
                # clearing on --force is safe and prevents bad clips.
                if not args.dry_run and args.force and g.get("vod_youtube_id"):
                    sb_patch(f"games?id=eq.{g['id']}",
                             {"vod_youtube_id": None, "vod_offset_seconds": None})
                    print(f"      (ancien VOD {g['vod_youtube_id']} effacé)")
                continue
            grand["matched"] += 1
            if g.get("vod_youtube_id") and not args.force:
                grand["already"] += 1
                continue
            offtxt = f"@ {off}s" if off is not None else "@ offset:auto"
            print(f"    ✓ {g['external_id']} g{g['game_number']} opp={g['_opp']!r} → {yid} {offtxt}{tag}")
            if not args.dry_run:
                body = {"vod_youtube_id": yid}
                if off is not None:
                    body["vod_offset_seconds"] = off
                sb_patch(f"games?id=eq.{g['id']}", body)
                grand["set"] += 1
        print()

    print("━━━━━━ BILAN ━━━━━━")
    print(f"  mappés     : {grand['matched']}")
    print(f"  déjà VOD   : {grand['already']}")
    print(f"  écrits     : {grand['set']}{'  (dry-run: 0)' if args.dry_run else ''}")
    print(f"  non mappés : {grand['unmatched']}")


if __name__ == "__main__":
    main()
