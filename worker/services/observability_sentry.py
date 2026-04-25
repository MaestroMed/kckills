"""
OBSERVABILITY_SENTRY — Sentry SDK init for the Python worker.

Wave 11 / DB ownership : Python worker error tracking (P0 launch blocker).

Design rules
============
1. ZERO BEHAVIOR CHANGE WHEN UNCONFIGURED.
   If KCKILLS_SENTRY_DSN_WORKER is unset (or sentry-sdk isn't installed),
   `init_sentry()` returns silently. The worker keeps running exactly as
   before. This matters because we don't want to break Mehdi's local
   pipeline if the Sentry tier expires or someone forks the repo.

2. NO PII / SECRETS UPSTREAM.
   `_strip_sensitive_data` walks every event payload before it leaves
   the worker and redacts :
     - Cookie / Authorization / x-api-key style headers.
     - The Supabase service-role JWT (eyJ... patterns).
     - Anthropic / Gemini / Riot / YouTube API keys.
     - YouTube cookies extracted from the Firefox profile.
   Defense-in-depth on top of Sentry's default scrubbers — we don't
   trust the upstream config.

3. NO CONFLICT WITH structlog.
   sentry-sdk's logging integration latches onto the stdlib `logging`
   module. structlog routes through stdlib by default, so we get
   automatic breadcrumbs for free. We DO NOT replace structlog.

4. ASYNC-AWARE.
   AsyncioIntegration patches asyncio.create_task so exceptions in
   supervised modules surface even when the parent gather() doesn't
   re-raise them. HttpxIntegration auto-traces every outbound call.
"""

from __future__ import annotations

import os
from typing import Any

# We import sentry_sdk lazily inside init_sentry() so that a missing
# install (e.g. someone runs the worker without `pip install -r
# requirements.txt` after this PR) doesn't crash imports elsewhere in
# the codebase.

_INITIALIZED = False


# ── Sensitive value patterns ────────────────────────────────────────
# Lower-cased substrings ; we match prefix-insensitive on header names
# AND on dict keys nested inside event extras / breadcrumbs.
_SENSITIVE_HEADER_KEYS = {
    "cookie",
    "set-cookie",
    "authorization",
    "x-api-key",
    "apikey",
    "x-supabase-auth",
    "x-riot-token",
    "x-goog-api-key",
}

_SENSITIVE_ENV_KEYS = {
    "supabase_service_key",
    "supabase_service_role_key",
    "gemini_api_key",
    "anthropic_api_key",
    "riot_api_key",
    "discord_webhook_url",
    "r2_secret_access_key",
    "r2_access_key_id",
    "youtube_api_key",
    "lolesports_api_key",
    "vapid_private_key",
    "kckills_yt_cookies_file",
    "next_public_supabase_anon_key",
}

_FILTERED = "[Filtered]"


def _redact_dict_in_place(d: dict[str, Any]) -> None:
    """Walk a dict, redacting values keyed by sensitive names."""
    for key in list(d.keys()):
        lower = key.lower()
        if (
            lower in _SENSITIVE_HEADER_KEYS
            or lower in _SENSITIVE_ENV_KEYS
            or "secret" in lower
            or "token" in lower
            or "password" in lower
        ):
            d[key] = _FILTERED
        elif isinstance(d[key], dict):
            _redact_dict_in_place(d[key])


def _strip_sensitive_data(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    """before_send hook : redact secrets from outgoing events."""
    try:
        # Request headers/cookies (HTTP integrations attach these).
        request = event.get("request")
        if isinstance(request, dict):
            if "cookies" in request:
                request["cookies"] = _FILTERED
            if isinstance(request.get("headers"), dict):
                _redact_dict_in_place(request["headers"])
            if isinstance(request.get("data"), dict):
                _redact_dict_in_place(request["data"])

        # Breadcrumbs : strip headers from each crumb's data.
        for crumb in event.get("breadcrumbs", {}).get("values", []) or []:
            data = crumb.get("data")
            if isinstance(data, dict):
                _redact_dict_in_place(data)

        # Extra context + tags + contexts.
        for bag_name in ("extra", "tags", "contexts"):
            bag = event.get(bag_name)
            if isinstance(bag, dict):
                _redact_dict_in_place(bag)

        # Exception messages : scrub embedded JWTs / API keys.
        import re

        jwt_pat = re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
        api_key_pat = re.compile(r"\b[A-Za-z0-9_-]{32,}\b")
        for ex in event.get("exception", {}).get("values", []) or []:
            if isinstance(ex.get("value"), str):
                ex["value"] = jwt_pat.sub("[JWT_FILTERED]", ex["value"])
                # Don't blindly strip every long token — only the well-known
                # prefixes / suffixes. False positives here would make
                # production bug reports unreadable.
                ex["value"] = re.sub(
                    r"(api[_-]?key|token|secret|webhook)[\"'=:\s]+[A-Za-z0-9_./-]{16,}",
                    r"\1=[Filtered]",
                    ex["value"],
                    flags=re.IGNORECASE,
                )

        # Drop the YouTube cookies file body if it ever ends up in extras.
        if isinstance(event.get("extra"), dict):
            for k in list(event["extra"].keys()):
                if "cookie" in k.lower():
                    event["extra"][k] = _FILTERED

        return event
    except Exception:  # pragma: no cover — defensive ; never break logging
        return event


def init_sentry() -> None:
    """Initialize Sentry SDK for the Python worker.

    Idempotent : safe to call multiple times. No-op when the worker DSN
    env var is absent OR when sentry-sdk isn't importable.
    """
    global _INITIALIZED
    if _INITIALIZED:
        return

    dsn = os.environ.get("KCKILLS_SENTRY_DSN_WORKER") or os.environ.get("SENTRY_DSN_WORKER")
    if not dsn:
        return  # Gracefully skip — keeps prod safe + dev quiet.

    try:
        import sentry_sdk
        from sentry_sdk.integrations.asyncio import AsyncioIntegration
        from sentry_sdk.integrations.httpx import HttpxIntegration
    except ImportError:
        # sentry-sdk not installed yet (e.g. operator hasn't pip
        # installed the new requirements). Don't crash the worker.
        return

    integrations: list[Any] = [AsyncioIntegration(), HttpxIntegration()]

    # Optional integrations — wrapped in their own try/except because
    # they're shipped in newer sentry-sdk releases that older installs
    # might not have.
    try:
        from sentry_sdk.integrations.logging import LoggingIntegration
        import logging

        integrations.append(
            LoggingIntegration(
                level=logging.INFO,        # Breadcrumbs from INFO+
                event_level=logging.ERROR,  # Send ERROR+ as events
            )
        )
    except ImportError:
        pass

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("KCKILLS_ENV", "production"),
        release=os.environ.get("KCKILLS_RELEASE", "dev"),
        # Keep server-name human-readable ; Mehdi runs the worker on his
        # own PC, so the hostname is meaningful.
        server_name=os.environ.get("WORKER_HOSTNAME", "kckills-worker"),
        # Performance — 10% sample stays well under the 100K perf events
        # /mo free ceiling at our scale (~1500 worker cycles/day across
        # all modules ~ 45K/mo before sampling).
        traces_sample_rate=0.1,
        # Profiling — 10% of traced transactions get a CPU profile too.
        profiles_sample_rate=0.1,
        integrations=integrations,
        before_send=_strip_sensitive_data,
        # Don't auto-attach stack frames for warnings ; saves quota.
        attach_stacktrace=False,
        # PII : Sentry's default is False ; keep it explicit.
        send_default_pii=False,
        # Silent on init success ; we don't want to clutter Mehdi's logs.
        debug=False,
    )

    # Tag the role so we can group errors by orchestrator child.
    role = os.environ.get("KCKILLS_WORKER_ROLE", "solo")
    sentry_sdk.set_tag("worker_role", role)

    _INITIALIZED = True


def is_initialized() -> bool:
    """For tests / introspection."""
    return _INITIALIZED
