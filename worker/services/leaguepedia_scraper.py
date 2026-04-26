"""
leaguepedia_scraper.py — Fallback historical match data via Leaguepedia.

Why fallback ?
--------------
gol.gg has the cleanest per-kill timeline data we found, but coverage
gaps exist :
  * Older seasons of regional leagues (LCK 2014-2017, CBLOL early years)
  * Some Tier-2 EU Masters and academy leagues
  * Worlds qualifiers / play-ins for certain years

Leaguepedia (lol.fandom.com) hosts a richly-tagged MediaWiki Cargo
database that covers virtually every pro game ever played, going back
to 2011. The granularity is lower than gol.gg :

  * No per-kill timeline (just final K/D/A per player per game)
  * No multi-kill flags, no first-blood flag
  * No per-event timestamps

But it's enough to populate matches + games + per-player KDA totals so
the rest of the pipeline (ratings, comments, search) has something to
work with. When gol.gg also has the game, gol.gg wins (it's loaded
first). When gol.gg doesn't have it, leaguepedia gives at least metadata.

Cargo API basics
----------------
The endpoint is :
    https://lol.fandom.com/wiki/Special:CargoExport
with format=json. Tables we use :

  * ScoreboardGames (SG)  — per-game header (date, teams, winner, patch)
  * ScoreboardPlayers (SP) — per-player line in a game (KDA, champion)
  * MatchSchedule          — match grouping (BO format, tournament)
  * Tournaments            — tournament metadata + dates

Rate limit : Leaguepedia is friendly to crawlers, but Cargo queries are
DB-heavy. We cap at 1 req/sec by default and ALWAYS use `limit=` to
keep payloads bounded.

Usage
-----
    from services.leaguepedia_scraper import LeaguepediaScraper

    scraper = LeaguepediaScraper()
    matches = scraper.query_team_matches("Karmine Corp", year=2026)
    for m in matches:
        kills = scraper.synthesise_kills_for_game(m["game_id"])
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Optional

import structlog

log = structlog.get_logger()


CARGO_BASE = "https://lol.fandom.com/wiki/Special:CargoExport"
DEFAULT_UA = (
    "LolTok-Backfill/1.0 (+https://kckills.com/about; backfill@kckills.com)"
)
DEFAULT_MIN_DELAY = 1.0  # ≥ 1 req/s


@dataclass
class LeaguepediaMatch:
    """One match (BO1/BO3/BO5) as represented in MatchSchedule."""
    match_id: str            # MatchSchedule.MatchId (string)
    tournament: str          # SG.OverviewPage / Tournament name
    date_utc: str            # ISO date "2024-01-21"
    team1: str               # team display name
    team2: str
    winner: Optional[str]    # team display name of winner (None if pending)
    best_of: Optional[int]   # 1 / 3 / 5
    n_games: int = 1         # number of games actually played


@dataclass
class LeaguepediaGame:
    """One game inside a match (often 1-1 with the match in BO1)."""
    game_id: str             # ScoreboardGames.GameId
    match_id: Optional[str]
    tournament: str
    date_utc: str
    team1: str
    team2: str
    winner: Optional[str]
    patch: Optional[str]
    duration_seconds: Optional[int]
    blue_side: Optional[str] = None    # team name on blue side (if known)
    red_side: Optional[str] = None


@dataclass
class LeaguepediaScoreboardLine:
    """One player's line in a single game's scoreboard."""
    name: str               # IGN
    champion: str
    kills: int
    deaths: int
    assists: int
    role: Optional[str]     # "Top", "Jungle", "Mid", "Bot", "Support"
    team: str
    side: Optional[str]     # "Blue" / "Red" / None


@dataclass
class LeaguepediaScraper:
    """Cargo-API client for Leaguepedia. Stateless — safe to share across
    threads but keeps a per-instance min-delay rate-limit."""

    min_delay_seconds: float = DEFAULT_MIN_DELAY
    user_agent: str = DEFAULT_UA
    http_get: Optional[callable] = None

    _last_request_at: float = field(default=0.0, repr=False)

    # ── HTTP plumbing ─────────────────────────────────────────────────

    def _wait(self) -> None:
        if self._last_request_at == 0.0:
            return
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.min_delay_seconds:
            time.sleep(self.min_delay_seconds - elapsed)

    def _fetch_json(self, params: dict[str, str]) -> list[dict]:
        """GET CARGO_BASE with params, return parsed JSON list. Honours
        rate limit. Returns [] on any error rather than raising — the
        caller treats fallback failures as a no-op."""
        self._wait()
        self._last_request_at = time.monotonic()

        # Allow tests to inject a stub (signature: (url) → str).
        url = f"{CARGO_BASE}?{urllib.parse.urlencode(params)}"
        if self.http_get is not None:
            try:
                body = self.http_get(url)
            except Exception as e:
                log.warn("leaguepedia_http_failed", url=url[:120], error=str(e)[:120])
                return []
        else:
            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": self.user_agent,
                        "Accept": "application/json",
                    },
                )
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read().decode("utf-8", errors="ignore")
            except Exception as e:
                log.warn("leaguepedia_urllib_failed", url=url[:120], error=str(e)[:120])
                return []

        try:
            data = json.loads(body)
            if isinstance(data, list):
                return data
            log.warn("leaguepedia_unexpected_response_shape", type=type(data).__name__)
            return []
        except Exception as e:
            log.warn("leaguepedia_json_parse_failed", error=str(e)[:120])
            return []

    # ── Public API ────────────────────────────────────────────────────

    def query_team_matches(
        self,
        team_name: str,
        year: int,
        limit: int = 200,
    ) -> list[LeaguepediaMatch]:
        """Return every match a team played in `year`. Uses the
        ScoreboardGames table because MatchSchedule sometimes lacks the
        BO grouping for older tournaments — going through SG and then
        deduping by (date, team1, team2) gives us the same data with
        less spotty coverage.

        team_name : Leaguepedia's canonical team name (e.g. "Karmine Corp").
        """
        # Escape any quotes the team name might contain.
        safe_name = team_name.replace('"', '\\"')
        where = (
            f'(SG.Team1="{safe_name}" OR SG.Team2="{safe_name}") '
            f'AND SG.DateTime_UTC >= "{year}-01-01" '
            f'AND SG.DateTime_UTC < "{year + 1}-01-01"'
        )
        rows = self._fetch_json({
            "tables": "ScoreboardGames=SG",
            "fields": (
                "SG.GameId, SG.MatchId, SG.OverviewPage, SG.DateTime_UTC, "
                "SG.Team1, SG.Team2, SG.Winner, SG.Gamelength, "
                "SG.Team1Score, SG.Team2Score, SG.Patch"
            ),
            "where": where,
            "order_by": "SG.DateTime_UTC ASC",
            "limit": str(limit),
            "format": "json",
        })

        # Group SG rows by MatchId (or fallback "date|team1|team2") to
        # produce one LeaguepediaMatch per series.
        grouped: dict[str, list[dict]] = {}
        for r in rows:
            match_id = r.get("MatchId") or (
                f"{r.get('DateTime UTC') or r.get('DateTime_UTC')}"
                f"|{r.get('Team1')}|{r.get('Team2')}"
            )
            grouped.setdefault(match_id, []).append(r)

        matches: list[LeaguepediaMatch] = []
        for mid, games in grouped.items():
            first = games[0]
            t1_score = self._safe_int(first.get("Team1Score"))
            t2_score = self._safe_int(first.get("Team2Score"))
            best_of: Optional[int] = None
            if t1_score is not None and t2_score is not None:
                # Best-of inferred from final scores (1+0, 2+1, 3+2, etc.)
                total = max(t1_score + t2_score, 1)
                best_of = total * 2 - 1  # 1→1, 2→3, 3→5
            matches.append(LeaguepediaMatch(
                match_id=str(mid),
                tournament=first.get("OverviewPage") or "",
                date_utc=self._coerce_date(
                    first.get("DateTime UTC") or first.get("DateTime_UTC")
                ),
                team1=first.get("Team1") or "",
                team2=first.get("Team2") or "",
                winner=first.get("Winner") or None,
                best_of=best_of,
                n_games=len(games),
            ))
        log.info("leaguepedia_team_matches",
                 team=team_name, year=year, matches=len(matches), games=len(rows))
        return matches

    def query_team_games(
        self,
        team_name: str,
        year: int,
        limit: int = 500,
    ) -> list[LeaguepediaGame]:
        """Return every game a team played in `year` as flat
        LeaguepediaGame rows. Use this when you want game-level (not
        match-level) granularity."""
        safe_name = team_name.replace('"', '\\"')
        where = (
            f'(SG.Team1="{safe_name}" OR SG.Team2="{safe_name}") '
            f'AND SG.DateTime_UTC >= "{year}-01-01" '
            f'AND SG.DateTime_UTC < "{year + 1}-01-01"'
        )
        rows = self._fetch_json({
            "tables": "ScoreboardGames=SG",
            "fields": (
                "SG.GameId, SG.MatchId, SG.OverviewPage, SG.DateTime_UTC, "
                "SG.Team1, SG.Team2, SG.Winner, SG.Gamelength, SG.Patch"
            ),
            "where": where,
            "order_by": "SG.DateTime_UTC ASC",
            "limit": str(limit),
            "format": "json",
        })
        out: list[LeaguepediaGame] = []
        for r in rows:
            duration_s = self._coerce_duration(r.get("Gamelength"))
            out.append(LeaguepediaGame(
                game_id=str(r.get("GameId") or ""),
                match_id=r.get("MatchId") or None,
                tournament=r.get("OverviewPage") or "",
                date_utc=self._coerce_date(
                    r.get("DateTime UTC") or r.get("DateTime_UTC")
                ),
                team1=r.get("Team1") or "",
                team2=r.get("Team2") or "",
                winner=r.get("Winner") or None,
                patch=r.get("Patch") or None,
                duration_seconds=duration_s,
            ))
        return out

    def query_game_scoreboard(self, game_id: str) -> list[LeaguepediaScoreboardLine]:
        """Per-player KDA for ONE game. ScoreboardPlayers is keyed by
        GameId (numeric)."""
        if not game_id:
            return []
        safe_gid = str(game_id).replace('"', '\\"')
        rows = self._fetch_json({
            "tables": "ScoreboardPlayers=SP",
            "fields": (
                "SP.Name, SP.Champion, SP.Kills, SP.Deaths, SP.Assists, "
                "SP.Role, SP.Team, SP.Side"
            ),
            "where": f'SP.GameId="{safe_gid}"',
            "limit": "20",
            "format": "json",
        })
        return [
            LeaguepediaScoreboardLine(
                name=r.get("Name") or "",
                champion=r.get("Champion") or "",
                kills=self._safe_int(r.get("Kills")) or 0,
                deaths=self._safe_int(r.get("Deaths")) or 0,
                assists=self._safe_int(r.get("Assists")) or 0,
                role=r.get("Role") or None,
                team=r.get("Team") or "",
                side=r.get("Side") or None,
            )
            for r in rows
        ]

    def synthesise_kills_for_game(
        self,
        game: LeaguepediaGame,
        scoreboard: Optional[list[LeaguepediaScoreboardLine]] = None,
    ) -> list[dict]:
        """Build placeholder kill rows from a game's scoreboard totals.

        We don't have per-kill timestamps from Leaguepedia, so we
        distribute the kills uniformly across the game duration. This
        gives the pipeline SOMETHING to clip and analyse, even if the
        timing is approximate.

        confidence='estimated' marks them as low-fidelity so the QC and
        UI layers can de-prioritise them.

        Returns a list of dicts in the same shape as
        GolggClient.scrape_team_kills().
        """
        if scoreboard is None:
            scoreboard = self.query_game_scoreboard(game.game_id)
        if not scoreboard:
            return []

        total_kills = sum(p.kills for p in scoreboard)
        if total_kills == 0:
            return []

        duration = game.duration_seconds or (28 * 60)  # 28 min average
        # Uniform spread, leaving 60s padding at start and end.
        usable = max(duration - 120, 60)
        step = usable / max(total_kills, 1)

        # Track teammates per side so we can pick a victim from the
        # opposing team. Champion is the only deterministic identifier.
        blue_champs = [p.champion for p in scoreboard if (p.side or "").lower().startswith("b")]
        red_champs = [p.champion for p in scoreboard if (p.side or "").lower().startswith("r")]

        out: list[dict] = []
        seq = 0
        for killer in scoreboard:
            killer_side = (killer.side or "").lower()
            opp_pool = red_champs if killer_side.startswith("b") else blue_champs
            if not opp_pool:
                # Side info missing from leaguepedia for this game — fall
                # back to "the team they aren't on" by team name.
                opp_pool = [p.champion for p in scoreboard if p.team and p.team != killer.team]
            if not opp_pool:
                continue

            for k_idx in range(killer.kills):
                victim_champ = opp_pool[k_idx % len(opp_pool)]
                t = int(60 + step * seq)
                out.append({
                    "external_id": f"lpedia_{game.game_id}_{seq}",
                    "game_id_external": f"lpedia_game_{game.game_id}",
                    "match_id_external": f"lpedia_match_{game.match_id or game.game_id}",
                    "game_time_seconds": t,
                    "killer_alias": killer.name,
                    "killer_champion": killer.champion,
                    "victim_alias": "",
                    "victim_champion": victim_champ,
                    "assist_champions": [],
                    "multi_kill": None,
                    "is_first_blood": seq == 0,
                    "tracked_team_involvement": None,  # caller fills in
                    "data_source": "leaguepedia",
                    "confidence": "estimated",
                    "patch": game.patch,
                    "duration_seconds": duration,
                    "tournament": game.tournament,
                    "blue_team_name": None,
                    "red_team_name": None,
                    "blue_won": None,
                    "red_won": None,
                    "date": game.date_utc,
                    "opponent_code": None,
                })
                seq += 1
        return out

    # ── small helpers ─────────────────────────────────────────────────

    @staticmethod
    def _safe_int(v: Any) -> Optional[int]:
        if v is None or v == "":
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _coerce_date(v: Any) -> str:
        """Leaguepedia returns dates as 'YYYY-MM-DD HH:MM:SS' or ISO. We
        only care about the date portion."""
        if not v:
            return ""
        s = str(v)
        # ISO8601 → split on T.
        if "T" in s:
            return s.split("T", 1)[0]
        # MediaWiki "YYYY-MM-DD HH:MM:SS" → split on space.
        if " " in s:
            return s.split(" ", 1)[0]
        return s

    @staticmethod
    def _coerce_duration(v: Any) -> Optional[int]:
        """Leaguepedia 'Gamelength' is a string like '32:14' or sometimes
        a raw int of seconds. Return seconds."""
        if v is None or v == "":
            return None
        s = str(v).strip()
        if ":" in s:
            try:
                parts = s.split(":")
                mm, ss = int(parts[0]), int(parts[1])
                return mm * 60 + ss
            except (ValueError, IndexError):
                return None
        try:
            return int(s)
        except (TypeError, ValueError):
            return None


# ── Module-level convenience ───────────────────────────────────────────

def query_team_matches(team_name: str, year: int) -> list[dict]:
    """One-shot wrapper. Returns dicts for callers that don't want to
    deal with the dataclass type."""
    s = LeaguepediaScraper()
    return [m.__dict__ for m in s.query_team_matches(team_name, year)]


__all__ = [
    "LeaguepediaScraper",
    "LeaguepediaMatch",
    "LeaguepediaGame",
    "LeaguepediaScoreboardLine",
    "query_team_matches",
]
