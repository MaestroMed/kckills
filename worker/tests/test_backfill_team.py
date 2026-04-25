"""Tests for the generic team backfill : backfill_team / backfill_league
+ services/golgg_scraper (team-agnostic mode) + services/leaguepedia_scraper
+ services/historical_team_id_resolver.

Strategy
--------
EVERY HTTP call is mocked. We never hit gol.gg or leaguepedia.fandom.com
in the test suite — the scraper's HTTP layer is replaced by a stub that
returns fixed HTML / JSON snippets crafted to look like the real thing.

The backfill_team integration tests stub :
  * services.supabase_client.safe_select / safe_insert  → in-memory dict
  * services.observability._try_insert_run / _try_update_run → no-op
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Path bootstrapping — same as the script does, so imports work.
_HERE = Path(__file__).resolve()
_WORKER_ROOT = _HERE.parent.parent
_REPO_ROOT = _WORKER_ROOT.parent
if str(_WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKER_ROOT))
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Stub env so config.py doesn't refuse to import.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ── HTML fixtures (gol.gg) ───────────────────────────────────────────

# Realistic page-timeline/ HTML : two kill rows + the team header section
# the summary parser scans for.
GOLGG_TIMELINE_HTML = """
<html><body>
<div class="row">
  <div class="col-6 text-center">Game Time<br/><h1>31:54</h1></div>
  <div class="col-3 text-right"> v14.5</div>
</div>
<a href='../teams/team-stats/2166/season-S14/'
   title='Karmine Corp stats'>Karmine Corp</a> - WIN
<a href='../teams/team-stats/2174/season-S14/'
   title='Vitality stats'>Vitality</a> - LOSS
<table>
<tr onmouseover='ShowPoint(123)'>
<td>3:15</td>
<td><img src='../_img/blueside-icon.png'/></td>
<td>Caliste</td>
<td class='text-left'>
  <img style='height:25px;width:25px' src='champions_icon/Smolder.png'/>
  <img style='height:18px;width:18px' src='champions_icon/Vi.png'/>
</td>
<td><img src='kill-icon.png'/></td>
<td><img style='height:25px;width:25px' src='champions_icon/Zeri.png'/></td>
<td>Patrik</td>
</tr>
<tr onmouseover='ShowPoint(789)'>
<td>5:42</td>
<td><img src='../_img/redside-icon.png'/></td>
<td>Patrik</td>
<td class='text-left'>
  <img style='height:25px;width:25px' src='champions_icon/Zeri.png'/>
</td>
<td><img src='kill-icon.png'/></td>
<td><img style='height:25px;width:25px' src='champions_icon/Smolder.png'/></td>
<td>Caliste</td>
</tr>
</table>
</body></html>
"""

# Realistic team-matchlist/ HTML : two game stubs.
GOLGG_MATCHLIST_HTML = """
<table>
<tr>
<td><a href='../game/stats/56156/page-game/'>56156</a></td>
<td><a href='../teams/team-stats/2174/' title='VIT stats'>VIT</a></td>
<td>21/01/2024</td>
<td>v14.5</td>
<td>WIN</td>
</tr>
<tr>
<td><a href='../game/stats/56157/page-game/'>56157</a></td>
<td><a href='../teams/team-stats/2175/' title='G2 stats'>G2</a></td>
<td>22/01/2024</td>
<td>v14.5</td>
<td>LOSE</td>
</tr>
</table>
"""

# Tournament-stats HTML — contains team-stats/<id> links the resolver
# scrapes. The KC variant for 2024.
GOLGG_TOURNAMENT_HTML_2024 = """
<table>
<tr><td><a href='../teams/team-stats/2166/season-S14/'
        title='Karmine Corp stats'>Karmine Corp</a></td></tr>
<tr><td><a href='../teams/team-stats/2174/season-S14/'
        title='Vitality stats'>Vitality</a></td></tr>
<tr><td><a href='../teams/team-stats/2175/season-S14/'
        title='G2 Esports stats'>G2 Esports</a></td></tr>
</table>
"""


# ── JSON fixtures (leaguepedia Cargo) ────────────────────────────────

LEAGUEPEDIA_GAMES_JSON = json.dumps([
    {
        "GameId": "LEC/2024 Spring Season/Scoreboards/Week 1/KC vs VIT/G1",
        "MatchId": "LEC/2024 Spring Season/Scoreboards/Week 1/KC vs VIT",
        "OverviewPage": "LEC/2024 Spring Season",
        "DateTime UTC": "2024-01-21 17:00:00",
        "Team1": "Karmine Corp",
        "Team2": "Vitality",
        "Winner": "Karmine Corp",
        "Gamelength": "31:54",
        "Patch": "14.5",
        "Team1Score": "1",
        "Team2Score": "0",
    },
])

LEAGUEPEDIA_SCOREBOARD_JSON = json.dumps([
    {"Name": "Caliste", "Champion": "Smolder", "Kills": "5",
     "Deaths": "1", "Assists": "8", "Role": "Bot",
     "Team": "Karmine Corp", "Side": "Blue"},
    {"Name": "Patrik", "Champion": "Zeri", "Kills": "1",
     "Deaths": "5", "Assists": "2", "Role": "Bot",
     "Team": "Vitality", "Side": "Red"},
])


# ── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture
def silence_observability(monkeypatch):
    """Silence the @run_logged decorator's Supabase writes."""
    from services import observability
    monkeypatch.setattr(observability, "_try_insert_run", lambda module_name: None)
    monkeypatch.setattr(observability, "_try_update_run", lambda *a, **k: None)
    yield


@pytest.fixture
def in_memory_supabase(monkeypatch):
    """Replace supabase_client.safe_select / safe_insert with an in-memory
    store. Each call is recorded ; lookups search the store like a tiny SQL
    layer would.

    Yields the store dict so individual tests can inspect what got
    inserted.
    """
    store: dict[str, list[dict]] = {}
    pk_counter = {"n": 0}

    def _next_id() -> str:
        pk_counter["n"] += 1
        return f"uuid-{pk_counter['n']:04d}"

    def fake_select(table, columns="*", **filters):
        rows = store.get(table, [])
        out = []
        for r in rows:
            if all(r.get(k) == v for k, v in filters.items()):
                out.append(r)
        return out

    def fake_insert(table, data):
        row = dict(data)
        row.setdefault("id", _next_id())
        store.setdefault(table, []).append(row)
        return row

    def fake_upsert(table, data, on_conflict=None):
        return fake_insert(table, data)

    def fake_update(table, data, match_col, match_val):
        for r in store.get(table, []):
            if r.get(match_col) == match_val:
                r.update(data)
                return True
        return False

    from services import supabase_client
    monkeypatch.setattr(supabase_client, "safe_select", fake_select)
    monkeypatch.setattr(supabase_client, "safe_insert", fake_insert)
    monkeypatch.setattr(supabase_client, "safe_upsert", fake_upsert)
    monkeypatch.setattr(supabase_client, "safe_update", fake_update)

    # Also patch the lazily-imported references inside the script. Any
    # `from services.supabase_client import safe_select` cached on import
    # in any module needs to be reloaded — we just monkey-patch the
    # imported names too.
    import worker.scripts.backfill_team as bt  # noqa: PLC0415
    yield store


@pytest.fixture
def tmp_cache_dir(tmp_path, monkeypatch):
    """Redirect the historical_team_id_resolver cache file to tmp_path
    so tests don't write into the real worker/cache/ directory."""
    from services import historical_team_id_resolver as r
    monkeypatch.setattr(r, "_CACHE_FILE", tmp_path / "golgg_team_ids.json")
    yield tmp_path


# ════════════════════════════════════════════════════════════════════
# 1. HistoricalTeamIdResolver
# ════════════════════════════════════════════════════════════════════

def test_resolver_uses_known_seeds_for_kc(tmp_cache_dir):
    """KC is in KNOWN_SEEDS — resolution must NOT touch HTTP."""
    from services.historical_team_id_resolver import HistoricalTeamIdResolver

    http_calls: list[str] = []
    def stub_http(url):
        http_calls.append(url)
        return ""

    r = HistoricalTeamIdResolver(
        cache_path=tmp_cache_dir / "ids.json",
        http_get=stub_http,
    )
    out = r.resolve("karmine-corp", year_range=(2021, 2026))
    assert out == {2021: 1223, 2022: 1535, 2023: 1881,
                   2024: 2166, 2025: 2533, 2026: 2899}
    assert http_calls == [], "no HTTP should fire for fully-seeded teams"


def test_resolver_constructor_seeds_take_precedence(tmp_cache_dir):
    """A test-injected seed must override KNOWN_SEEDS."""
    from services.historical_team_id_resolver import HistoricalTeamIdResolver

    r = HistoricalTeamIdResolver(
        seeds={"karmine-corp": {2024: 9999}},
        cache_path=tmp_cache_dir / "ids.json",
        http_get=lambda u: "",
    )
    out = r.resolve("karmine-corp", year_range=(2024, 2024))
    assert out == {2024: 9999}


def test_resolver_falls_back_to_http_for_unknown_team(tmp_cache_dir):
    """An unseeded team must trigger the HTTP discovery path and pick the
    matching team id by alias."""
    from services.historical_team_id_resolver import HistoricalTeamIdResolver

    captured_urls: list[str] = []
    def stub_http(url):
        captured_urls.append(url)
        if "Spring%20Season%202024" in url:
            return GOLGG_TOURNAMENT_HTML_2024
        return ""

    r = HistoricalTeamIdResolver(
        cache_path=tmp_cache_dir / "ids.json",
        http_get=stub_http,
    )
    out = r.resolve(
        "vitality-fictional",  # not in KNOWN_SEEDS
        year_range=(2024, 2024),
        aliases=["Vitality"],
    )
    assert out == {2024: 2174}
    # Cache should now contain the discovered id.
    cache = json.loads((tmp_cache_dir / "ids.json").read_text(encoding="utf-8"))
    assert cache.get("vitality-fictional", {}).get("2024") == 2174


# ════════════════════════════════════════════════════════════════════
# 2. GolggClient.scrape_team_kills (team-agnostic)
# ════════════════════════════════════════════════════════════════════

def test_golgg_scrape_team_kills_parses_kc_2024_fixture(monkeypatch):
    """End-to-end : list_team_games + fetch_game_full + annotation."""
    from services.golgg_scraper import GolggClient

    # Stub the raw HTTP _fetch method to return the fixture HTML based
    # on the path being requested.
    def fake_fetch(self, path):
        if "team-matchlist" in path:
            return GOLGG_MATCHLIST_HTML
        if "page-timeline" in path:
            return GOLGG_TIMELINE_HTML
        return ""

    monkeypatch.setattr(GolggClient, "_fetch", fake_fetch)
    client = GolggClient(min_delay_seconds=0.0,
                         tracked_team_ids={2166})  # KC LEC 2024
    kills = client.scrape_team_kills(
        team_slug="karmine-corp",
        year=2024,
        golgg_team_id=2166,
        tournament_labels=["LEC Spring Season 2024"],
    )
    # 2 games × 2 kills each = 4 total, but we don't dedup across games
    assert len(kills) == 4

    # First-blood propagated.
    fbs = [k for k in kills if k["is_first_blood"]]
    assert len(fbs) == 2  # one per game

    # tracked_team_involvement set : in our fixture, KC is on blue and
    # the first kill is from blue → KC killer ; second kill from red →
    # KC victim.
    assert kills[0]["tracked_team_involvement"] == "team_killer"
    assert kills[1]["tracked_team_involvement"] == "team_victim"

    # Champion + IGN parsing.
    assert kills[0]["killer_alias"] == "Caliste"
    assert kills[0]["killer_champion"] == "Smolder"
    assert kills[0]["victim_champion"] == "Zeri"
    assert kills[0]["assist_champions"] == ["Vi"]

    # external_id is unique per (game, seq).
    ext_ids = [k["external_id"] for k in kills]
    assert len(set(ext_ids)) == len(ext_ids)


def test_golgg_kc_backwards_compat_summary_kc_side():
    """The legacy `kc_side` attribute on GolggGameSummary must STILL be
    populated for the existing backfill_golgg.py script."""
    from services.golgg_scraper import GolggClient

    client = GolggClient(min_delay_seconds=0.0)  # default = KC ids
    summary = client._parse_summary("56156", GOLGG_TIMELINE_HTML)
    assert summary.kc_side == "blue"
    assert summary.tracked_side == "blue"
    assert summary.duration_seconds == 31 * 60 + 54
    assert summary.patch == "14.5"
    assert summary.blue_team_id == 2166
    assert summary.red_team_id == 2174


# ════════════════════════════════════════════════════════════════════
# 3. LeaguepediaScraper
# ════════════════════════════════════════════════════════════════════

def test_leaguepedia_query_team_games_parses_cargo_response(monkeypatch):
    """Mock the Cargo HTTP response and verify the parser converts it
    into LeaguepediaGame dataclasses."""
    from services.leaguepedia_scraper import LeaguepediaScraper

    captured: list[str] = []
    def stub_http(url):
        captured.append(url)
        return LEAGUEPEDIA_GAMES_JSON

    s = LeaguepediaScraper(http_get=stub_http, min_delay_seconds=0.0)
    games = s.query_team_games("Karmine Corp", 2024)
    assert len(games) == 1
    g = games[0]
    assert g.team1 == "Karmine Corp"
    assert g.team2 == "Vitality"
    assert g.winner == "Karmine Corp"
    assert g.duration_seconds == 31 * 60 + 54
    assert g.patch == "14.5"
    assert g.date_utc == "2024-01-21"
    # And the URL must contain the team filter properly URL-escaped.
    assert "Karmine+Corp" in captured[0] or "Karmine%20Corp" in captured[0]


def test_leaguepedia_synthesise_kills_distributes_uniformly(monkeypatch):
    """synthesise_kills_for_game should emit one row per kill in the
    scoreboard, with monotonically increasing game_time_seconds."""
    from services.leaguepedia_scraper import (
        LeaguepediaScraper, LeaguepediaGame, LeaguepediaScoreboardLine,
    )

    s = LeaguepediaScraper(http_get=lambda u: "", min_delay_seconds=0.0)
    game = LeaguepediaGame(
        game_id="g1", match_id="m1", tournament="LEC/2024",
        date_utc="2024-01-21", team1="A", team2="B", winner="A",
        patch="14.5", duration_seconds=31 * 60,
    )
    scoreboard = [
        LeaguepediaScoreboardLine(
            name="Caliste", champion="Smolder",
            kills=3, deaths=0, assists=0,
            role="Bot", team="A", side="Blue",
        ),
        LeaguepediaScoreboardLine(
            name="Patrik", champion="Zeri",
            kills=1, deaths=0, assists=0,
            role="Bot", team="B", side="Red",
        ),
    ]
    kills = s.synthesise_kills_for_game(game, scoreboard)
    # 3 + 1 kills total.
    assert len(kills) == 4
    # Times must be monotonically increasing.
    times = [k["game_time_seconds"] for k in kills]
    assert times == sorted(times)
    # Exactly one first_blood.
    assert sum(1 for k in kills if k["is_first_blood"]) == 1
    # confidence='estimated' to mark these as low-fidelity.
    assert all(k["confidence"] == "estimated" for k in kills)
    assert all(k["data_source"] == "leaguepedia" for k in kills)


# ════════════════════════════════════════════════════════════════════
# 4. backfill_team — integration (mocked HTTP + mocked Supabase)
# ════════════════════════════════════════════════════════════════════

def test_backfill_team_kc_dry_run_reports_kills(
    monkeypatch, in_memory_supabase, silence_observability, tmp_cache_dir,
):
    """Run backfill_team --team karmine-corp --year 2024 --dry-run with
    mocked HTTP. We expect kills to be SCRAPED but NOT INSERTED."""
    from services.golgg_scraper import GolggClient

    def fake_fetch(self, path):
        if "team-matchlist" in path:
            return GOLGG_MATCHLIST_HTML
        if "page-timeline" in path:
            return GOLGG_TIMELINE_HTML
        return ""

    monkeypatch.setattr(GolggClient, "_fetch", fake_fetch)

    from worker.scripts.backfill_team import build_parser, _async_backfill_team

    args = build_parser().parse_args([
        "--team", "karmine-corp",
        "--year", "2024",
        "--dry-run",
        "--delay", "0",
    ])
    report = asyncio.run(_async_backfill_team(args))

    assert report.team_slug == "karmine-corp"
    assert len(report.years) == 1
    yr = report.years[0]
    assert yr.year == 2024
    assert yr.source == "golgg"
    assert yr.kills_scraped > 0, "scraping must produce some kills"
    assert yr.kills_inserted == 0, "dry-run must NOT insert"
    # No rows in Supabase store either.
    assert in_memory_supabase.get("kills", []) == []


def test_backfill_team_kc_writes_to_supabase(
    monkeypatch, in_memory_supabase, silence_observability, tmp_cache_dir,
):
    """Same flow but WITHOUT --dry-run : verify the in-memory store gets
    the expected rows in matches / games / kills / teams / players /
    tournaments."""
    from services.golgg_scraper import GolggClient

    def fake_fetch(self, path):
        if "team-matchlist" in path:
            return GOLGG_MATCHLIST_HTML
        if "page-timeline" in path:
            return GOLGG_TIMELINE_HTML
        return ""

    monkeypatch.setattr(GolggClient, "_fetch", fake_fetch)

    from worker.scripts.backfill_team import build_parser, _async_backfill_team

    args = build_parser().parse_args([
        "--team", "karmine-corp",
        "--year", "2024",
        "--delay", "0",
    ])
    report = asyncio.run(_async_backfill_team(args))

    assert report.total_kills > 0
    assert "kills" in in_memory_supabase
    inserted_kills = in_memory_supabase["kills"]
    assert len(inserted_kills) == report.total_kills

    # Every inserted kill points at a game and has a confidence='verified'.
    for k in inserted_kills:
        assert k.get("game_id"), "kill must reference a game"
        assert k["confidence"] == "verified"
        assert k["data_source"] == "gol_gg"
        assert k["status"] == "raw"
        assert k.get("game_time_seconds") is not None

    # Tournament + match + game tables must have been populated.
    assert in_memory_supabase.get("tournaments")
    assert in_memory_supabase.get("matches")
    assert in_memory_supabase.get("games")
    assert any(t.get("slug") == "karmine-corp"
               for t in in_memory_supabase.get("teams", []))


def test_backfill_team_unknown_slug_errors(
    monkeypatch, in_memory_supabase, silence_observability, tmp_cache_dir,
):
    """An unknown team slug should raise SystemExit (clean CLI error)."""
    from worker.scripts.backfill_team import build_parser, _async_backfill_team

    args = build_parser().parse_args([
        "--team", "this-team-does-not-exist-anywhere",
        "--year", "2024",
        "--dry-run",
        "--delay", "0",
    ])
    with pytest.raises(SystemExit):
        asyncio.run(_async_backfill_team(args))


def test_backfill_team_idempotent_second_run_inserts_zero(
    monkeypatch, in_memory_supabase, silence_observability, tmp_cache_dir,
):
    """Running the backfill twice must not double-insert kills. The
    dedup guard in _insert_kill checks game_time_seconds ±1s."""
    from services.golgg_scraper import GolggClient

    def fake_fetch(self, path):
        if "team-matchlist" in path:
            return GOLGG_MATCHLIST_HTML
        if "page-timeline" in path:
            return GOLGG_TIMELINE_HTML
        return ""

    monkeypatch.setattr(GolggClient, "_fetch", fake_fetch)

    from worker.scripts.backfill_team import build_parser, _async_backfill_team

    args = build_parser().parse_args([
        "--team", "karmine-corp",
        "--year", "2024",
        "--delay", "0",
    ])

    first = asyncio.run(_async_backfill_team(args))
    assert first.total_kills > 0
    n_after_first = len(in_memory_supabase.get("kills", []))

    second = asyncio.run(_async_backfill_team(args))
    n_after_second = len(in_memory_supabase.get("kills", []))
    assert second.total_kills == 0, "second run must skip every existing kill"
    assert n_after_second == n_after_first, "store must NOT have grown"


# ════════════════════════════════════════════════════════════════════
# 5. backfill_league
# ════════════════════════════════════════════════════════════════════

def test_backfill_league_lec_with_explicit_teams(
    monkeypatch, in_memory_supabase, silence_observability, tmp_cache_dir,
):
    """--league lec --teams karmine-corp --dry-run should run the team
    backfill exactly once for KC."""
    from services.golgg_scraper import GolggClient

    def fake_fetch(self, path):
        if "team-matchlist" in path:
            return GOLGG_MATCHLIST_HTML
        if "page-timeline" in path:
            return GOLGG_TIMELINE_HTML
        return ""

    monkeypatch.setattr(GolggClient, "_fetch", fake_fetch)

    from worker.scripts.backfill_league import build_parser, _async_backfill_league

    args = build_parser().parse_args([
        "--league", "lec",
        "--teams", "karmine-corp",
        "--year", "2024",
        "--dry-run",
        "--delay", "0",
        "--concurrency", "1",
    ])
    report = asyncio.run(_async_backfill_league(args))
    assert report.league_slug == "lec"
    assert len(report.teams) == 1
    assert report.teams[0].team_slug == "karmine-corp"
    # dry-run, so nothing inserted
    assert report.teams[0].kills_inserted == 0


# ════════════════════════════════════════════════════════════════════
# 6. CLI parser smoke tests (no execution)
# ════════════════════════════════════════════════════════════════════

def test_backfill_team_parser_required_team_flag():
    from worker.scripts.backfill_team import build_parser
    p = build_parser()
    with pytest.raises(SystemExit):
        p.parse_args([])  # --team is required


def test_backfill_team_parser_year_range_pair():
    from worker.scripts.backfill_team import build_parser
    args = build_parser().parse_args([
        "--team", "g2-esports",
        "--year-range", "2021", "2024",
        "--source", "both",
    ])
    assert args.team == "g2-esports"
    assert args.year_range == [2021, 2024]
    assert args.source == "both"


def test_backfill_league_concurrency_capped_at_3():
    """--concurrency > 3 must be silently lowered to 3 by main()."""
    from worker.scripts import backfill_league as bl
    args = bl.build_parser().parse_args([
        "--league", "lec",
        "--teams", "karmine-corp",
        "--concurrency", "50",
        "--dry-run",
    ])
    # main() patches the args before running ; we just verify the cap
    # constant is what we expect.
    assert args.concurrency == 50
    # Patch _runner so main() doesn't actually start scraping, then
    # invoke main and check that concurrency got rewritten.
    captured = {}
    async def _stub(stub_args):
        captured["concurrency"] = stub_args.concurrency
        return bl.LeagueReport(league_slug="lec")

    with patch.object(bl, "_runner", _stub):
        rc = bl.main([
            "--league", "lec",
            "--teams", "karmine-corp",
            "--concurrency", "50",
            "--dry-run",
        ])
    assert rc == 0
    assert captured["concurrency"] == 3
