"""
RECOMPUTE — `kills.champion_class` from a static champion -> class map.

Why
---
Audit shows 15/57 champions get INCONSISTENT class assignment from Gemini
(MonkeyKing tagged {assassin: 8, skirmisher: 6, bruiser: 3} across runs,
Ambessa tagged across 4 different classes, etc.). Champion class is a
static attribute — same champion in every clip should have the same
class. Gemini is guessing from visuals on each kill independently, with
no shared state.

Fix: hardcoded canonical map, applied server-side. Source : Riot's
official champion subclasses + community consensus where Riot lists a
champion under multiple classes (we pick the dominant one for our
roster context, e.g. Wukong = bruiser, not assassin).

Idempotent. Champions absent from the map keep whatever Gemini wrote
(no destructive overwrite).
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from services.supabase_client import safe_select, safe_update  # noqa: E402

# ─── Canonical champion -> class map ─────────────────────────────────────
# Limited to the classes the schema accepts (see migration 004):
#   assassin | bruiser | mage | marksman | tank | enchanter | skirmisher
#
# When Riot lists a champion as multi-class (e.g. Wukong = Fighter +
# Slayer), we pick the one that best matches their LEC pro role this
# season. Source of truth: Riot's class taxonomy on League of Legends
# Universe + community wikis cross-checked.

CHAMPION_CLASS: dict[str, str] = {
    # ─── Assassins ───────────────────────────────────────
    "Akali": "assassin", "Akshan": "assassin", "Diana": "assassin",
    "Ekko": "assassin", "Elise": "assassin", "Evelynn": "assassin",
    "Fizz": "assassin", "Kassadin": "assassin", "Katarina": "assassin",
    "Kayn": "assassin", "KhaZix": "assassin", "LeBlanc": "assassin",
    "MasterYi": "assassin", "Naafiri": "assassin", "Nocturne": "assassin",
    "Pyke": "assassin", "Qiyana": "assassin", "Rengar": "assassin",
    "Shaco": "assassin", "Talon": "assassin", "Yone": "assassin",
    "Zed": "assassin", "Nidalee": "assassin",
    # Spelling variants (Gemini sometimes lowercases the second cap)
    "Leblanc": "assassin", "Khazix": "assassin",

    # ─── Bruisers / Fighters ─────────────────────────────
    "Aatrox": "bruiser", "Ambessa": "bruiser", "Camille": "bruiser",
    "Darius": "bruiser", "DrMundo": "bruiser", "Garen": "bruiser",
    "Gangplank": "bruiser", "Gnar": "bruiser", "Gragas": "bruiser",
    "Hwei": "mage",  # override: Hwei is a mage despite mid presence
    "Illaoi": "bruiser", "Irelia": "bruiser", "Jax": "bruiser",
    "JarvanIV": "bruiser", "Jayce": "bruiser", "KSante": "bruiser",
    "Kayle": "bruiser", "Kled": "bruiser", "LeeSin": "bruiser",
    "Mordekaiser": "bruiser", "MonkeyKing": "bruiser",
    "Nasus": "bruiser", "Olaf": "bruiser", "Pantheon": "bruiser",
    "Renekton": "bruiser", "Rumble": "bruiser", "Sett": "bruiser",
    "Shyvana": "bruiser", "Trundle": "bruiser", "Udyr": "bruiser",
    "Urgot": "bruiser", "Vi": "bruiser", "Viego": "bruiser",
    "Volibear": "bruiser", "Warwick": "bruiser", "XinZhao": "bruiser",
    "Yorick": "bruiser",

    # ─── Mages ───────────────────────────────────────────
    "Ahri": "mage", "Anivia": "mage", "Annie": "mage",
    "AurelionSol": "mage", "Aurora": "mage", "Azir": "mage",
    "Brand": "mage", "Cassiopeia": "mage", "Heimerdinger": "mage",
    "Karthus": "mage", "Lissandra": "mage", "Lux": "mage",
    "Malzahar": "mage", "Morgana": "mage", "Neeko": "mage",
    "Orianna": "mage", "Ryze": "mage", "Swain": "mage",
    "Sylas": "mage", "Syndra": "mage", "Taliyah": "mage",
    "TwistedFate": "mage", "Veigar": "mage", "Vex": "mage",
    "Viktor": "mage", "Vladimir": "mage", "Xerath": "mage",
    "Ziggs": "mage", "Zilean": "mage", "Zoe": "mage",
    "Zyra": "mage", "Karma": "mage",  # Karma is multi-class, mage in mid

    # ─── Marksmen ────────────────────────────────────────
    "Aphelios": "marksman", "Ashe": "marksman", "Caitlyn": "marksman",
    "Corki": "marksman", "Draven": "marksman", "Ezreal": "marksman",
    "Jhin": "marksman", "Jinx": "marksman", "KaiSa": "marksman",
    "Kaisa": "marksman", "Kalista": "marksman", "Kindred": "marksman",
    "KogMaw": "marksman", "Lucian": "marksman", "MissFortune": "marksman",
    "Nilah": "marksman", "Quinn": "marksman", "Samira": "marksman",
    "Senna": "marksman", "Sivir": "marksman", "Smolder": "marksman",
    "Tristana": "marksman", "Twitch": "marksman", "Varus": "marksman",
    "Vayne": "marksman", "Xayah": "marksman", "Yasuo": "marksman",
    "Zeri": "marksman", "Yunara": "marksman",

    # ─── Tanks ───────────────────────────────────────────
    "Alistar": "tank", "Amumu": "tank", "Braum": "tank",
    "Chogath": "tank", "Galio": "tank", "Leona": "tank",
    "Malphite": "tank", "Maokai": "tank", "Nautilus": "tank",
    "Nunu": "tank", "Ornn": "tank", "Poppy": "tank",
    "Rammus": "tank", "Rell": "tank", "Sejuani": "tank",
    "Shen": "tank", "Singed": "tank", "Sion": "tank",
    "Skarner": "tank", "TahmKench": "tank", "Thresh": "tank",
    "Zac": "tank",

    # ─── Enchanters ──────────────────────────────────────
    "Bard": "enchanter", "Janna": "enchanter", "Lulu": "enchanter",
    "Milio": "enchanter", "Nami": "enchanter", "Rakan": "enchanter",
    "Renata": "enchanter", "Seraphine": "enchanter", "Sona": "enchanter",
    "Soraka": "enchanter", "Taric": "enchanter", "Yuumi": "enchanter",

    # ─── Skirmishers (high-mobility duelists) ────────────
    "Belveth": "skirmisher", "Fiora": "skirmisher", "Gwen": "skirmisher",
    "Riven": "skirmisher", "Tryndamere": "skirmisher",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    print(f"-> loading published kills (canonical map covers {len(CHAMPION_CLASS)} champions)")
    rows = safe_select("kills", "id, killer_champion, champion_class", status="published") or []
    if args.limit:
        rows = rows[: args.limit]

    stats = Counter()
    transitions = Counter()
    unknown = Counter()

    for r in rows:
        champ = r.get("killer_champion")
        if not champ:
            stats["no_champion"] += 1
            continue
        canonical = CHAMPION_CLASS.get(champ)
        old = r.get("champion_class")
        if not canonical:
            unknown[champ] += 1
            stats["champion_unknown_in_map"] += 1
            continue
        if old == canonical:
            stats["already_correct"] += 1
            continue
        transitions[(champ, old or "NULL", canonical)] += 1
        if args.dry_run:
            stats["would_update"] += 1
            continue
        safe_update("kills", {"champion_class": canonical}, "id", r["id"])
        stats["updated"] += 1

    print()
    print("-" * 60)
    print("CHAMPION CLASS RECOMPUTE")
    print("-" * 60)
    for k in sorted(stats.keys()):
        print(f"   {k:30s} {stats[k]}")

    if transitions:
        print()
        print("--- transitions per champion (count) ---")
        # Aggregate by champion
        per_champ: dict[str, list[tuple[str, str, int]]] = {}
        for (champ, old, new), n in transitions.items():
            per_champ.setdefault(champ, []).append((old, new, n))
        for champ in sorted(per_champ.keys()):
            entries = sorted(per_champ[champ], key=lambda x: -x[2])
            print(f"   {champ:<14s} -> {entries[0][1]} (was: {', '.join(f'{e[0]}x{e[2]}' for e in entries)})")

    if unknown:
        print()
        print("--- champions absent from the canonical map ---")
        for champ, n in unknown.most_common():
            print(f"   {champ:<20s} {n} kills (kept Gemini's value)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
