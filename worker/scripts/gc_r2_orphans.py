"""gc_r2_orphans.py — reference-based garbage collection of R2 clip assets.

THE TRAP (memory: r2-gc-clip-url-trap): kills.clip_url_* often points at the
FLAT v1 object (clips/<kill_id>_h.mp4) whose kill_assets row is marked
is_current=FALSE, while the manifest points at a later /vN/ object. The
frontend serves assets_manifest first and FALLS BACK to clip_url_* when the
manifest is NULL. So deleting by is_current=false destroys objects the site
serves. NEVER filter on is_current.

Safe rule: an asset row is an ORPHAN only if NONE of its candidate paths
(r2_key AND the path derived from its url) appear in the reference set built
from EVERY clips.kckills.com URL found anywhere in the database:
  - kills.assets_manifest (all entries, all keys that look like URLs)
  - every text/jsonb column of every OTHER table whose values carry the
    clips domain (discovered via the PostgREST OpenAPI schema, so new
    tables/columns are picked up automatically)

Modes:
  --analyze (default)  compute orphan set, size estimate, HEAD-check samples
  --delete             delete orphans in batches (R2 object(s) + row), with a
                       post-batch health check on referenced URLs; ABORTS if
                       any referenced sample stops answering 200
  --limit N            cap deletions (default: all orphans)

Usage:
  python scripts/gc_r2_orphans.py                # analyze only
  python scripts/gc_r2_orphans.py --delete --limit 500   # careful first batch
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_WORKER_ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(_WORKER_ROOT / ".env")

SB_URL = (os.environ.get("SUPABASE_URL")
          or "https://guasqaistzpeapxoyxrc.supabase.co").rstrip("/")
SB_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
          or os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
SB_H = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}

CLIP_HOSTS = ("https://clips.kckills.com/", "http://clips.kckills.com/")
PAGE = 500
# Fallback size estimates when size_bytes is NULL (recon measurements).
EST_BYTES = {"horizontal": 19_000_000, "vertical": 19_000_000,
             "vertical_low": 5_900_000, "thumbnail": 210_000}


def url_to_path(u: str | None) -> str | None:
    if not u:
        return None
    for h in CLIP_HOSTS:
        if u.startswith(h):
            return u[len(h):].split("?")[0]
    return None


def sb_count(table: str) -> int:
    r = requests.head(f"{SB_URL}/rest/v1/{table}",
                      headers={**SB_H, "Prefer": "count=exact"},
                      params={"select": "*", "limit": "1"}, timeout=30)
    try:
        return int(r.headers.get("Content-Range", "/0").split("/")[-1])
    except ValueError:
        return 0


def sb_page(table: str, params: dict) -> list[dict]:
    """Paginate with a stable ORDER (unordered offset pagination can shuffle
    rows between pages → a missed reference here means deleting a live
    object). Falls back to no order for tables without an `id` column."""
    out, offset = [], 0
    use_order = True
    while True:
        p = {**params, "limit": str(PAGE), "offset": str(offset)}
        if use_order:
            p["order"] = "id"
        # Retry avec backoff : un timeout réseau ne doit pas faire échouer
        # le GC (et surtout jamais produire une page vide silencieuse, qui
        # se traduirait par des références manquantes = objets vivants
        # classés orphelins).
        r = None
        for attempt in range(4):
            try:
                r = requests.get(f"{SB_URL}/rest/v1/{table}", headers=SB_H,
                                 params=p, timeout=180)
                break
            except Exception as e:
                if attempt == 3:
                    raise RuntimeError(
                        f"pagination {table} offset={offset} échouée après "
                        f"4 tentatives ({str(e)[:100]}) — GC ABANDONNÉ"
                    ) from e
                time.sleep(2 ** attempt)
        if r.status_code == 400 and use_order and offset == 0:
            use_order = False
            continue
        r.raise_for_status()
        page = r.json() or []
        out += page
        if len(page) < PAGE:
            return out
        offset += len(page)


def harvest_urls(obj) -> set[str]:
    """Recursively pull every clips.kckills.com path out of any JSON value."""
    found: set[str] = set()
    if isinstance(obj, str):
        p = url_to_path(obj)
        if p:
            found.add(p)
    elif isinstance(obj, dict):
        for v in obj.values():
            found |= harvest_urls(v)
    elif isinstance(obj, list):
        for v in obj:
            found |= harvest_urls(v)
    return found


# Column names that plausibly carry an asset URL. Big telemetry tables are
# only scanned on these columns (egress control); small tables get a full
# string/jsonb scan so exotic column names still get caught.
_URLISH = ("url", "manifest", "image", "thumb", "clip", "vod", "asset",
           "media", "poster", "og_", "key")
_FULL_SCAN_MAX_ROWS = 2000


def build_reference_set() -> set[str]:
    refs: set[str] = set()

    spec = requests.get(f"{SB_URL}/rest/v1/", headers=SB_H, timeout=60).json()
    defs = spec.get("definitions", {})
    for table, td in sorted(defs.items()):
        if table == "kill_assets":       # the GC target itself
            continue
        if table.startswith("v_"):       # views mirror base tables
            continue
        props = td.get("properties", {})
        str_cols = [c for c, cd in props.items()
                    if (cd.get("type") == "string"
                        or cd.get("format") in ("jsonb", "json"))
                    and c != "search_vector"]
        if not str_cols:
            continue
        n = sb_count(table)
        if n == 0:
            continue
        if n <= _FULL_SCAN_MAX_ROWS:
            cols = str_cols
        else:
            cols = [c for c in str_cols
                    if any(k in c.lower() for k in _URLISH)]
            if not cols:
                continue
        try:
            rows = sb_page(table, {"select": ",".join(cols)})
        except Exception as e:
            # LEÇON DE L'INCIDENT QC (2026-07-25) : un scan raté ne doit
            # JAMAIS se traduire par « moins de références » — ici ça
            # transformerait des objets VIVANTS en orphelins supprimables.
            # Un GC qui n'a pas pu lire toutes les sources n'a pas le droit
            # de conclure. On abandonne bruyamment.
            raise RuntimeError(
                f"scan de {table} impossible ({str(e)[:120]}) — GC ABANDONNÉ : "
                "un ensemble de références incomplet rendrait des objets "
                "servis par le site éligibles à la suppression."
            ) from e
        before = len(refs)
        for row in rows:
            refs |= harvest_urls(row)
        got = len(refs) - before
        if got:
            print(f"  {table}: +{got} refs ({len(rows)} rows, "
                  f"{'full' if n <= _FULL_SCAN_MAX_ROWS else 'urlish'} scan)")
    return refs


def load_assets() -> list[dict]:
    return sb_page("kill_assets", {
        "select": "id,kill_id,type,version,url,r2_key,is_current,size_bytes"})


def head_ok(url: str) -> int | None:
    try:
        return requests.head(url, timeout=20, allow_redirects=True).status_code
    except Exception:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--delete", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--batch", type=int, default=200)
    args = ap.parse_args()

    print("=" * 64)
    print("  gc_r2_orphans — reference-based R2 GC (jamais par is_current)")
    print(f"  mode: {'DELETE' if args.delete else 'ANALYZE (dry-run)'}")
    print("=" * 64)

    print("\n[1/4] Construction du set de références (toutes tables)…")
    refs = build_reference_set()
    print(f"  => {len(refs)} paths référencés")
    if len(refs) < 1000:
        print("  ⚠ set de références suspicieusement petit — ABORT par sécurité")
        return

    print("\n[2/4] Chargement kill_assets…")
    assets = load_assets()
    print(f"  => {len(assets)} rows")

    print("\n[3/4] Classification…")
    orphans, kept = [], []
    for a in assets:
        cand = {a.get("r2_key"), url_to_path(a.get("url"))}
        cand.discard(None)
        if cand & refs:
            kept.append(a)
        else:
            orphans.append(a)

    def est(a):
        return a.get("size_bytes") or EST_BYTES.get(a.get("type"), 12_000_000)
    tot = sum(est(a) for a in orphans)
    by_cur = {True: 0, False: 0}
    by_type: dict[str, int] = {}
    for a in orphans:
        by_cur[bool(a.get("is_current"))] += 1
        by_type[a.get("type") or "?"] = by_type.get(a.get("type") or "?", 0) + 1
    print(f"  référencés (INTOUCHABLES) : {len(kept)}")
    print(f"  orphelins                 : {len(orphans)}  (~{tot/1e9:.1f} GB estimés)")
    print(f"    par is_current : {by_cur}")
    print(f"    par type       : {by_type}")
    cur_orph = by_cur[True]
    if cur_orph:
        print(f"  ⚠ {cur_orph} orphelins sont is_current=TRUE — attendu si le kill")
        print("    a été re-clippé sans refresh manifest ; vérifiés par HEAD ci-dessous.")

    print("\n[4/4] Vérification HEAD sur échantillons…")
    rnd = random.Random(42)
    ref_sample = rnd.sample(kept, min(10, len(kept)))
    orp_sample = rnd.sample(orphans, min(10, len(orphans)))
    print("  — 10 RÉFÉRENCÉS (doivent répondre 200) :")
    ref_bad = 0
    for a in ref_sample:
        code = head_ok(a["url"])
        if code != 200:
            ref_bad += 1
        print(f"    [{code}] {a['url'][-60:]}")
    print("  — 10 ORPHELINS (existence avant suppression) :")
    for a in orp_sample:
        u = a.get("url") or ""
        code = head_ok(u) if u else None
        vk = f"{CLIP_HOSTS[0]}{a['r2_key']}"
        code2 = head_ok(vk) if a.get("r2_key") and url_to_path(u) != a.get("r2_key") else "="
        print(f"    [url:{code} key:{code2}] v{a.get('version')} cur={a.get('is_current')} {a['r2_key'][-55:]}")

    if ref_bad:
        print(f"\n⚠ {ref_bad}/10 référencés ne répondent PAS 200 — investiguer avant tout delete.")

    if not args.delete:
        print("\n(dry-run — aucun delete. Relancer avec --delete pour purger.)")
        # persist the orphan ids for the delete pass / audit
        out = _WORKER_ROOT / "gc_r2_orphans_report.json"
        out.write_text(json.dumps({
            "orphan_count": len(orphans), "kept_count": len(kept),
            "est_gb": round(tot / 1e9, 1),
            "orphan_ids": [a["id"] for a in orphans]}), encoding="utf-8")
        print(f"rapport: {out}")
        return

    if ref_bad:
        print("ABORT delete: des assets référencés ne répondent pas.")
        return

    # ── DELETE mode ──────────────────────────────────────────────────
    from services.storage_factory import get_storage_backend  # noqa: E402
    storage = get_storage_backend()
    if storage is None:
        print("FATAL: storage R2 non configuré")
        return

    # SAFETY: only archived versions. current=true orphans belong to kills
    # that are mid-pipeline or whose manifest lags behind a re-clip — deleting
    # them would break in-flight work or a future manifest refresh. An
    # archived (is_current=false) unreferenced version can never be served
    # again, so it is the only class that is safe to purge.
    todo = [a for a in orphans if not a.get("is_current")]
    skipped_current = len(orphans) - len(todo)
    if skipped_current:
        print(f"\n  ({skipped_current} orphelins is_current=TRUE exclus par sécurité)")
    if args.limit is not None:
        todo = todo[:args.limit]
    print(f"\nSuppression de {len(todo)} orphelins archivés par lots de {args.batch}…")
    deleted = failed = 0
    watch = [a["url"] for a in rnd.sample(kept, min(5, len(kept)))]
    for i in range(0, len(todo), args.batch):
        batch = todo[i:i + args.batch]
        for a in batch:
            keys = {a.get("r2_key"), url_to_path(a.get("url"))}
            keys.discard(None)
            try:
                for k in keys:
                    storage.delete(k)
                r = requests.delete(
                    f"{SB_URL}/rest/v1/kill_assets",
                    headers={**SB_H, "Prefer": "return=minimal"},
                    params={"id": f"eq.{a['id']}"}, timeout=30)
                r.raise_for_status()
                deleted += 1
            except Exception as e:
                failed += 1
                print(f"  [err] {a['id'][:8]}: {str(e)[:100]}")
        # post-batch health check: referenced clips must still answer
        bad = [u for u in watch if head_ok(u) != 200]
        print(f"  lot {i//args.batch+1}: deleted={deleted} failed={failed} "
              f"health={'OK' if not bad else 'FAIL'}")
        if bad:
            print("  ⚠ ABORT: un clip référencé ne répond plus:", bad[0])
            return
        time.sleep(1)

    print(f"\nBILAN: deleted={deleted} failed={failed} (~{sum(est(a) for a in todo[:deleted])/1e9:.1f} GB libérés)")


if __name__ == "__main__":
    main()
