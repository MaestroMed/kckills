"""
BACKFILL ROSTERS — Pull players from lolesports API for all LEC teams.

Required for the Clip VS feature (compare KC kills against G2/FNC/etc.
solo kills). Today we only have KC + alumni in players table.
"""
import sys, httpx, os, time
from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from services.supabase_client import safe_select, safe_insert, safe_update

API = "https://esports-api.lolesports.com/persisted/gw"
KEY = os.environ.get("LOL_ESPORTS_API_KEY", "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z")
HEADERS = {"x-api-key": KEY}


_TEAMS_CACHE: list[dict] | None = None

def _all_lec_teams() -> list[dict]:
    """Fetch ALL LEC teams once and cache."""
    global _TEAMS_CACHE
    if _TEAMS_CACHE is not None:
        return _TEAMS_CACHE
    try:
        r = httpx.get(f"{API}/getTeams", params={"hl": "fr-FR"}, headers=HEADERS, timeout=15)
        teams = r.json().get("data", {}).get("teams", [])
        _TEAMS_CACHE = [t for t in teams if (t.get("homeLeague") or {}).get("name") == "LEC"]
    except Exception:
        _TEAMS_CACHE = []
    return _TEAMS_CACHE


def get_team_full(team_code: str) -> dict | None:
    """Get full team data with player roster, by team CODE (KC, G2, etc.)."""
    teams = _all_lec_teams()
    # Match by code, prefer exact match. KC could match KC + KCB so be precise.
    for t in teams:
        if t.get("code") == team_code:
            return t
    return None


def role_normalize(role: str | None) -> str | None:
    if not role:
        return None
    r = role.lower()
    if r in ("top",): return "top"
    if r in ("jungle", "jng"): return "jungle"
    if r in ("mid", "middle"): return "mid"
    if r in ("bot", "bottom", "adc"): return "bottom"
    if r in ("sup", "support"): return "support"
    return None


def main():
    print("=== BACKFILL ROSTERS LEC ===\n")

    teams = safe_select("teams", "id,external_id,code,name,is_tracked") or []
    print(f"Teams in DB: {len(teams)}")

    inserted_total = 0
    updated_total = 0

    for team in teams:
        code = team.get("code", "?")
        if not code or code == "?":
            continue

        # Lookup by team code (more reliable than external_id placeholders)
        team_full = get_team_full(code)
        if not team_full:
            # Some external_ids in our DB are placeholders like "team_g2"
            # — we need to find the real lolesports team ID
            print(f"  {code}: no API match (external_id={ext_id})")
            continue

        players = team_full.get("players", []) or []
        print(f"\n  {code} ({team_full.get('name')}): {len(players)} players")

        # Get logo URL + correct external_id
        logo_url = team_full.get("image")
        api_team_id = team_full.get("id")
        team_patch = {}
        if logo_url and team.get("logo_url") != logo_url:
            team_patch["logo_url"] = logo_url
        if api_team_id and not team.get("external_id", "").isdigit():
            team_patch["external_id"] = api_team_id
        if team_patch:
            safe_update("teams", team_patch, "id", team["id"])

        for p in players:
            ign = p.get("summonerName") or p.get("firstName") or "?"
            real_name = " ".join(filter(None, [p.get("firstName"), p.get("lastName")])) or None
            role = role_normalize(p.get("role"))
            image_url = p.get("image")
            ext_pid = p.get("id") or f"{ext_id}_{ign.lower()}"

            existing = safe_select("players", "id,team_id", external_id=ext_pid)
            if existing:
                # Update team association if needed
                if existing[0].get("team_id") != team["id"]:
                    safe_update("players", {"team_id": team["id"]}, "id", existing[0]["id"])
                    updated_total += 1
                continue

            # Check if player exists by ign (legacy)
            by_ign = safe_select("players", "id,team_id", ign=ign) or []
            if by_ign:
                # Update with team_id + image
                safe_update("players", {
                    "team_id": team["id"],
                    "image_url": image_url,
                    "real_name": real_name,
                    "role": role,
                    "external_id": ext_pid,
                }, "id", by_ign[0]["id"])
                updated_total += 1
                continue

            # Insert new
            safe_insert("players", {
                "external_id": ext_pid,
                "team_id": team["id"],
                "ign": ign,
                "real_name": real_name,
                "role": role,
                "image_url": image_url,
            })
            inserted_total += 1
            print(f"    + {ign} ({role or '?'}) — {real_name or '?'}")

        time.sleep(0.5)

    print(f"\n{'='*50}")
    print(f"Inserted: {inserted_total} players")
    print(f"Updated: {updated_total} players")


if __name__ == "__main__":
    main()
