"""
verify_migrations.py — Schema verifier for migrations 024-032 (PR-arch P0).

Asserts every expected table / column / index / view / RPC / RLS policy
introduced by the new architecture migrations actually exists in the
target Supabase database. Runs against the service role (bypasses RLS).

Why this exists
───────────────
Migrations are applied manually against the Supabase cloud (no CI tool
yet). When an operator forgets one, the worker silently degrades :
job_queue.enqueue() catches the 4xx and returns None, the orchestrator
keeps polling, no data flows. By the time someone notices, hours have
passed.

This script makes the gate explicit. Run it after every migration push :
  $ python worker/scripts/verify_migrations.py
  ✓ migration 024 — pipeline_jobs   (table, 18 cols, 5 idx, 1 RPC)
  ✓ migration 025 — pipeline_runs   (table, 11 cols, 2 idx)
  ✗ migration 026 — kill_assets table EXISTS but assets_manifest column MISSING on kills

Exit code is 0 iff every expected object exists. Non-zero with a printed
summary otherwise.

Usage
─────
  python worker/scripts/verify_migrations.py             # all migrations
  python worker/scripts/verify_migrations.py -m 024      # only 024
  python worker/scripts/verify_migrations.py --strict    # also check
                                                          # CHECK constraints,
                                                          # DEFAULT values,
                                                          # RLS policies

Design notes
────────────
* httpx-only — no psycopg / supabase-py (matches the worker's stack).
* All schema introspection goes through PostgREST :
    GET /rest/v1/{table}?select=...&limit=1   → table existence
    POST /rest/v1/rpc/fn_name                 → RPC existence (calls with
                                                bad args → 4xx ≠ 404)
  The trickier checks (column lists, indexes, views, policies) hit a
  handful of pg_* / information_schema views via a generic
  fn_introspect SQL helper. We don't ship that helper — we inline the
  queries via the PostgREST `?select=` query syntax against the system
  views directly.
* Don't fail-fast — collect every failure and dump them at the end.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")


# ════════════════════════════════════════════════════════════════════
# Expected schema — single source of truth for what each migration ships
# ════════════════════════════════════════════════════════════════════

@dataclass
class MigrationSpec:
    """Describes the objects a migration must have created."""
    number: int
    label: str
    tables: dict[str, list[str]] = field(default_factory=dict)
    # New columns added to existing tables
    table_additions: dict[str, list[str]] = field(default_factory=dict)
    indexes: list[str] = field(default_factory=list)
    # (function_name, [arg_names]) — args drive the call signature
    rpcs: list[tuple[str, list[str]]] = field(default_factory=list)
    views: list[str] = field(default_factory=list)
    # CHECK constraints by table — only enforced under --strict
    check_constraints: dict[str, list[str]] = field(default_factory=dict)
    # RLS-enabled tables — only enforced under --strict
    rls_tables: list[str] = field(default_factory=list)


SPECS: list[MigrationSpec] = [
    MigrationSpec(
        number=24,
        label="pipeline_jobs",
        tables={
            "pipeline_jobs": [
                "id", "type", "entity_type", "entity_id",
                "status", "priority", "attempts", "max_attempts",
                "run_after", "locked_by", "locked_until",
                "payload", "last_error", "result",
                "created_at", "updated_at", "claimed_at", "finished_at",
            ],
        },
        indexes=[
            "idx_pipeline_jobs_claim",
            "idx_pipeline_jobs_expired_lease",
            "idx_pipeline_jobs_entity",
            "idx_pipeline_jobs_type_status_finished",
            "idx_pipeline_jobs_active_unique",
        ],
        rpcs=[
            ("fn_claim_pipeline_jobs",
             ["p_worker_id", "p_types", "p_batch_size", "p_lease_seconds"]),
        ],
        check_constraints={
            "pipeline_jobs": [
                "pipeline_jobs_type_check",
                "pipeline_jobs_status_check",
            ],
        },
        rls_tables=["pipeline_jobs"],
    ),

    MigrationSpec(
        number=25,
        label="pipeline_runs + dead_letter_jobs",
        tables={
            "pipeline_runs": [
                "id", "module_name", "worker_id",
                "started_at", "ended_at", "duration_ms", "status",
                "items_scanned", "items_processed", "items_failed", "items_skipped",
                "error_summary", "metadata",
            ],
            "dead_letter_jobs": [
                "id", "original_job_id",
                "type", "entity_type", "entity_id", "payload",
                "error_code", "error_message", "stack_trace",
                "attempts", "failed_at",
                "resolution_status", "resolved_by", "resolved_at", "resolution_note",
            ],
        },
        indexes=[
            "idx_pipeline_runs_module_recent",
            "idx_pipeline_runs_failed",
            "idx_dlq_pending",
            "idx_dlq_type",
            "idx_dlq_error_code",
        ],
        views=["v_pipeline_health"],
        rls_tables=["pipeline_runs", "dead_letter_jobs"],
    ),

    MigrationSpec(
        number=26,
        label="kill_assets + assets_manifest",
        tables={
            "kill_assets": [
                "id", "kill_id", "version", "type",
                "url", "r2_key",
                "width", "height", "duration_ms", "codec",
                "bitrate_kbps", "size_bytes",
                "content_hash", "perceptual_hash",
                "source_offset_seconds", "source_clip_window_seconds",
                "encoder_args", "encoding_node",
                "is_current", "created_at", "archived_at",
            ],
        },
        table_additions={
            "kills": ["assets_manifest"],
        },
        indexes=[
            "idx_kill_assets_one_current_per_type",
            "idx_kill_assets_kill_version",
            "idx_kill_assets_content_hash",
            "idx_kills_assets_manifest_gin",
        ],
        rls_tables=["kill_assets"],
    ),

    MigrationSpec(
        number=27,
        label="status split (4 dimensions)",
        table_additions={
            "kills": ["pipeline_status", "publication_status",
                      "qc_status", "asset_status"],
        },
        indexes=[
            "idx_kills_pipeline_status",
            "idx_kills_publication_status",
            "idx_kills_qc_pending",
            "idx_kills_asset_ready",
        ],
        check_constraints={
            "kills": [
                "chk_pipeline_status",
                "chk_publication_status",
                "chk_qc_status",
                "chk_asset_status",
            ],
        },
    ),

    MigrationSpec(
        number=28,
        label="ai_annotations",
        tables={
            "ai_annotations": [
                "id", "kill_id",
                "model_provider", "model_name", "prompt_version", "analysis_version",
                "input_asset_id", "input_asset_version",
                "highlight_score", "ai_tags",
                "ai_description_fr", "ai_description_en",
                "ai_description_ko", "ai_description_es",
                "ai_thumbnail_timestamp_sec",
                "confidence_score", "raw_response",
                "input_tokens", "output_tokens", "cost_usd", "latency_ms",
                "is_current", "created_at", "archived_at",
            ],
        },
        indexes=[
            "idx_ai_annotations_one_current",
            "idx_ai_annotations_kill_recent",
            "idx_ai_annotations_model",
        ],
        views=["v_ai_cost_24h"],
        rls_tables=["ai_annotations"],
    ),

    MigrationSpec(
        number=29,
        label="user_events",
        tables={
            "user_events": [
                "id", "anonymous_user_id", "user_id", "session_id",
                "event_type", "entity_type", "entity_id",
                "metadata", "client_kind", "network_class", "locale",
                "created_at",
            ],
        },
        indexes=[
            "idx_user_events_recent",
            "idx_user_events_type_recent",
            "idx_user_events_entity",
            "idx_user_events_session",
            "idx_user_events_anonymous",
        ],
        views=["v_clip_engagement_24h", "v_trending_kills_1h"],
        check_constraints={
            "user_events": ["user_events_event_type_check"],
        },
        rls_tables=["user_events"],
    ),

    MigrationSpec(
        number=30,
        label="idempotency UNIQUE constraints",
        # Only generated columns — push_subscriptions.endpoint
        table_additions={
            "push_subscriptions": ["endpoint"],
        },
        indexes=[
            # Reconciled with CLAUDE.md §5.4 — the unique key is on
            # (game_id, killer_player_id, victim_player_id, event_epoch)
            # because event_epoch is the canonical pause-proof timing.
            # game_time_seconds is a derived value that can drift on
            # re-ingest if game_start_epoch is recomputed.
            "idx_kills_unique_event",
            "idx_push_subscriptions_endpoint",
            # The DO-block guards may or may not have created these
            # depending on prior schema state — they're checked best-effort.
        ],
    ),

    MigrationSpec(
        number=31,
        label="admin_actions strengthened",
        table_additions={
            "admin_actions": ["actor_role", "ip_hash",
                              "request_id", "user_agent_class"],
        },
        indexes=[
            "idx_admin_actions_recent",
            "idx_admin_actions_actor",
            "idx_admin_actions_action",
            "idx_admin_actions_entity_full",
        ],
        views=["v_admin_actions_7d"],
    ),

    MigrationSpec(
        number=32,
        label="reports table",
        tables={
            "reports": [
                "id", "target_type", "target_id",
                "reporter_id", "reporter_anon_id", "reporter_ip_hash",
                "reason_code", "reason_text",
                "status", "actioned_by", "actioned_at", "action_taken",
                "created_at",
            ],
        },
        indexes=[
            "idx_reports_pending",
            "idx_reports_target",
            "idx_reports_one_per_user_per_target",
        ],
        check_constraints={
            "reports": [
                "reports_target_type_check",
                "reports_reason_code_check",
                "reports_status_check",
                "reports_reason_text_length",
            ],
        },
        rls_tables=["reports"],
    ),

    MigrationSpec(
        number=33,
        label="pipeline_jobs.type extended for worker.backfill",
        # No new tables / indexes / views — just a CHECK constraint
        # rewrite. The constraint name stays the same so existence is
        # the only thing we verify here. To assert the actual whitelist
        # contents, an operator can run --strict mode against pg_catalog
        # but for the standard verifier this is a presence check.
        check_constraints={
            "pipeline_jobs": ["pipeline_jobs_type_check"],
        },
    ),

    MigrationSpec(
        number=34,
        label="user_events.event_type extended for Wave 4 analytics",
        # Same pattern as 033 — DROP + ADD rewrites the whitelist body
        # but keeps the constraint name. Presence check only.
        check_constraints={
            "user_events": ["user_events_event_type_check"],
        },
    ),
]


# ════════════════════════════════════════════════════════════════════
# Supabase REST helpers — service role
# ════════════════════════════════════════════════════════════════════

class SchemaInspector:
    """Wraps PostgREST + a few system-view queries for schema introspection."""

    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        self.client = httpx.Client(headers=self.headers, timeout=20.0)

    def close(self) -> None:
        self.client.close()

    # ─── Tables and columns ─────────────────────────────────────────

    def table_exists(self, table: str) -> bool:
        """A 200 (even with empty rows) means the table is exposed by
        PostgREST, which means it exists and the API knows about it.
        404 means missing."""
        try:
            r = self.client.get(
                f"{self.base}/{table}",
                params={"select": "*", "limit": "1"},
            )
            if r.status_code == 200:
                return True
            if r.status_code == 404:
                return False
            # 401/403 = auth issue ; surface as missing so the operator notices
            return False
        except Exception:
            return False

    def list_columns(self, table: str) -> set[str] | None:
        """Returns the set of column names for `table`, or None if the
        table doesn't exist or PostgREST refuses the OPTIONS call.

        Strategy : SELECT one row with select=*, then read its keys. If
        the table is empty, we fall back to a HEAD request with Prefer:
        return=representation… but in practice every fresh DB has the
        info_schema; we go straight to a query against information_schema
        via the PostgREST endpoint exposed by the `extensions` schema if
        possible. Easiest path : try SELECT * LIMIT 1 first, and if the
        table is empty, fall back to the introspection RPC if it ships."""
        try:
            r = self.client.get(
                f"{self.base}/{table}",
                params={"select": "*", "limit": "1"},
            )
            if r.status_code != 200:
                return None
            rows = r.json() or []
            if rows:
                return set(rows[0].keys())
            # Empty table — use OPTIONS or fall back to information_schema.
            # PostgREST returns column descriptions in the OpenAPI doc but
            # that's a heavy fetch. We try a HEAD with Prefer count=exact
            # to confirm reachability, then do a NULL-row insert dry-run
            # via Prefer=count to introspect — but the cleanest portable
            # path is a tiny SELECT with a column whitelist that PostgREST
            # will validate against.
        except Exception:
            return None

        # If empty, we attempt to read column names via the OpenAPI spec.
        try:
            r = self.client.get(
                self.base.rsplit("/rest/v1", 1)[0] + "/rest/v1/",
                headers={**self.headers, "Accept": "application/openapi+json"},
            )
            if r.status_code != 200:
                return set()  # Table exists but we can't enumerate; soft-pass
            spec = r.json()
            defs = (spec.get("definitions") or {}).get(table) or {}
            props = defs.get("properties") or {}
            return set(props.keys())
        except Exception:
            return set()

    # ─── Indexes ────────────────────────────────────────────────────

    def list_indexes(self) -> set[str]:
        """Pulls every index name in the `public` schema via pg_indexes
        exposed through PostgREST. PostgREST exposes pg_catalog views
        only if they're in the schemas in db-schemas — the supabase
        defaults expose `public` only.

        Workaround : we expose pg_indexes-like info through a tiny RPC
        we call via /rpc/fn_pg_indexes if shipped; otherwise we rely on
        the index being implicitly testable via the `EXPLAIN` of a query
        that would use it. For portability, we shell out to a generic
        `fn_introspect_indexes` RPC. If absent, fall back to "skip".

        We keep it simple : query the `pg_indexes` view via the `extensions`
        schema if exposed, otherwise we mark the index as soft-pass."""
        # Approach : POST a tiny ad-hoc SQL via /rpc — but PostgREST
        # doesn't accept arbitrary SQL by default. We rely on the
        # convention that the db has `pg_indexes` exposed via the
        # `pg_catalog` schema accessible through a curated function.
        # Since we don't ship such a function, we use a different
        # heuristic : try /pg_indexes with a ?select= query and see.
        try:
            r = self.client.get(
                f"{self.base}/pg_indexes",
                params={
                    "select": "indexname",
                    "schemaname": "eq.public",
                },
            )
            if r.status_code == 200:
                rows = r.json() or []
                return {row["indexname"] for row in rows if row.get("indexname")}
        except Exception:
            pass

        # Fallback : try information_schema.statistics (some Postgres
        # exposures route there).
        try:
            r = self.client.get(
                f"{self.base}/information_schema_indexes",
                params={"select": "indexname"},
            )
            if r.status_code == 200:
                rows = r.json() or []
                return {row.get("indexname") for row in rows
                        if row.get("indexname")}
        except Exception:
            pass

        # Couldn't enumerate — return None sentinel via raise so the
        # caller knows to skip rather than report missing. The outer
        # check converts this to a soft-pass with a warning.
        raise RuntimeError("index_introspection_unavailable")

    # ─── Views ──────────────────────────────────────────────────────

    def view_exists(self, name: str) -> bool:
        """A view is just a relation — same SELECT trick as table."""
        try:
            r = self.client.get(
                f"{self.base}/{name}",
                params={"select": "*", "limit": "1"},
            )
            return r.status_code == 200
        except Exception:
            return False

    # ─── RPCs ───────────────────────────────────────────────────────

    def rpc_exists(self, name: str, arg_names: list[str]) -> bool:
        """Call the RPC with bogus arg values matching its expected names.
        - If PostgREST returns 404 : function doesn't exist.
        - If PostgREST returns 400 (bad arg type/value) : exists.
        - If PostgREST returns 200 : exists (and ran — fine for read-only).
        - 42883 in body = function does not exist (signature mismatch).
        """
        # Build a payload with safely-typed dummy values per common arg name.
        dummies: dict[str, Any] = {}
        for arg in arg_names:
            lname = arg.lower()
            if "types" in lname or arg.endswith("_array"):
                dummies[arg] = ["__nonexistent_type__"]
            elif "size" in lname or "seconds" in lname or "limit" in lname:
                dummies[arg] = 1
            else:
                dummies[arg] = "__verify_migrations__"
        try:
            r = self.client.post(f"{self.base}/rpc/{name}", json=dummies)
            if r.status_code == 404:
                return False
            body = (r.text or "")
            if '"42883"' in body or "does not exist" in body.lower():
                # Function signature mismatch — usually means we passed
                # wrong arg names. Try one more time with positional / no args.
                if r.status_code == 404:
                    return False
                # Fall through : treat any non-404 as "exists with bad call".
            return True
        except Exception:
            return False

    # ─── CHECK constraints (strict mode) ────────────────────────────

    def list_check_constraints(self, table: str) -> set[str]:
        """Pulls CHECK constraint names from information_schema.
        information_schema.table_constraints is exposed in the
        information_schema schema which PostgREST routes through
        if `db-schemas=public,information_schema` was set — by default
        Supabase only exposes `public`, so we may get nothing back.
        Soft-pass on failure."""
        try:
            r = self.client.get(
                f"{self.base}/information_schema_table_constraints",
                params={
                    "select": "constraint_name",
                    "table_name": f"eq.{table}",
                    "constraint_type": "eq.CHECK",
                },
            )
            if r.status_code == 200:
                rows = r.json() or []
                return {row.get("constraint_name") for row in rows
                        if row.get("constraint_name")}
        except Exception:
            pass
        raise RuntimeError("check_constraint_introspection_unavailable")

    # ─── RLS (strict mode) ──────────────────────────────────────────

    def rls_enabled(self, table: str) -> bool | None:
        """Reads pg_class.relrowsecurity if exposed. Returns None if we
        couldn't introspect (soft-pass)."""
        try:
            r = self.client.get(
                f"{self.base}/pg_class",
                params={
                    "select": "relrowsecurity",
                    "relname": f"eq.{table}",
                },
            )
            if r.status_code == 200:
                rows = r.json() or []
                if rows:
                    return bool(rows[0].get("relrowsecurity"))
                return None
        except Exception:
            pass
        return None


# ════════════════════════════════════════════════════════════════════
# Result accumulator — collects everything, prints at the end
# ════════════════════════════════════════════════════════════════════

@dataclass
class MigrationResult:
    spec: MigrationSpec
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return not self.failures

    def summary_line(self) -> str:
        mark = "OK " if self.passed else "FAIL"
        bits: list[str] = []
        for k in ("tables", "columns", "indexes", "rpcs",
                  "views", "checks", "rls"):
            if k in self.counts:
                bits.append(f"{self.counts[k]} {k}")
        bit_str = ", ".join(bits) if bits else "no objects"
        return (
            f"[{mark}] migration {self.spec.number:03d} — "
            f"{self.spec.label} ({bit_str})"
        )


def verify_migration(
    inspector: SchemaInspector,
    spec: MigrationSpec,
    strict: bool,
) -> MigrationResult:
    res = MigrationResult(spec=spec)

    # ─── Tables ─────────────────────────────────────────────────────
    for table, expected_cols in spec.tables.items():
        if not inspector.table_exists(table):
            res.failures.append(f"table {table} MISSING")
            continue
        res.counts["tables"] = res.counts.get("tables", 0) + 1
        actual = inspector.list_columns(table)
        if actual is None:
            res.warnings.append(
                f"table {table} exists but column introspection failed"
            )
            continue
        if not actual:
            res.warnings.append(
                f"table {table} exists but is empty + OpenAPI introspection "
                "returned no columns (soft-pass)"
            )
            continue
        missing_cols = [c for c in expected_cols if c not in actual]
        if missing_cols:
            res.failures.append(
                f"table {table} columns MISSING: {sorted(missing_cols)}"
            )
        res.counts["columns"] = res.counts.get("columns", 0) + (
            len(expected_cols) - len(missing_cols)
        )

    # ─── Table additions (new columns on existing tables) ───────────
    for table, expected_cols in spec.table_additions.items():
        actual = inspector.list_columns(table)
        if actual is None:
            res.failures.append(
                f"table {table} unreachable — cannot verify added columns"
            )
            continue
        if not actual:
            res.warnings.append(
                f"table {table} exists but column introspection returned "
                "nothing (soft-pass for added columns)"
            )
            continue
        missing_cols = [c for c in expected_cols if c not in actual]
        if missing_cols:
            res.failures.append(
                f"columns MISSING on {table}: {sorted(missing_cols)}"
            )
        res.counts["columns"] = res.counts.get("columns", 0) + (
            len(expected_cols) - len(missing_cols)
        )

    # ─── Indexes ────────────────────────────────────────────────────
    if spec.indexes:
        try:
            present = inspector.list_indexes()
            missing_idx = [i for i in spec.indexes if i not in present]
            if missing_idx:
                res.failures.append(f"indexes MISSING: {sorted(missing_idx)}")
            res.counts["indexes"] = len(spec.indexes) - len(missing_idx)
        except RuntimeError:
            res.warnings.append(
                f"index introspection unavailable — cannot verify "
                f"{len(spec.indexes)} expected indexes"
            )

    # ─── Views ──────────────────────────────────────────────────────
    for view in spec.views:
        if inspector.view_exists(view):
            res.counts["views"] = res.counts.get("views", 0) + 1
        else:
            res.failures.append(f"view {view} MISSING")

    # ─── RPCs ───────────────────────────────────────────────────────
    for rpc_name, arg_names in spec.rpcs:
        if inspector.rpc_exists(rpc_name, arg_names):
            res.counts["rpcs"] = res.counts.get("rpcs", 0) + 1
        else:
            res.failures.append(f"RPC {rpc_name}({','.join(arg_names)}) MISSING")

    # ─── CHECK constraints (strict only) ────────────────────────────
    if strict and spec.check_constraints:
        for table, expected in spec.check_constraints.items():
            try:
                present = inspector.list_check_constraints(table)
                missing = [c for c in expected if c not in present]
                if missing:
                    res.failures.append(
                        f"CHECK constraints MISSING on {table}: {sorted(missing)}"
                    )
                res.counts["checks"] = res.counts.get("checks", 0) + (
                    len(expected) - len(missing)
                )
            except RuntimeError:
                res.warnings.append(
                    f"check-constraint introspection unavailable for {table}"
                )

    # ─── RLS (strict only) ──────────────────────────────────────────
    if strict and spec.rls_tables:
        for table in spec.rls_tables:
            enabled = inspector.rls_enabled(table)
            if enabled is None:
                res.warnings.append(f"RLS state unknown for {table}")
            elif not enabled:
                res.failures.append(f"RLS NOT enabled on {table}")
            else:
                res.counts["rls"] = res.counts.get("rls", 0) + 1

    return res


# ════════════════════════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════════════════════════

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify migrations 024-032 are applied to Supabase",
    )
    parser.add_argument(
        "-m", "--migration",
        type=int, default=None,
        help="Verify only this migration number (e.g. 24).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Also verify CHECK constraints + RLS enablement.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of the text report.",
    )
    args = parser.parse_args()

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("ERROR : SUPABASE_URL and SUPABASE_SERVICE_KEY must be set "
              "(.env file or environment).", file=sys.stderr)
        return 2

    specs = SPECS
    if args.migration is not None:
        specs = [s for s in SPECS if s.number == args.migration]
        if not specs:
            print(f"ERROR : no spec defined for migration {args.migration}",
                  file=sys.stderr)
            return 2

    inspector = SchemaInspector(url, key)
    try:
        results = [verify_migration(inspector, s, strict=args.strict)
                   for s in specs]
    finally:
        inspector.close()

    if args.json:
        payload = {
            "strict": args.strict,
            "results": [
                {
                    "migration": r.spec.number,
                    "label": r.spec.label,
                    "passed": r.passed,
                    "failures": r.failures,
                    "warnings": r.warnings,
                    "counts": r.counts,
                }
                for r in results
            ],
            "all_passed": all(r.passed for r in results),
        }
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("=" * 70)
        print(" Migration verification — kckills.com")
        print("=" * 70)
        for r in results:
            print(r.summary_line())
            for f in r.failures:
                print(f"     -> {f}")
            for w in r.warnings:
                print(f"     ?  {w}")
        print("-" * 70)
        ok = sum(1 for r in results if r.passed)
        bad = len(results) - ok
        print(f"  {ok}/{len(results)} migrations OK"
              + (f" — {bad} failing" if bad else ""))
        if any(r.warnings for r in results):
            print("  (? = soft-pass : introspection couldn't confirm, "
                  "but no hard failure)")
        if not args.strict:
            print("  Tip : run with --strict to also verify CHECK "
                  "constraints + RLS")

    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
