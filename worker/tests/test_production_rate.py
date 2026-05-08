"""
test_production_rate.py - Pin the regression in `production_rate._count`.

Wave 20.6 (2026-05-08) - PostgREST returns HTTP 206 (Partial Content)
when called with `Prefer: count=exact` AND `limit=1`. The original
script accepted only HTTP 200 and silently zeroed-out every count
section. This test pins the contract :

  * 200 + content-range  -> int
  * 206 + content-range  -> int  (PostgREST partial-response case)
  * 500 (server error)   -> None
  * 200 missing header   -> None
  * 200 malformed header -> None

We monkey-patch `httpx.get` so the test is hermetic - no network, no
DB, no env requirements.
"""

from __future__ import annotations

import importlib
import os
import sys
from unittest.mock import MagicMock

import pytest

# Ensure we can import scripts.production_rate
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load_count():
    """Re-import the module fresh on every test so monkeypatching
    httpx.get inside one test doesn't leak into another."""
    if "scripts.production_rate" in sys.modules:
        del sys.modules["scripts.production_rate"]
    mod = importlib.import_module("scripts.production_rate")
    return mod._count


def _fake_response(
    status_code: int,
    content_range: str | None = None,
) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.headers = {"content-range": content_range} if content_range is not None else {}
    return r


@pytest.fixture
def auth() -> dict[str, str]:
    return {
        "apikey": "test-key",
        "Authorization": "Bearer test-key",
    }


def test_count_accepts_200_with_range(monkeypatch, auth):
    """Status 200 + valid content-range -> the count is parsed."""
    fake = _fake_response(200, "0-0/127")
    monkeypatch.setattr(
        "httpx.get",
        lambda *args, **kwargs: fake,
    )
    _count = _load_count()
    n = _count("https://x", auth, "kills", {"status": "eq.published"})
    assert n == 127


def test_count_accepts_206_partial_content(monkeypatch, auth):
    """The Wave 20.4 regression : PostgREST + Prefer:count=exact +
    limit=1 returns 206, NOT 200. The fix accepts both."""
    fake = _fake_response(206, "0-0/4321")
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: fake)
    _count = _load_count()
    n = _count("https://x", auth, "kills", {"status": "eq.raw"})
    assert n == 4321


def test_count_returns_none_on_5xx(monkeypatch, auth):
    fake = _fake_response(500, "0-0/0")
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: fake)
    _count = _load_count()
    n = _count("https://x", auth, "kills", {})
    assert n is None


def test_count_returns_none_on_4xx(monkeypatch, auth):
    """A bad query (e.g. invalid filter syntax) returns 4xx. We must
    not crash, must not return a stale count."""
    fake = _fake_response(400, "")
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: fake)
    _count = _load_count()
    n = _count("https://x", auth, "kills", {"status": "garbage"})
    assert n is None


def test_count_returns_none_when_header_missing(monkeypatch, auth):
    """If PostgREST somehow returns 200 with no content-range header,
    we treat it as unknown rather than crashing on KeyError."""
    fake = _fake_response(200, content_range=None)
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: fake)
    _count = _load_count()
    n = _count("https://x", auth, "kills", {})
    assert n is None


def test_count_returns_none_on_malformed_header(monkeypatch, auth):
    """Header that doesn't match `<range>/<total>` shape is ignored."""
    fake = _fake_response(200, "broken")
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: fake)
    _count = _load_count()
    n = _count("https://x", auth, "kills", {})
    assert n is None


def test_count_returns_none_on_non_numeric_total(monkeypatch, auth):
    """Header with `*` total (PostgREST emits this when a HEAD-only
    request can't compute the count) -> None, not a crash."""
    fake = _fake_response(206, "0-0/*")
    monkeypatch.setattr("httpx.get", lambda *args, **kwargs: fake)
    _count = _load_count()
    n = _count("https://x", auth, "kills", {})
    assert n is None


def test_count_passes_table_name_through(monkeypatch, auth):
    """Sanity check : the URL constructed by _count carries the right
    table name. Catches a class of "wrong table name" typo regressions."""
    captured: dict[str, object] = {}

    def fake_get(url, **kwargs):  # type: ignore[no-untyped-def]
        captured["url"] = url
        captured["params"] = kwargs.get("params")
        return _fake_response(206, "0-0/1")

    monkeypatch.setattr("httpx.get", fake_get)
    _count = _load_count()
    _count("https://x", auth, "pipeline_jobs", {"status": "eq.failed"})
    assert "pipeline_jobs" in captured["url"]
    params = captured["params"] or {}
    assert params.get("status") == "eq.failed"
    assert params.get("limit") == "1"
    assert params.get("select") == "id"
