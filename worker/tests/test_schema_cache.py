"""Tests for the process-level schema_cache.table_exists() helper.

All tests mock the Supabase HTTP layer — no real network contact.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services import schema_cache  # noqa: E402


def _fake_db(status_code: int, body: str = ""):
    """Return a MagicMock standing in for SupabaseRest with a single GET path."""
    db = MagicMock()
    db.base = "https://example.supabase.co/rest/v1"
    response = MagicMock()
    response.status_code = status_code
    response.text = body
    client = MagicMock()
    client.get.return_value = response
    db._get_client.return_value = client
    return db


@pytest.fixture(autouse=True)
def _clear_cache():
    """Reset the in-process cache before/after every test."""
    schema_cache.reset_cache()
    yield
    schema_cache.reset_cache()


def test_table_exists_returns_true_on_200():
    """A successful 200 from PostgREST means the table+columns are queryable."""
    fake = _fake_db(200, "[]")
    with patch.object(schema_cache, "get_db", return_value=fake):
        assert schema_cache.table_exists("kills") is True
    # The probe should be issued exactly once
    assert fake._get_client.return_value.get.call_count == 1


def test_table_exists_returns_false_on_pgrst205():
    """PGRST205 (table not in schema cache) → exists=False, no spam."""
    body = '{"code":"PGRST205","message":"Could not find table","hint":null}'
    fake = _fake_db(404, body)
    with patch.object(schema_cache, "get_db", return_value=fake):
        assert schema_cache.table_exists("moments") is False


def test_table_exists_returns_false_on_42703_missing_column():
    """42703 (column does not exist) on a column-aware probe → exists=False."""
    body = '{"code":"42703","message":"column moments.start_epoch does not exist"}'
    fake = _fake_db(400, body)
    with patch.object(schema_cache, "get_db", return_value=fake):
        assert schema_cache.table_exists("moments", columns="id,start_epoch") is False


def test_table_exists_caches_result_no_second_probe():
    """Second call must NOT re-probe — answer comes from in-process cache."""
    fake = _fake_db(200, "[]")
    with patch.object(schema_cache, "get_db", return_value=fake):
        assert schema_cache.table_exists("kills") is True
        assert schema_cache.table_exists("kills") is True
        assert schema_cache.table_exists("kills") is True
    # Three calls but only one HTTP probe
    assert fake._get_client.return_value.get.call_count == 1


def test_table_exists_treats_5xx_as_transient_returns_true():
    """A 500 is NOT a permanent schema problem — fall back to True so the
    real query path can run and surface the outage normally."""
    fake = _fake_db(503, "service unavailable")
    with patch.object(schema_cache, "get_db", return_value=fake):
        assert schema_cache.table_exists("kills") is True


def test_table_exists_returns_false_when_no_db_configured():
    """If get_db() returns None (no Supabase URL set), skip silently."""
    with patch.object(schema_cache, "get_db", return_value=None):
        assert schema_cache.table_exists("kills") is False


def test_table_exists_caches_per_column_set_independently():
    """Different `columns` arguments cache independently — the result for
    columns="id" doesn't suppress a probe for columns="id,broken_col"."""
    fake_ok = _fake_db(200, "[]")
    fake_bad = _fake_db(400, '{"code":"42703","message":"column not found"}')

    # First probe: bare "id" → 200 → cached True
    with patch.object(schema_cache, "get_db", return_value=fake_ok):
        assert schema_cache.table_exists("moments") is True

    # Second probe with extra column → independent cache key, must re-probe
    with patch.object(schema_cache, "get_db", return_value=fake_bad):
        assert schema_cache.table_exists("moments", columns="id,broken") is False
