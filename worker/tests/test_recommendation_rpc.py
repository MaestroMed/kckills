"""Tests for the fn_recommend_kills RPC + the backfill_embeddings script.

Strategy
--------
The RPC itself lives in supabase/migrations/046_recommendation_helpers.sql
and is exercised by the web edge route at runtime — there is no Python
production code to unit-test for the RPC body.

What we CAN cover from the worker side :
  1. The migration file's SQL signature matches what the loader expects
     (function name, parameter list, return columns). A pure text-grep
     of the SQL file — fast, no DB needed.
  2. The backfill script's `_fetch_page` / `_amain` flow is exercised
     end-to-end with a mocked Supabase + mocked embed_one. Mirrors the
     test_backfill_og_images.py pattern : monkey-patch the script's
     view of httpx, embed_one, and safe_update so nothing leaves the
     test process.

Coverage (8 tests)
------------------
1.  migration 046 file exists
2.  migration declares fn_recommend_kills with 4 params + 2-col return
3.  migration grants EXECUTE to anon + authenticated
4.  migration creates an IVFFlat secondary index on kills.embedding
5.  backfill dry-run does no embed_one or safe_update calls
6.  backfill enqueues every published kill missing an embedding
7.  backfill --limit caps the total processed
8.  backfill --min-score filters the candidate set
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Add worker root to sys.path before importing.
_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))

# Stub env so config.py doesn't refuse to import.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")


_REPO_ROOT = _WORKER_ROOT.parent
MIGRATION_PATH = (
    _REPO_ROOT
    / "supabase"
    / "migrations"
    / "046_recommendation_helpers.sql"
)


# ─── Migration sanity tests ──────────────────────────────────────────


def test_migration_file_exists():
    """Migration 046 must ship in supabase/migrations/."""
    assert MIGRATION_PATH.exists(), (
        f"missing migration file at {MIGRATION_PATH}"
    )
    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    assert len(sql) > 500, "migration looks suspiciously short"


def test_migration_declares_fn_recommend_kills():
    """fn_recommend_kills(UUID[], TEXT, INT, INT) → TABLE(id UUID, similarity FLOAT)."""
    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    # Function declaration
    assert "CREATE OR REPLACE FUNCTION fn_recommend_kills" in sql
    # Parameter list — anchor ids, session id, limit, exclude window.
    assert "p_anchor_kill_ids UUID[]" in sql
    assert "p_session_id TEXT" in sql
    assert "p_limit INT" in sql
    assert "p_exclude_recent_hours INT" in sql
    # Return columns
    assert "RETURNS TABLE" in sql
    assert "similarity FLOAT" in sql


def test_migration_grants_execute():
    """Edge route calls the RPC with the anon key — grant must be set."""
    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    assert (
        "GRANT EXECUTE ON FUNCTION fn_recommend_kills" in sql
    ), "missing GRANT EXECUTE on fn_recommend_kills"
    assert "TO anon, authenticated" in sql


def test_migration_creates_ivfflat_index():
    """Recommendation throughput depends on the IVFFlat secondary."""
    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    assert "idx_kills_embedding_ivfflat" in sql
    assert "USING ivfflat" in sql.lower() or "USING IVFFLAT" in sql.upper()
    assert "vector_cosine_ops" in sql


# ─── backfill_embeddings tests ───────────────────────────────────────


@pytest.fixture
def patch_observability(monkeypatch):
    """Silence the @run_logged decorator's Supabase calls."""
    from services import observability

    monkeypatch.setattr(
        observability, "_try_insert_run", lambda module_name: None
    )
    monkeypatch.setattr(
        observability, "_try_update_run", lambda *a, **k: None
    )
    yield


@pytest.fixture
def fake_kills():
    """Six published kills with mixed embedding state and varied
    highlight_score so the filter / limit branches are all exercisable."""
    return [
        # Missing embedding, high score
        {
            "id": "k-001",
            "killer_champion": "Ahri",
            "victim_champion": "Zed",
            "ai_description": "Banger outplay",
            "ai_tags": ["clean"],
            "highlight_score": 9.5,
        },
        # Missing embedding, mid score
        {
            "id": "k-002",
            "killer_champion": "LeBlanc",
            "victim_champion": "Yasuo",
            "ai_description": "Solid pickoff",
            "ai_tags": ["pickoff"],
            "highlight_score": 7.2,
        },
        # Missing embedding, low score
        {
            "id": "k-003",
            "killer_champion": "Jinx",
            "victim_champion": "Caitlyn",
            "ai_description": "Routine kill",
            "ai_tags": [],
            "highlight_score": 3.5,
        },
        # Missing embedding, NULL score
        {
            "id": "k-004",
            "killer_champion": "Sett",
            "victim_champion": "Aatrox",
            "ai_description": "No-AI kill",
            "ai_tags": [],
            "highlight_score": None,
        },
    ]


@pytest.fixture
def patched_backfill(monkeypatch, fake_kills, patch_observability):
    """Wire monkey-patches and return a Bag with assertion handles."""
    from scripts import backfill_embeddings as mod

    embed_calls: list[dict] = []
    update_calls: list[dict] = []

    async def fake_embed_one(kill: dict):
        embed_calls.append({"id": kill.get("id")})
        # Return a deterministic 768-dim "vector" so the formatter call
        # path is exercised ; a list of zeros is enough.
        return [0.0] * 768

    def fake_safe_update(table, data, match_col, match_val):
        update_calls.append({
            "table": table,
            "match_col": match_col,
            "match_val": match_val,
            "embedding_present": "embedding" in data,
        })
        return True

    # The script calls embedder.embed_one + safe_update.
    monkeypatch.setattr(mod.embedder, "embed_one", fake_embed_one)
    monkeypatch.setattr(mod, "safe_update", fake_safe_update)

    fake_db = MagicMock(name="fake_db", base="https://x", headers={})
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)

    def fake_fetch_page(db, *, offset, page_size, min_score):
        rows = list(fake_kills)
        if min_score > 0:
            rows = [
                k for k in rows
                if (k.get("highlight_score") or 0.0) >= min_score
            ]
        return rows[offset : offset + page_size]

    monkeypatch.setattr(mod, "_fetch_page", fake_fetch_page)

    class Bag:
        pass

    bag = Bag()
    bag.module = mod
    bag.embed_calls = embed_calls
    bag.update_calls = update_calls
    bag.fake_kills = fake_kills
    return bag


def test_backfill_dry_run_does_no_writes(patched_backfill):
    """--dry-run should NOT call embed_one or safe_update."""
    mod = patched_backfill.module
    result = asyncio.run(
        mod._amain(
            dry_run=True, limit=None, min_score=0.0, page_size=200,
        )
    )

    assert patched_backfill.embed_calls == [], (
        "dry_run still called embed_one"
    )
    assert patched_backfill.update_calls == [], (
        "dry_run still called safe_update"
    )
    assert result["items_scanned"] == 4
    assert result["items_processed"] == 4
    assert result["dry_run"] is True


def test_backfill_full_flow_embeds_missing(patched_backfill):
    """Default run : every published kill missing embedding gets one."""
    mod = patched_backfill.module
    result = asyncio.run(
        mod._amain(
            dry_run=False, limit=None, min_score=0.0, page_size=200,
        )
    )

    embedded_ids = sorted(c["id"] for c in patched_backfill.embed_calls)
    assert embedded_ids == ["k-001", "k-002", "k-003", "k-004"]

    # Every successful embed_one is followed by a safe_update("kills", …).
    update_ids = sorted(c["match_val"] for c in patched_backfill.update_calls)
    assert update_ids == ["k-001", "k-002", "k-003", "k-004"]
    for call in patched_backfill.update_calls:
        assert call["table"] == "kills"
        assert call["match_col"] == "id"
        assert call["embedding_present"] is True

    assert result["items_processed"] == 4
    assert result["items_failed"] == 0


def test_backfill_limit_caps_total(patched_backfill):
    """--limit 2 stops after the first 2 rows even though 4 are eligible."""
    mod = patched_backfill.module
    result = asyncio.run(
        mod._amain(
            dry_run=False, limit=2, min_score=0.0, page_size=200,
        )
    )

    assert len(patched_backfill.embed_calls) == 2
    assert result["items_processed"] == 2
    # Order is highlight_score.desc.nullslast — k-001 (9.5) and k-002 (7.2)
    # come first.
    embedded_ids = [c["id"] for c in patched_backfill.embed_calls]
    assert "k-001" in embedded_ids
    assert "k-002" in embedded_ids


def test_backfill_min_score_filter(patched_backfill):
    """--min-score 7.0 keeps only k-001 (9.5) and k-002 (7.2)."""
    mod = patched_backfill.module
    asyncio.run(
        mod._amain(
            dry_run=False, limit=None, min_score=7.0, page_size=200,
        )
    )

    embedded_ids = sorted(c["id"] for c in patched_backfill.embed_calls)
    assert embedded_ids == ["k-001", "k-002"], (
        f"min_score=7.0 should keep only k-001 and k-002 ; got {embedded_ids}"
    )


# ─── Manual main() runner ────────────────────────────────────────────


def _run_all():
    print("=== test_recommendation_rpc ===")
    pytest.main([__file__, "-v", "-s"])


if __name__ == "__main__":
    _run_all()
