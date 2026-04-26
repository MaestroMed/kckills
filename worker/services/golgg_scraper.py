"""
gol.gg scraper — historical kill data backfill source.

Why : the Riot live stats feed (feed.lolesports.com) expires after a few
weeks for old matches. gol.gg archives every pro game from LFL/LEC/EUM/
Worlds since 2014 with full per-kill timeline (timestamp + killer +
victim + assists + champions). It's the only free public source with
this granularity for historical pro LoL.

Coverage confirmed empirically (2026-04) :
  * LFL Spring 2021 → all KC games (e.g. game 30119 KC vs MSFP)
  * LEC Spring 2024 → all KC games (e.g. game 56156 KC vs FNC)
  * Same URL pattern works for any year.

Data quality :
  * Game-time MM:SS (no real-world epoch — pause-vulnerable but pauses
    are rare in pro and we don't need sub-second precision for clipping)
  * Killer + victim + assists + champions for each kill
  * No multi-kill flag — derive client-side via 10s sliding window
  * No is_first_blood flag — first kill chronologically per game

Politeness :
  * 5-10 second delay between requests (single-threaded by design)
  * UA spoof (gol.gg returns 403 to default Python UA)
  * Retry-with-backoff on 403/429/5xx
  * NEVER parallel — keep one request in flight at a time

Usage :
    from services.golgg_scraper import GolggClient
    client = GolggClient(min_delay_seconds=6.0)
    games = client.list_team_games(team_id=2166, tournament="LEC Spring Season 2024")
    for g in games:
        kills = client.fetch_game_kills(g["golgg_game_id"])
"""

from __future__ import annotations

import gzip
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable, Optional

import structlog

log = structlog.get_logger()


GOLGG_BASE = "https://gol.gg"

# gol.gg returns 403 to the default Python urllib User-Agent. Mimicking
# a real browser is the standard workaround. We declare it once here.
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)

# Per-request delay floor (seconds). gol.gg has no published RL but
# returns 403 if hammered. 6s is conservative ; safe for unattended
# multi-hour backfills.
DEFAULT_MIN_DELAY = 6.0

# Backoff sequence on 403/429/5xx (seconds).
BACKOFF_SCHEDULE = (10.0, 30.0, 90.0, 300.0)


@dataclass
class GolggGameStub:
    """One row of a team-matchlist page."""
    golgg_game_id: str            # e.g. "56156"
    opponent_code: Optional[str]  # e.g. "FNC"
    date: Optional[str]           # ISO date "2024-01-21" if parseable
    patch: Optional[str]          # e.g. "14.5"
    kc_won: Optional[bool]
    score: Optional[str]          # e.g. "1-0"


@dataclass
class GolggKill:
    """One kill row from a game's page-timeline/."""
    game_time_seconds: int        # MM:SS converted to seconds
    side: str                      # "blue" | "red"
    killer_player: str             # IGN as displayed by gol.gg
    killer_champion: str           # champion key (e.g. "Smolder")
    victim_player: str
    victim_champion: str
    assist_champions: list[str]    # ordered list of assist champion keys


@dataclass
class GolggGameSummary:
    """Header info from a game's page-timeline/ — extracted from the
    same page as the kill rows so we don't pay an extra request to
    the page-game/ tab."""
    golgg_game_id: str
    duration_seconds: Optional[int]   # parsed from the "Game Time" header
    patch: Optional[str]              # e.g. "14.5"
    blue_team_id: Optional[int]       # gol.gg team id for the blue side
    blue_team_name: Optional[str]
    blue_won: Optional[bool]
    red_team_id: Optional[int]
    red_team_name: Optional[str]
    red_won: Optional[bool]
    # Side of the *tracked* team (the one this backfill is following),
    # derived against the tracked_team_ids set passed to the client.
    # "blue" | "red" | None when the tracked team didn't play this game.
    # Kept under the legacy name kc_side for backwards compatibility with
    # the existing KC backfill (scripts/backfill_golgg.py reads .kc_side).
    kc_side: Optional[str]
    # Synonym — what the new generic code uses. Same value as kc_side.
    tracked_side: Optional[str] = None


class GolggClient:
    """Single-threaded gol.gg scraper with built-in rate limiting and
    retry. Construct one instance per backfill run — the rate-limit
    state is per-instance.
    """

    def __init__(
        self,
        min_delay_seconds: float = DEFAULT_MIN_DELAY,
        user_agent: str = DEFAULT_UA,
        tracked_team_ids: Optional[Iterable[int]] = None,
    ):
        """Init.

        tracked_team_ids : the set of gol.gg numeric team ids that
            represent the *tracked* team across years. For KC that's
            {1223, 1535, 1881, 2166, 2533, 2899}. We use it to populate
            GolggGameSummary.tracked_side / kc_side. If None, defaults to
            the legacy hard-coded KC ids (preserves old behaviour for
            the existing backfill_golgg.py script).
        """
        self.min_delay = min_delay_seconds
        self.user_agent = user_agent
        self._last_request_at: float = 0.0
        # Default to the historical KC ids so the existing KC backfill
        # script keeps working unchanged. Generic backfill_team.py passes
        # the resolved per-team set explicitly.
        if tracked_team_ids is None:
            self.tracked_team_ids: set[int] = {1223, 1535, 1881, 2166, 2533, 2899}
        else:
            self.tracked_team_ids = set(int(x) for x in tracked_team_ids)

    @classmethod
    def from_tracked_team(
        cls,
        team,  # services.team_config.TrackedTeam — annotated loose to avoid circular import
        *,
        min_delay_seconds: float = DEFAULT_MIN_DELAY,
        user_agent: str = DEFAULT_UA,
    ) -> "GolggClient":
        """Build a GolggClient seeded from a services.team_config.TrackedTeam.

        Reads the team's `golgg_team_id` (the headline current id) AND
        every value in `golgg_team_ids_history` (past LFL/LEC ids) so a
        single backfill walks the team's full history. Falls back to the
        legacy KC hardcoded ids when neither field is populated (which
        means the catalog hasn't been backfilled yet for this team — the
        clip can still be parsed, it just won't get tracked_side info).
        """
        ids: set[int] = set()
        if getattr(team, "golgg_team_id", None):
            ids.add(int(team.golgg_team_id))
        for v in (getattr(team, "golgg_team_ids_history", None) or {}).values():
            try:
                ids.add(int(v))
            except (TypeError, ValueError):
                continue
        return cls(
            min_delay_seconds=min_delay_seconds,
            user_agent=user_agent,
            tracked_team_ids=ids if ids else None,
        )

    # ── HTTP plumbing ────────────────────────────────────────────────

    def _wait(self) -> None:
        """Sleep just long enough to honour min_delay since the last
        request. Computed against monotonic time so it's wall-clock
        accurate even if the host's NTP clock drifts."""
        if self._last_request_at == 0.0:
            return
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.min_delay:
            time.sleep(self.min_delay - elapsed)

    def _fetch(self, path: str) -> str:
        """GET path → decoded HTML body. Honours rate limit + handles
        gzip transparently. Retries on 403/429/5xx with the configured
        backoff schedule. Raises on permanent failure."""
        url = f"{GOLGG_BASE}{path}" if path.startswith("/") else f"{GOLGG_BASE}/{path}"
        last_err: Optional[Exception] = None
        for attempt in range(len(BACKOFF_SCHEDULE) + 1):
            self._wait()
            self._last_request_at = time.monotonic()
            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": self.user_agent,
                        "Accept-Encoding": "gzip",
                        "Accept": "text/html,application/xhtml+xml",
                    },
                )
                with urllib.request.urlopen(req, timeout=30) as r:
                    raw = r.read()
                    if r.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    return raw.decode("utf-8", errors="ignore")
            except urllib.error.HTTPError as e:
                last_err = e
                # 404 is permanent — don't retry.
                if e.code == 404:
                    raise
                if attempt < len(BACKOFF_SCHEDULE):
                    sleep_for = BACKOFF_SCHEDULE[attempt]
                    log.warn(
                        "golgg_http_error_retry",
                        url=url, status=e.code, sleep_s=sleep_for,
                    )
                    time.sleep(sleep_for)
                    continue
                raise
            except Exception as e:
                last_err = e
                if attempt < len(BACKOFF_SCHEDULE):
                    sleep_for = BACKOFF_SCHEDULE[attempt]
                    log.warn(
                        "golgg_fetch_error_retry",
                        url=url, error=str(e)[:120], sleep_s=sleep_for,
                    )
                    time.sleep(sleep_for)
                    continue
                raise
        # Should be unreachable — the loop either returns or raises.
        raise RuntimeError(f"golgg_fetch_failed url={url} last_err={last_err}")

    # ── Public API : team matchlist ──────────────────────────────────

    def list_team_games(
        self,
        team_id: int,
        tournament: str,
    ) -> list[GolggGameStub]:
        """Enumerate all games a team played in a given tournament.
        `tournament` is the human-readable string used in the URL,
        e.g. "LEC Spring Season 2024" or "LFL Spring 2021". gol.gg
        URL-encodes spaces as %20 — we do that here.

        Returns an empty list if the URL 404s or the team didn't play
        in that tournament.
        """
        encoded = urllib.parse.quote(tournament)
        path = f"/teams/team-matchlist/{team_id}/split-ALL/tournament-{encoded}/"
        try:
            html = self._fetch(path)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                log.info("golgg_tournament_not_found", team_id=team_id, tournament=tournament)
                return []
            raise

        # Each game appears as a /game/stats/{id}/page-game/ link inside
        # a <td> that also contains the opponent stats link.
        # Strategy : split on </tr> rows, parse each one for the game
        # id + surrounding metadata.
        stubs: list[GolggGameStub] = []
        seen: set[str] = set()
        rows = html.split("</tr>")
        for row in rows:
            m = re.search(r"/game/stats/(\d+)/page-game/", row)
            if not m:
                continue
            gid = m.group(1)
            if gid in seen:
                continue
            seen.add(gid)

            # Opponent code — the matchlist row has either an opponent
            # team-stats link OR the matchup label "OPP vs KC" / "KC vs OPP".
            opp_match = re.search(
                r"team-stats/\d+/[^']*?'\s*title='([A-Z0-9]+)\s+stats'",
                row,
            )
            opponent = opp_match.group(1) if opp_match else None

            # Date — find a "DD/MM/YYYY" or "YYYY-MM-DD" format
            date_iso: Optional[str] = None
            d_match = re.search(r"(\d{2})/(\d{2})/(\d{4})", row)
            if d_match:
                dd, mm, yyyy = d_match.groups()
                date_iso = f"{yyyy}-{mm}-{dd}"

            # Patch — appears as "v14.5" or "14.5"
            patch_match = re.search(r">v?(\d{1,2}\.\d{1,2})<", row)
            patch = patch_match.group(1) if patch_match else None

            # Win/loss — the row typically contains "WIN" or "LOSE"/"LOSS"
            won: Optional[bool] = None
            if re.search(r">WIN<", row, re.IGNORECASE):
                won = True
            elif re.search(r">(LOSE|LOSS|LOST)<", row, re.IGNORECASE):
                won = False

            stubs.append(GolggGameStub(
                golgg_game_id=gid,
                opponent_code=opponent,
                date=date_iso,
                patch=patch,
                kc_won=won,
                score=None,
            ))

        return stubs

    # ── Public API : single-game timeline ────────────────────────────

    def fetch_game_kills(self, golgg_game_id: str) -> list[GolggKill]:
        """Fetch every kill from the timeline tab of a single game.

        Returns an empty list if :
          * the game id 404s
          * the timeline section is missing (very old games / data gap)
          * the page renders but has no kill rows (extremely rare)
        """
        path = f"/game/stats/{golgg_game_id}/page-timeline/"
        try:
            html = self._fetch(path)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                log.info("golgg_game_not_found", game_id=golgg_game_id)
                return []
            raise

        return self._parse_timeline(html)

    def fetch_game_full(
        self,
        golgg_game_id: str,
    ) -> tuple[Optional[GolggGameSummary], list[GolggKill]]:
        """One-shot fetch — page-timeline/ contains BOTH the team header
        info AND the kill rows. Saves a request per game vs hitting
        page-game/ separately.

        Returns (summary, kills). summary is None if the page failed.
        """
        path = f"/game/stats/{golgg_game_id}/page-timeline/"
        try:
            html = self._fetch(path)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, []
            raise

        summary = self._parse_summary(golgg_game_id, html)
        kills = self._parse_timeline(html)
        return summary, kills

    # ── HTML parsing — kept dependency-free (no bs4) for portability.

    # Each kill row looks like (formatted) :
    #   <tr onmouseover='ShowPoint(NNN)'>
    #     <td>3:15</td>
    #     <td><img src='../_img/blueside-icon.png' .../></td>
    #     <td>Upset</td>
    #     <td class='text-left'>
    #       <img style='height:25px;width:25px' src='.../champions_icon/Zeri.png'/>   ← killer champ
    #       <img style='height:18px;width:18px' src='.../champions_icon/Vi.png'/>      ← assist
    #       <img style='height:18px;width:18px' src='.../champions_icon/Nautilus.png'/> ← assist
    #     </td>
    #     <td><img src='.../kill-icon.png' .../></td>
    #     <td><img style='height:25px;width:25px' src='.../champions_icon/Smolder.png'/></td>  ← victim champ
    #     <td>Patrik</td>
    #   </tr>
    _ROW_RE = re.compile(
        r"<tr[^>]*onmouseover='ShowPoint\(\d+\)'[^>]*>(.*?)</tr>",
        re.DOTALL,
    )
    _CHAMP_25_RE = re.compile(
        r"<img[^>]*style='[^']*height:25px[^']*'[^>]*champions_icon/([A-Za-z0-9_]+)\.png",
    )
    _CHAMP_18_RE = re.compile(
        r"<img[^>]*style='[^']*height:18px[^']*'[^>]*champions_icon/([A-Za-z0-9_]+)\.png",
    )

    def _parse_timeline(self, html: str) -> list[GolggKill]:
        kills: list[GolggKill] = []
        for row_html in self._ROW_RE.findall(html):
            # Time MM:SS — first <td>
            t_match = re.search(r"<td>(\d{1,2}):(\d{2})</td>", row_html)
            if not t_match:
                continue
            mm, ss = int(t_match.group(1)), int(t_match.group(2))
            game_time = mm * 60 + ss

            # Side
            side = "blue" if "blueside-icon" in row_html else "red" if "redside-icon" in row_html else "unknown"

            # All <td> values — split the row into cells to grab the
            # plain-text killer + victim names.
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.DOTALL)
            if len(cells) < 7:
                continue

            killer_player = self._strip_tags(cells[2]).strip()
            victim_player = self._strip_tags(cells[6]).strip()

            # Champions in the killer cell : 25px = killer, 18px = assists.
            killer_champ_match = self._CHAMP_25_RE.search(cells[3])
            if not killer_champ_match:
                continue
            killer_champion = killer_champ_match.group(1)
            assists = self._CHAMP_18_RE.findall(cells[3])

            # Victim champion is the only 25px champ in cell 5.
            victim_champ_match = self._CHAMP_25_RE.search(cells[5])
            if not victim_champ_match:
                continue
            victim_champion = victim_champ_match.group(1)

            kills.append(GolggKill(
                game_time_seconds=game_time,
                side=side,
                killer_player=killer_player,
                killer_champion=killer_champion,
                victim_player=victim_player,
                victim_champion=victim_champion,
                assist_champions=assists,
            ))
        return kills

    @staticmethod
    def _strip_tags(html_chunk: str) -> str:
        return re.sub(r"<[^>]+>", "", html_chunk).replace("&nbsp;", " ").strip()

    # Header section of page-timeline/ — has both teams' info plus the
    # "Game Time" duration. Layout (sample) :
    #   <div class="col-6 text-center">Game Time<br/><h1>31:54</h1></div>
    #   <div class="col-3 text-right"> v14.5</div>
    #   ...
    #   <a href='../teams/team-stats/2166/...'>Karmine Corp</a> - WIN
    #   ...
    #   <a href='../teams/team-stats/2174/...'>Vitality</a> - LOSS
    _DURATION_RE = re.compile(
        r"Game\s*Time[^<]*<br[^>]*>\s*<h1[^>]*>(\d{1,3}):(\d{2})</h1>",
        re.IGNORECASE,
    )
    _PATCH_RE = re.compile(r"v(\d{1,2}\.\d{1,2})\s*<", re.IGNORECASE)
    # Captures team-stats/<team_id>/...title='Team Name stats'>Team Name</a> - WIN/LOSS
    _TEAM_HEADER_RE = re.compile(
        r"team-stats/(\d+)/[^']+'[^>]*title='([^']+?)\s+stats'[^>]*>([^<]+)</a>\s*-\s*(WIN|LOSS|LOSE|LOST)",
        re.IGNORECASE,
    )

    def _parse_summary(self, golgg_game_id: str, html: str) -> "GolggGameSummary":
        # Duration
        dur: Optional[int] = None
        m = self._DURATION_RE.search(html)
        if m:
            dur = int(m.group(1)) * 60 + int(m.group(2))

        # Patch
        patch: Optional[str] = None
        m = self._PATCH_RE.search(html)
        if m:
            patch = m.group(1)

        # Teams — gol.gg's timeline page shows the BLUE team header first,
        # then the RED team header. We rely on document order to assign
        # sides. If only one team header is found, both sides are None.
        team_headers = self._TEAM_HEADER_RE.findall(html)
        blue_team_id = blue_team_name = None
        blue_won = None
        red_team_id = red_team_name = None
        red_won = None
        if len(team_headers) >= 1:
            tid, name_attr, name_text, result = team_headers[0]
            blue_team_id = int(tid)
            blue_team_name = name_text.strip() or name_attr.strip()
            blue_won = result.upper() == "WIN"
        if len(team_headers) >= 2:
            tid, name_attr, name_text, result = team_headers[1]
            red_team_id = int(tid)
            red_team_name = name_text.strip() or name_attr.strip()
            red_won = result.upper() == "WIN"

        # Determine which side the *tracked* team was on. The set of
        # known team ids is configured per-client (default = KC's full
        # history, see __init__).
        tracked_side: Optional[str] = None
        if blue_team_id in self.tracked_team_ids:
            tracked_side = "blue"
        elif red_team_id in self.tracked_team_ids:
            tracked_side = "red"

        return GolggGameSummary(
            golgg_game_id=golgg_game_id,
            duration_seconds=dur,
            patch=patch,
            blue_team_id=blue_team_id,
            blue_team_name=blue_team_name,
            blue_won=blue_won,
            red_team_id=red_team_id,
            red_team_name=red_team_name,
            red_won=red_won,
            kc_side=tracked_side,           # legacy alias
            tracked_side=tracked_side,
        )


    # ── High-level helper for the generic backfill ────────────────────

    def scrape_team_kills(
        self,
        team_slug: str,
        year: int,
        golgg_team_id: int,
        tournament_labels: Optional[list[str]] = None,
    ) -> list[dict]:
        """Convenience wrapper used by scripts/backfill_team.py.

        Walks every tournament that the team played in `year`, fetches
        each game's timeline, and returns a flat list of kill dicts ready
        to be persisted by the caller. Each dict has :

            external_id          — synthetic, "golgg_{game_id}_{seq}"
            game_id_external     — "golgg_game_{game_id}"
            match_id_external    — "golgg_match_{game_id}" (no real
                                   match grouping in gol.gg matchlist)
            game_time_seconds    — int
            killer_alias / victim_alias — IGN as displayed by gol.gg
            killer_champion / victim_champion — champ key
            assist_champions     — list[str]
            multi_kill           — None | "double" | "triple" | "quadra" | "penta"
            is_first_blood       — bool
            tracked_team_involvement  — "team_killer" | "team_victim" | None
            data_source          — "gol_gg"
            confidence           — "verified"
            patch                — game patch (str | None)
            duration_seconds     — int | None
            tournament           — the URL label this game came from

        tournament_labels lets the caller pass an explicit list of
        gol.gg tournament strings to walk (e.g. ["LEC Spring Season 2024",
        "LEC Summer Season 2024"]). When omitted, falls back to a
        reasonable default set per league (see _default_tournament_labels).
        """
        labels = tournament_labels or _default_tournament_labels(year)
        out: list[dict] = []

        # Make sure the tracked team set includes this team for the
        # summary parsing to mark sides correctly.
        self.tracked_team_ids = self.tracked_team_ids | {int(golgg_team_id)}

        for label in labels:
            try:
                stubs = self.list_team_games(team_id=golgg_team_id, tournament=label)
            except Exception as e:
                log.warn("scrape_team_kills_list_failed",
                         team_slug=team_slug, year=year, tournament=label,
                         error=str(e)[:120])
                continue
            if not stubs:
                continue

            for stub in stubs:
                try:
                    summary, raw_kills = self.fetch_game_full(stub.golgg_game_id)
                except Exception as e:
                    log.warn("scrape_team_kills_game_failed",
                             game=stub.golgg_game_id, error=str(e)[:120])
                    continue
                if summary is None or not raw_kills:
                    continue

                annotated = annotate_multi_kills(raw_kills)
                tracked_side = summary.tracked_side or summary.kc_side

                for seq, a in enumerate(annotated):
                    involvement: Optional[str] = None
                    if tracked_side == a["side"]:
                        involvement = "team_killer"
                    elif tracked_side and tracked_side != a["side"]:
                        involvement = "team_victim"

                    out.append({
                        "external_id": f"golgg_{stub.golgg_game_id}_{seq}",
                        "game_id_external": f"golgg_game_{stub.golgg_game_id}",
                        "match_id_external": f"golgg_match_{stub.golgg_game_id}",
                        "game_time_seconds": a["game_time_seconds"],
                        "killer_alias": a["killer_player"],
                        "killer_champion": a["killer_champion"],
                        "victim_alias": a["victim_player"],
                        "victim_champion": a["victim_champion"],
                        "assist_champions": a["assists"],
                        "multi_kill": a["multi_kill"],
                        "is_first_blood": a["is_first_blood"],
                        "tracked_team_involvement": involvement,
                        "data_source": "gol_gg",
                        "confidence": "verified",
                        "patch": summary.patch,
                        "duration_seconds": summary.duration_seconds,
                        "tournament": label,
                        "blue_team_name": summary.blue_team_name,
                        "red_team_name": summary.red_team_name,
                        "blue_won": summary.blue_won,
                        "red_won": summary.red_won,
                        "date": stub.date,
                        "opponent_code": stub.opponent_code,
                    })
        return out


# ── Default tournament labels per year ─────────────────────────────────

def _default_tournament_labels(year: int) -> list[str]:
    """Return the set of gol.gg tournament URL labels we'll try for a
    given year when the caller doesn't pass an explicit list. Covers the
    LEC main labels — extend as new splits land. The scraper tolerates
    404s (returns []) so over-shooting is cheap.
    """
    if year >= 2026:
        # 2026 introduced the "Versus" split + the "YYYY <Phase>" naming.
        return [
            f"LEC {year} Versus Season",
            f"LEC {year} Versus Playoffs",
            f"LEC {year} Spring Season",
            f"LEC {year} Spring Playoffs",
            f"LEC {year} Summer Season",
            f"LEC {year} Summer Playoffs",
            f"First Stand {year}",
        ]
    if year == 2025:
        return [
            "LEC Winter 2025",
            "LEC 2025 Winter Playoffs",
            "LEC 2025 Spring Season",
            "LEC 2025 Spring Playoffs",
            "LEC 2025 Summer Season",
            "LEC 2025 Summer Playoffs",
            "First Stand 2025",
        ]
    if year == 2024:
        return [
            "LEC Winter Season 2024",
            "LEC Spring Season 2024",
            "LEC Summer Season 2024",
            "LEC Summer Playoffs 2024",
            "LEC Season Finals 2024",
        ]
    # 2021-2023 was LFL (and EU Masters) for KC. Generic teams in those
    # years probably also need league-specific labels, but this is the
    # best generic default we can offer.
    return [
        f"LFL Spring {year}",
        f"LFL Spring Playoffs {year}",
        f"LFL Summer {year}",
        f"LFL Summer Playoffs {year}",
        f"EU Masters Spring {year}",
        f"EU Masters Summer {year}",
        f"LEC Spring {year}",
        f"LEC Summer {year}",
    ]


# ── Multi-kill / first-blood derivation (post-processing) ───────────

def annotate_multi_kills(kills: list[GolggKill]) -> list[dict]:
    """Walk the kills list (must be chronological) and emit a list of
    dicts ready to merge into a kills row insert. Adds :
        * is_first_blood : True for the very first kill
        * multi_kill : "double" / "triple" / "quadra" / "penta" if the
                       killer racked up N consecutive kills within the
                       multi-kill window (10s by default — Riot's spec).

    The original GolggKill list is unchanged — we return new dicts so
    the caller decides what to persist.
    """
    out: list[dict] = []
    if not kills:
        return out

    # Sort defensively in case the caller fed us an unsorted list.
    sorted_k = sorted(kills, key=lambda k: k.game_time_seconds)

    # Track each killer's recent kill timestamps for multi-kill detection.
    MULTI_WINDOW = 10
    recent_by_killer: dict[str, list[int]] = {}
    multi_label = {2: "double", 3: "triple", 4: "quadra", 5: "penta"}

    for i, k in enumerate(sorted_k):
        # Sliding window — keep only kills within the multi-kill window.
        recent = [t for t in recent_by_killer.get(k.killer_player, [])
                  if k.game_time_seconds - t <= MULTI_WINDOW]
        recent.append(k.game_time_seconds)
        recent_by_killer[k.killer_player] = recent

        out.append({
            "game_time_seconds": k.game_time_seconds,
            "side": k.side,
            "killer_player": k.killer_player,
            "killer_champion": k.killer_champion,
            "victim_player": k.victim_player,
            "victim_champion": k.victim_champion,
            "assists": k.assist_champions,
            "is_first_blood": i == 0,
            "multi_kill": multi_label.get(len(recent)),  # None for solo kills
        })
    return out
