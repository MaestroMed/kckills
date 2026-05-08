"""
tracked_teams — V47 (Wave 26.4).

Centralised configuration of which teams the worker pipeline tracks.
Today the daemon hard-codes Karmine Corp as the only `is_tracked=true`
team ; this module is the seam to extend that to G2 / FNC / KOI / SK
/ TH / etc. without touching every module.

Each entry carries :
  * `code`        — short team code (KC, G2, FNC, ...).
  * `name`        — display name.
  * `region`      — LEC / LCS / LCK / LPL / LTA / LJL / VCS / PCS.
  * `priority`    — 100 = headline (KC, the pilot V0 team) ;
                    50 = co-tracked siblings (G2, FNC) ;
                    10 = best-effort historic. Drives clipper
                    fan-out + UI surfacing order.
  * `tip_url`     — V40 creator donation link (per-player URLs
                    live on the players table — see migration 057).
  * `discord_webhook_env` — optional env var name for a
                    team-specific Discord webhook ; falls back to
                    the global KCKILLS_DISCORD_WEBHOOK.

The frontend will read `is_tracked=true` rows from `teams` (added
in migration 047 / 056) for the team-picker chip in the chip-bar
(V47 UI). Keep the SQL row + this constant in sync.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TrackedTeam:
    code: str
    name: str
    region: str
    priority: int
    tip_url: str | None = None
    discord_webhook_env: str | None = None


TRACKED_TEAMS: list[TrackedTeam] = [
    # ─── LEC headline ────────────────────────────────────────────
    TrackedTeam(
        code="KC",
        name="Karmine Corp",
        region="LEC",
        priority=100,
        discord_webhook_env="KCKILLS_DISCORD_WEBHOOK",
    ),
    # ─── LEC siblings (V47 expansion targets) ────────────────────
    TrackedTeam(code="G2", name="G2 Esports", region="LEC", priority=50),
    TrackedTeam(code="FNC", name="Fnatic", region="LEC", priority=50),
    TrackedTeam(code="MAD", name="MAD Lions KOI", region="LEC", priority=40),
    TrackedTeam(code="TH", name="Team Heretics", region="LEC", priority=40),
    TrackedTeam(code="SK", name="SK Gaming", region="LEC", priority=30),
    TrackedTeam(code="VIT", name="Team Vitality", region="LEC", priority=30),
    TrackedTeam(code="GX", name="GIANTX", region="LEC", priority=20),
    # ─── V48 — international regions ─────────────────────────────
    TrackedTeam(code="T1", name="T1", region="LCK", priority=20),
    TrackedTeam(code="GEN", name="Gen.G", region="LCK", priority=20),
    TrackedTeam(code="HLE", name="Hanwha Life", region="LCK", priority=15),
    TrackedTeam(code="DK", name="Dplus KIA", region="LCK", priority=15),
    TrackedTeam(code="C9", name="Cloud9", region="LCS", priority=15),
    TrackedTeam(code="TL", name="Team Liquid", region="LCS", priority=15),
    TrackedTeam(code="FLY", name="FlyQuest", region="LCS", priority=10),
    TrackedTeam(code="100T", name="100 Thieves", region="LCS", priority=10),
    TrackedTeam(code="JDG", name="JD Gaming", region="LPL", priority=15),
    TrackedTeam(code="BLG", name="Bilibili Gaming", region="LPL", priority=15),
    TrackedTeam(code="WBG", name="Weibo Gaming", region="LPL", priority=10),
]


def by_code(code: str) -> TrackedTeam | None:
    for t in TRACKED_TEAMS:
        if t.code == code:
            return t
    return None


def by_region(region: str) -> list[TrackedTeam]:
    return [t for t in TRACKED_TEAMS if t.region == region]


def headline_team() -> TrackedTeam:
    """The single highest-priority tracked team. Drives the homepage
    hero, the daily Discord report's primary section, and the OG
    image generator's default branding."""
    sorted_teams = sorted(
        TRACKED_TEAMS, key=lambda t: t.priority, reverse=True
    )
    return sorted_teams[0]
