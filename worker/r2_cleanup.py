"""r2_cleanup — Wave 30o (2026-05-14)

Audits + cleans up the kckills-clips R2 bucket. Currently sits at
~440 GB vs free tier 10 GB. Major waste sources :
  * clips/         377 GB — 35k mp4s
  * hls/            61 GB — 103k segments (HLS adaptive — unused)
  * thumbnails/      0.7 GB
  * og/              0.03 GB
  * moments/         0.7 GB

Strategy (in order of impact, lowest risk first) :

  1. HLS purge — delete the `hls/` prefix entirely. The frontend pulls
     `clip_url_vertical` MP4 directly via R2 ; HLS adaptive bitrate is
     not active. Frees ~60 GB.

  2. Versioned-clip dedup — `clips/{game_id}/{kill_id}/v{N}/<file>`.
     Keep ONLY the highest version per (game_id, kill_id). All older
     versions (v1, v2... when v3 exists) are stale re-clip output.
     Frees ~30-50 GB depending on how many re-clips happened.

  3. Legacy flat clips — `clips/{kill_id}_h.mp4`, `_v.mp4`, `_v_low.mp4`,
     `_thumb.jpg`. These are kept for back-compat ; the kills.clip_url_*
     columns point at them. KEEP these — they're load-bearing.

  4. Orphan thumbnails — thumbnails not referenced by any kill row.
     Need DB access ; deferred until DB is back.

This script uses ONLY R2 ; no DB required. So we can run it now while
Supabase is unhealthy.

Modes :
  python r2_cleanup.py                      # full audit, no deletes
  python r2_cleanup.py --apply-hls          # delete hls/ prefix only
  python r2_cleanup.py --apply-versioned    # delete old versioned clips
  python r2_cleanup.py --apply-all          # both
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv

load_dotenv(".env")

import boto3
from botocore.config import Config

ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
BUCKET = os.environ["R2_BUCKET_NAME"]


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 2}),
    )


def fmt_gb(b: int) -> str:
    return f"{b / 1024 / 1024 / 1024:.2f} GB"


def list_all_objects():
    """Stream every object in the bucket. Returns list of dicts with key, size."""
    s3 = _s3()
    paginator = s3.get_paginator("list_objects_v2")
    out = []
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            out.append({"key": obj["Key"], "size": obj["Size"]})
    return out


def audit(objects: list[dict]) -> dict:
    """Categorize objects, compute sizes."""
    # Prefix totals
    by_prefix = defaultdict(lambda: {"bytes": 0, "count": 0})
    # Versioned clip groups : (game_id, kill_id) -> {version: [(key, size)]}
    versioned = defaultdict(lambda: defaultdict(list))
    versioned_re = re.compile(r"^clips/([0-9a-f-]{36})/([0-9a-f-]{36})/v(\d+)/")
    # Legacy flat clip keys (no versioned path)
    legacy_clips = []
    # HLS
    hls = []

    for obj in objects:
        key = obj["key"]
        size = obj["size"]
        prefix = key.split("/")[0] if "/" in key else "root"
        by_prefix[prefix]["bytes"] += size
        by_prefix[prefix]["count"] += 1

        m = versioned_re.match(key)
        if m:
            gid, kid, v = m.group(1), m.group(2), int(m.group(3))
            versioned[(gid, kid)][v].append((key, size))
        elif key.startswith("hls/"):
            hls.append((key, size))
        elif key.startswith("clips/"):
            legacy_clips.append((key, size))

    return {
        "by_prefix": dict(by_prefix),
        "versioned": versioned,
        "legacy_clips": legacy_clips,
        "hls": hls,
        "total_objects": len(objects),
        "total_bytes": sum(o["size"] for o in objects),
    }


def plan_hls_delete(audit_data: dict) -> tuple[list[str], int]:
    """All HLS keys → delete plan."""
    keys = [k for (k, _) in audit_data["hls"]]
    bytes_freed = sum(s for (_, s) in audit_data["hls"])
    return keys, bytes_freed


def plan_versioned_dedup(audit_data: dict) -> tuple[list[str], int]:
    """For each (game_id, kill_id), keep only the highest version.
    Returns keys to delete + bytes that will be freed."""
    delete_keys = []
    delete_bytes = 0
    for (gid, kid), versions in audit_data["versioned"].items():
        if len(versions) <= 1:
            continue  # only one version exists, keep it
        max_v = max(versions.keys())
        for v, entries in versions.items():
            if v == max_v:
                continue
            for key, size in entries:
                delete_keys.append(key)
                delete_bytes += size
    return delete_keys, delete_bytes


def bulk_delete(s3, keys: list[str], dry_run: bool = True, label: str = "delete"):
    """Delete keys in batches of 1000 (R2 API limit). Returns (deleted_count, errors)."""
    if dry_run:
        print(f"  DRY RUN — would delete {len(keys):,} keys")
        return len(keys), 0

    deleted = 0
    errors = 0
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        objects = [{"Key": k} for k in batch]
        try:
            resp = s3.delete_objects(
                Bucket=BUCKET,
                Delete={"Objects": objects, "Quiet": True},
            )
            deleted += len(batch) - len(resp.get("Errors", []))
            errors += len(resp.get("Errors", []))
            if (i + 1000) % 5000 == 0 or i + 1000 >= len(keys):
                print(f"    progress: {min(i + 1000, len(keys)):,} / {len(keys):,}")
        except Exception as e:
            print(f"    batch {i} failed: {str(e)[:200]}")
            errors += len(batch)
    return deleted, errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply-hls", action="store_true",
                        help="DELETE all hls/* keys")
    parser.add_argument("--apply-versioned", action="store_true",
                        help="DELETE old versioned clip iterations (keep highest v per kill)")
    parser.add_argument("--apply-all", action="store_true",
                        help="Apply both hls + versioned cleanups")
    args = parser.parse_args()

    apply_hls = args.apply_hls or args.apply_all
    apply_ver = args.apply_versioned or args.apply_all
    dry_run = not (apply_hls or apply_ver)

    print("=" * 72)
    print(f"  R2 CLEANUP — {datetime.now(timezone.utc).isoformat()[:19]} UTC")
    print(f"  Mode : {'DRY RUN (audit only)' if dry_run else 'APPLY DELETES'}")
    print("=" * 72)

    print("\nListing all R2 objects...")
    objects = list_all_objects()
    print(f"  Total : {len(objects):,} objects, {fmt_gb(sum(o['size'] for o in objects))}\n")

    audit_data = audit(objects)
    print(f"By prefix :")
    for prefix, data in sorted(audit_data["by_prefix"].items(),
                                key=lambda kv: -kv[1]["bytes"]):
        print(f"  {prefix:<20} {fmt_gb(data['bytes']):>10}  ({data['count']:,} objects)")

    print(f"\nVersioned clip groups (clips/{{game_id}}/{{kill_id}}/v{{N}}/) :")
    vg_total = sum(len(versions) for versions in audit_data["versioned"].values())
    vg_with_dupes = sum(1 for versions in audit_data["versioned"].values() if len(versions) > 1)
    print(f"  Distinct (game,kill) pairs : {len(audit_data['versioned']):,}")
    print(f"  Total version entries      : {vg_total:,}")
    print(f"  Pairs with >1 version      : {vg_with_dupes:,}")
    if audit_data["versioned"]:
        # Distribution
        version_count_dist = defaultdict(int)
        for versions in audit_data["versioned"].values():
            version_count_dist[len(versions)] += 1
        print(f"  Version-count distribution :")
        for vc, n in sorted(version_count_dist.items()):
            print(f"    {vc} version(s) : {n:,} kills")

    print(f"\nHLS segments : {len(audit_data['hls']):,} files, "
          f"{fmt_gb(sum(s for _, s in audit_data['hls']))}")

    # Plan the deletes
    print(f"\n{'=' * 72}\n  CLEANUP PLAN\n{'=' * 72}")

    s3 = _s3()
    total_freed = 0

    if apply_hls or dry_run:
        keys, bytes_freed = plan_hls_delete(audit_data)
        print(f"\nHLS purge :")
        print(f"  Keys to delete : {len(keys):,}")
        print(f"  Bytes freed    : {fmt_gb(bytes_freed)}")
        if apply_hls:
            print(f"  EXECUTING delete...")
            deleted, errors = bulk_delete(s3, keys, dry_run=False, label="hls")
            print(f"  Deleted : {deleted:,}  Errors : {errors}")
            total_freed += bytes_freed - errors  # approx
        else:
            print(f"  (dry run — pass --apply-hls to execute)")

    if apply_ver or dry_run:
        keys, bytes_freed = plan_versioned_dedup(audit_data)
        print(f"\nVersioned dedup (keep highest v per kill) :")
        print(f"  Keys to delete : {len(keys):,}")
        print(f"  Bytes freed    : {fmt_gb(bytes_freed)}")
        if apply_ver:
            print(f"  EXECUTING delete...")
            deleted, errors = bulk_delete(s3, keys, dry_run=False, label="versioned")
            print(f"  Deleted : {deleted:,}  Errors : {errors}")
            total_freed += bytes_freed - errors

    if not dry_run:
        print(f"\n{'=' * 72}")
        print(f"  TOTAL APPROX FREED : {fmt_gb(total_freed)}")
        print(f"{'=' * 72}")
        print(f"\nRe-listing bucket to confirm new size...")
        new_objects = list_all_objects()
        new_total = sum(o["size"] for o in new_objects)
        print(f"  Before : {fmt_gb(sum(o['size'] for o in objects))}")
        print(f"  After  : {fmt_gb(new_total)}  ({len(new_objects):,} objects)")
    else:
        total_plan = sum([
            plan_hls_delete(audit_data)[1] if (args.apply_hls or args.apply_all) else 0,
            plan_versioned_dedup(audit_data)[1] if (args.apply_versioned or args.apply_all) else 0,
        ])
        if total_plan == 0:
            # Show what would happen with --apply-all
            hls_b = plan_hls_delete(audit_data)[1]
            ver_b = plan_versioned_dedup(audit_data)[1]
            print(f"\nIf --apply-all : would free {fmt_gb(hls_b + ver_b)} "
                  f"(hls={fmt_gb(hls_b)} + versioned={fmt_gb(ver_b)})")


if __name__ == "__main__":
    main()
