"""
backup_supabase.py — Weekly pg_dump of the production Supabase DB → R2.

Why this script exists
──────────────────────
Supabase free tier has ZERO automatic backups. The 2026-04-28 audit
found the project dashboard reports "No backups" — meaning a single
DB corruption / dropped table / accidental DELETE wipes 7 400+ kills
+ the entire pipeline state with no recovery path. Even the paid
Pro tier only does daily snapshots — for a worker-driven pipeline
that runs against the same DB 24/7, we want our own off-Supabase
copy in case the project itself disappears (account closure, region
outage, etc.).

What it does
────────────
1. Calls `pg_dump` against the Supabase pooler with `--format=custom`
   (smaller, faster restore) and `--no-owner --no-privileges` (so
   the dump can be restored into a fresh empty project).
2. Compresses the output with gzip in-process (saves ~70% R2 storage).
3. Uploads to R2 under `backups/supabase/YYYY-MM-DD-HHMMSS.dump.gz`.
4. Keeps the last `RETENTION_KEEP` backups, deletes older ones.
5. Sends a Discord webhook ping with size + duration.
6. Writes a heartbeat to `health_checks` so the watchdog knows backups
   are running.

Run weekly via a scheduled task / cron / Vercel cron / pg_cron :
  Sunday 04:00 UTC is a good choice — KC matches don't run then.

Usage
─────
  python worker/scripts/backup_supabase.py [--dry-run] [--keep N]

`--dry-run` reports what would be uploaded without writing R2 or
deleting old backups.
`--keep` overrides the default retention (default : 8 weekly backups
= ~2 months of history).

Setup
─────
Requires `pg_dump` 17 in PATH (matches the Supabase Postgres version
once we upgrade). The `.env` must contain :
  SUPABASE_DB_URL      (postgres://... pooled connection string)
  R2_ACCOUNT_ID        (Cloudflare R2 account ID)
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME       (e.g. kckills-clips — backups go in a separate prefix)
  DISCORD_WATCHDOG_URL (optional — webhook for backup status)

The Supabase DB URL is in the project Settings → Database → Connection
string (use the "Session" pool mode for pg_dump compatibility, NOT the
"Transaction" pool mode which can't handle multi-statement transactions).
"""

from __future__ import annotations

import argparse
import datetime
import gzip
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Allow `from services.X` imports when run from the repo root or worker/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import boto3  # noqa: E402  (loaded lazily by services.r2_client too)
import httpx  # noqa: E402

# Console Windows en cp1252 : les accents/flèches des messages plantaient
# le script AVANT toute sauvegarde. Un backup ne doit jamais échouer sur
# un problème d'affichage.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RETENTION_KEEP_DEFAULT = 8  # weekly backups → 2 months


def env_or_die(key: str) -> str:
    """Read an env var from process env or worker/.env."""
    if val := os.environ.get(key):
        return val
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError(f"Missing required env var : {key}")


def env_or_none(key: str) -> str | None:
    try:
        return env_or_die(key)
    except RuntimeError:
        return None


# ═══════════════════════════════════════════════════════════════════════
# REPLI LOGIQUE — export NDJSON gzip via PostgREST, poussé sur R2.
# ═══════════════════════════════════════════════════════════════════════

_BACKUP_TABLES = [
    "kills", "games", "matches", "tournaments", "players", "teams",
    "game_events", "clip_ledger", "kill_assets", "game_vod_sources",
    "ratings", "comments", "profiles",
]


def _logical_backup(*, dry_run: bool = False, keep: int = 7) -> int:
    """Sauvegarde logique. Retourne un code de sortie (0 = OK)."""
    import gzip
    import json as _json
    from pathlib import Path as _Path
    import httpx as _httpx

    sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
    from services.supabase_client import get_db

    db = get_db()
    if db is None:
        print("  ÉCHEC : pas de connexion Supabase")
        return 2

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    out_dir = _Path(__file__).resolve().parent.parent / "backups" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "mode": "logical_postgrest", "tables": {}, "errors": []}
    t0 = time.time()

    for table in _BACKUP_TABLES:
        path = out_dir / f"{table}.ndjson.gz"
        try:
            n, offset = 0, 0
            with gzip.open(path, "wt", encoding="utf-8") as f:
                while True:
                    params = {"select": "*", "offset": str(offset), "limit": "1000"}
                    r = _httpx.get(f"{db.base}/{table}", headers=db.headers,
                                   params=params, timeout=120)
                    r.raise_for_status()
                    rows = r.json()
                    if not isinstance(rows, list) or not rows:
                        break
                    for row in rows:
                        f.write(_json.dumps(row, ensure_ascii=False, default=str) + "\n")
                    n += len(rows)
                    if len(rows) < 1000:
                        break
                    offset += 1000
            manifest["tables"][table] = {"rows": n, "bytes": path.stat().st_size}
            print(f"    {table:20s} {n:>7} lignes  {path.stat().st_size/1024:.0f} KB")
        except Exception as e:
            manifest["errors"].append(f"{table}: {str(e)[:150]}")
            print(f"    {table:20s} ÉCHEC {str(e)[:70]}")

    manifest["elapsed_s"] = round(time.time() - t0, 1)
    (out_dir / "manifest.json").write_text(
        _json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    if manifest["errors"]:
        print(f"  ÉCHEC : {len(manifest['errors'])} table(s) en erreur")
        return 1
    total = sum(v["rows"] for v in manifest["tables"].values())
    print(f"  local OK — {total} lignes en {manifest['elapsed_s']}s")

    if dry_run:
        print("  DRY-RUN : pas d'upload")
        return 0

    from services.storage_factory import get_storage_backend
    storage = get_storage_backend()
    prefix = f"backups/logical/{stamp}"
    for f in sorted(out_dir.iterdir()):
        storage.upload_file(
            key=f"{prefix}/{f.name}", file_path=str(f),
            content_type="application/gzip" if f.suffix == ".gz" else "application/json",
            cache_control="private, no-store",
        )

    # PREUVE : on relit le manifeste depuis R2. Un backup non vérifié est un
    # backup qui n'existe pas — c'est exactement ce qui a permis à la tâche
    # planifiée de mentir pendant des mois.
    client = storage._get_client()
    obj = client.get_object(Bucket=storage._bucket, Key=f"{prefix}/manifest.json")
    remote = _json.loads(obj["Body"].read())
    if set(remote.get("tables", {})) != set(manifest["tables"]):
        print("  ÉCHEC : manifeste relu depuis R2 non conforme")
        return 1
    print(f"  R2 OK — {prefix} (manifeste relu et vérifié)")

    # rotation R2 + ménage local
    try:
        page = client.list_objects_v2(Bucket=storage._bucket, Prefix="backups/logical/")
        days = sorted({o["Key"].split("/")[2] for o in page.get("Contents", []) if o["Key"].count("/") > 2})
        for old in days[:-keep]:
            objs = client.list_objects_v2(Bucket=storage._bucket, Prefix=f"backups/logical/{old}/")
            keys = [{"Key": o["Key"]} for o in objs.get("Contents", [])]
            if keys:
                client.delete_objects(Bucket=storage._bucket, Delete={"Objects": keys})
            print(f"    rotation : {old} purgé")
    except Exception as e:
        print(f"    rotation ignorée : {str(e)[:70]}")
    base_dir = out_dir.parent
    for d in sorted([p for p in base_dir.iterdir() if p.is_dir()])[:-2]:
        for f in d.iterdir():
            f.unlink()
        d.rmdir()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Report only — don't write R2 or delete")
    parser.add_argument("--keep", type=int, default=RETENTION_KEEP_DEFAULT,
                        help=f"Keep last N backups (default {RETENTION_KEEP_DEFAULT})")
    args = parser.parse_args()

    # ─── 1. pg_dump dispo ? Sinon REPLI LOGIQUE ──────────────────────
    # Audit 2.0 : pg_dump n'est PAS installé sur le PC et SUPABASE_DB_URL
    # n'existe pas dans le .env — donc ce script sortait en erreur depuis
    # toujours, pendant que la tâche planifiée affichait vert. Résultat :
    # zéro sauvegarde, jamais, de 15 724 kills. Plutôt que d'exiger une
    # installation Postgres, on bascule sur un export LOGIQUE via PostgREST
    # (clé service role, déjà présente) : NDJSON gzip par table, poussé sur
    # R2. Ce n'est pas un pg_dump (pas de schéma) — mais le schéma vit dans
    # supabase/migrations/ sous git, donc migrations + données = restauration
    # complète. Un filet imparfait qui existe bat un filet parfait qui n'a
    # jamais tourné.
    if shutil.which("pg_dump") is None or not os.getenv("SUPABASE_DB_URL"):
        reason = ("pg_dump absent" if shutil.which("pg_dump") is None
                  else "SUPABASE_DB_URL absente")
        print(f"  {reason} → repli sur l'export logique PostgREST")
        sys.exit(_logical_backup(dry_run=args.dry_run, keep=args.keep))

    db_url = env_or_die("SUPABASE_DB_URL")
    r2_account = env_or_die("R2_ACCOUNT_ID")
    r2_key = env_or_die("R2_ACCESS_KEY_ID")
    r2_secret = env_or_die("R2_SECRET_ACCESS_KEY")
    r2_bucket = env_or_die("R2_BUCKET_NAME")
    discord_url = env_or_none("DISCORD_WATCHDOG_URL")

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%d-%H%M%S"
    )
    key = f"backups/supabase/{timestamp}.dump.gz"
    print(f"=== Supabase backup → R2 : {key} ===")
    print(f"  Mode : {'DRY-RUN' if args.dry_run else 'LIVE'}")

    # ─── 2. Run pg_dump → temp file ──────────────────────────────────
    started = time.time()
    with tempfile.NamedTemporaryFile(
        prefix="kckills-bak-", suffix=".dump", delete=False,
    ) as tmp:
        tmp_path = tmp.name

    try:
        print("  Running pg_dump (custom format, no owner/privileges)...")
        result = subprocess.run(
            [
                "pg_dump",
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                "--compress=0",  # we'll gzip ourselves so size is honest
                "--file", tmp_path,
                db_url,
            ],
            capture_output=True,
            text=True,
            timeout=1800,  # 30 min ceiling
        )
        if result.returncode != 0:
            stderr_tail = (result.stderr or "")[-500:]
            print(f"  ERROR: pg_dump exited {result.returncode}")
            print(f"  Stderr tail: {stderr_tail}")
            sys.exit(1)

        raw_size = os.path.getsize(tmp_path)
        print(f"  Dump complete : {raw_size / 1024 / 1024:.1f} MB raw")

        # ─── 3. Gzip in-process ──────────────────────────────────────
        gz_path = tmp_path + ".gz"
        with open(tmp_path, "rb") as src, gzip.open(gz_path, "wb",
                                                    compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
        gz_size = os.path.getsize(gz_path)
        ratio = (1 - gz_size / raw_size) * 100
        print(f"  Gzipped : {gz_size / 1024 / 1024:.1f} MB ({ratio:.0f}% saved)")

        if args.dry_run:
            print("  [--dry-run] Skipping R2 upload + retention.")
            duration = time.time() - started
            print(f"  Done in {duration:.1f}s.")
            return

        # ─── 4. Upload to R2 ─────────────────────────────────────────
        s3 = boto3.client(
            service_name="s3",
            endpoint_url=f"https://{r2_account}.r2.cloudflarestorage.com",
            aws_access_key_id=r2_key,
            aws_secret_access_key=r2_secret,
            region_name="auto",
        )
        print("  Uploading to R2...")
        with open(gz_path, "rb") as fh:
            s3.put_object(
                Bucket=r2_bucket,
                Key=key,
                Body=fh,
                ContentType="application/gzip",
                # Metadata so the backup is self-describing if you eyeball
                # the R2 dashboard. Only ASCII keys/values per S3 spec.
                Metadata={
                    "raw-size-bytes": str(raw_size),
                    "compressed-size-bytes": str(gz_size),
                    "pg-dump-format": "custom",
                    "kckills-script": "backup_supabase.py",
                },
            )
        print(f"  Uploaded : {key}")

        # ─── 5. Retention — keep N most recent ───────────────────────
        print(f"  Retention check (keep={args.keep})...")
        resp = s3.list_objects_v2(
            Bucket=r2_bucket,
            Prefix="backups/supabase/",
        )
        all_keys = sorted(
            [(o["Key"], o["LastModified"]) for o in resp.get("Contents", [])],
            key=lambda x: x[1],
            reverse=True,
        )
        to_delete = all_keys[args.keep:]
        for k, _ in to_delete:
            s3.delete_object(Bucket=r2_bucket, Key=k)
            print(f"    deleted : {k}")
        print(f"  Retention done : {len(all_keys) - len(to_delete)} kept,"
              f" {len(to_delete)} deleted.")

        # ─── 6. Heartbeat to health_checks ───────────────────────────
        try:
            from services.supabase_client import safe_upsert
            safe_upsert(
                "health_checks",
                {
                    "id": "backup_supabase",
                    "metrics": {
                        "raw_mb": round(raw_size / 1024 / 1024, 1),
                        "gz_mb": round(gz_size / 1024 / 1024, 1),
                        "key": key,
                        "kept": len(all_keys) - len(to_delete),
                    },
                },
                on_conflict="id",
            )
        except Exception as e:
            print(f"  WARN heartbeat failed : {e}")

        duration = time.time() - started
        print(f"  Done in {duration:.1f}s.")

        # ─── 7. Discord notification ─────────────────────────────────
        if discord_url:
            msg = (
                f"✅ **Supabase backup OK** — `{timestamp}`\n"
                f"  • {raw_size / 1024 / 1024:.1f} MB raw → "
                f"{gz_size / 1024 / 1024:.1f} MB gzipped ({ratio:.0f}% saved)\n"
                f"  • R2 key : `{key}`\n"
                f"  • Kept : {len(all_keys) - len(to_delete)} / deleted : {len(to_delete)}\n"
                f"  • Duration : {duration:.0f}s"
            )
            try:
                httpx.post(discord_url, json={"content": msg}, timeout=10)
            except Exception as e:
                print(f"  WARN Discord ping failed : {e}")

    finally:
        # Cleanup temp files no matter what.
        for p in (tmp_path, tmp_path + ".gz"):
            if os.path.exists(p):
                os.remove(p)


if __name__ == "__main__":
    main()
