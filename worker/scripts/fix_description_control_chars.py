# -*- coding: utf-8 -*-
"""
FIX_DESCRIPTION_CONTROL_CHARS — nettoie les descriptions IA qui portent des
caractères de contrôle (constat du 23/09/2026 : 16 kills du lot du 23/04,
« s\\x03ecurise », « rivi\\x03ere » ; traductions coréennes faites UNIQUEMENT
de caractères de contrôle). Ces caractères sont interdits en XML 1.0 (le
sitemap vidéo devenait invalide) et s'affichent en carrés sur le site.

Règles :
  * caractères de contrôle (hors \\t \\n \\r) retirés ;
  * une traduction dont il ne reste presque rien de lisible (< 40 % de
    lettres) passe à NULL : le site retombe alors sur la description FR ;
  * seuls les champs texte ai_description* sont touchés (jamais statut ni hash).

  * --repair : les textes FR/ES/EN abîmés (lettres perdues, mojibake) sont
    réécrits à l'identique avec les bons accents par Gemini flash-lite
    (appel texte, coût négligeable) ; sans --repair ils sont seulement nettoyés.

Usage : python scripts/fix_description_control_chars.py [--repair] [--apply]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio  # noqa: E402

from services.supabase_client import get_db, safe_update  # noqa: E402

COLS = ("ai_description", "ai_description_fr", "ai_description_en", "ai_description_ko", "ai_description_es")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MOJIBAKE = re.compile(r"[©¢\xa0]|Ã.")
LANG = {"ai_description": "français", "ai_description_fr": "français",
        "ai_description_es": "espagnol", "ai_description_en": "anglais"}
REPAIR_PROMPT = (
    "Ce texte en {lang} a été abîmé par un bug d'encodage : accents perdus ou remplacés "
    "par des caractères parasites, lettres manquantes. Rétablis le texte correct, mot pour mot, "
    "avec les bons accents. Ne change ni le sens, ni les noms propres, ni la longueur. "
    'Réponds UNIQUEMENT en JSON : {{"text": "..."}}\n\nTexte abîmé : {raw!r}'
)


async def repair(raw: str, lang: str) -> str | None:
    from services import gemini_client
    res = await gemini_client.analyze(REPAIR_PROMPT.format(lang=lang, raw=raw), model="gemini-3.5-flash-lite")
    if isinstance(res, list):
        res = next((x for x in res if isinstance(x, dict)), None)
    text = (res or {}).get("text") if isinstance(res, dict) else None
    return text.strip() if text and not CONTROL.search(text) else None


def clean(value: str) -> str | None:
    stripped = CONTROL.sub("", value).strip()
    letters = sum(1 for ch in stripped if ch.isalpha())
    if not stripped or letters < 0.4 * max(1, len(value)):
        return None
    return stripped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--repair", action="store_true")
    args = ap.parse_args()
    db = get_db()
    client = db._get_client()
    fixes: list[tuple[str, dict]] = []
    offset = 0
    while True:
        r = client.get(f"{db.base}/kills", params={
            "select": "id," + ",".join(COLS), "order": "id", "limit": "1000", "offset": str(offset)})
        r.raise_for_status()
        rows = r.json() or []
        for row in rows:
            patch = {c: clean(row[c]) for c in COLS
                     if row.get(c) and (CONTROL.search(row[c]) or (c != "ai_description_ko" and MOJIBAKE.search(row[c])))}
            if patch and args.repair:
                for c in list(patch):
                    if c in LANG and patch[c]:
                        fixed = asyncio.run(repair(row[c], LANG[c]))
                        if fixed:
                            patch[c] = fixed
            if patch:
                fixes.append((row["id"], patch))
        if len(rows) < 1000:
            break
        offset += 1000
    print(f"{len(fixes)} kill(s) à nettoyer")
    for kid, patch in fixes:
        print(" ", kid[:8], {k: (v[:60] + "…" if v and len(v) > 60 else v) for k, v in patch.items()})
        if args.apply:
            safe_update("kills", patch, "id", kid)
    print("appliqué" if args.apply else "dry-run (ajoute --apply pour écrire)")


if __name__ == "__main__":
    main()
