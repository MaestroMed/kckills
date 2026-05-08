"""GeminiProvider — Google Gemini 3.1 Flash-Lite (Wave 19.9 — Phase 2 wired).

Implements `services.ai_router.AIProvider` over `services.gemini_client.analyze`.

Constraints (vs. the analyzer's direct SDK call in modules/analyzer.py)
─────────────────────────────────────────────────────────────────────
* `task.clip_url` MUST be a LOCAL FILE PATH if vision is requested. The
  upstream `gemini_client.analyze` calls `client.files.upload(file=...)`
  which only accepts a path on disk. R2 URLs would silently fail. The
  router-aware translator daemon doesn't pass clip_url today (text-only
  routing) ; if a future caller needs URL ingestion, add a download step
  here or in a wrapper provider.

* No `response_schema` constraint. `gemini_client.analyze` issues a
  free-form prompt with `response_mime_type=application/json`. That's
  enough for clip-vision QC + free-form description tasks. Callers that
  need the rigid `ANALYSIS_RESPONSE_SCHEMA` shape (the production
  analyzer) keep using `modules/analyzer.py::analyze_kill` directly —
  the router is for the long-tail / fallback / experimental callers.

* Quota delegation. `quota_remaining()` reads from the global
  `scheduler` so the router shares the same budget ledger as the
  analyzer's direct calls. No double-counting risk.
"""

from __future__ import annotations

import os

import structlog

from services.ai_router import (
    AIProvider,
    AITask,
    AnalysisResult,
    ProviderUnavailable,
)

log = structlog.get_logger()


class GeminiProvider:
    """Implements AIProvider for Google Gemini Flash-Lite via gemini_client."""

    name: str = "gemini"
    model_name: str = "gemini-3.1-flash-lite"
    # USD per 1M tokens — see ai_pricing.GEMINI_PRICES (single source of truth).
    cost_per_m_input: float = 0.10
    cost_per_m_output: float = 0.40
    supports_vision: bool = True
    # Wave 11 — Google Cloud paid tier is PII-friendly. Free tier has
    # the "may be used for training" clause so callers should NOT route
    # has_pii=True tasks here when on free tier ; the production deploy
    # uses paid keys exclusively, so this stays True.
    is_pii_safe: bool = True

    # Default daily ceiling — only used as a fallback when the global
    # scheduler isn't reachable (e.g. in tests or from a side-process).
    # In production `quota_remaining` reads the live count from
    # `scheduler.get_remaining("gemini")` instead.
    DEFAULT_DAILY_CAP: int = 950  # 5% margin under the 1000 RPD limit

    def __init__(self, api_key: str | None = None,
                 daily_cap: int | None = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or ""
        self.daily_cap = daily_cap if daily_cap is not None else self.DEFAULT_DAILY_CAP

    async def analyze_clip(self, task: AITask) -> AnalysisResult:
        """Run the task through gemini_client.analyze.

        Behaviour
        ─────────
        * `requires_vision=True` + `clip_url` set → uploads the local
          file to Gemini for multimodal analysis.
        * `requires_vision=True` + `clip_url=None` → router shouldn't
          have picked us, but we tolerate it and do a text-only call.
        * `requires_vision=False` → text-only call (`gemini_client`
          drops the upload step).

        Failure modes (all raise `ProviderUnavailable` so the router
        falls back gracefully) :

        * No API key configured → "gemini: no API key configured".
        * `gemini_client.analyze` returned None → "gemini returned None"
          (covers : SDK missing, daily quota exhausted, JSON parse
          error, transient API exception — all already logged inside
          gemini_client itself).
        """
        if not self.api_key:
            raise ProviderUnavailable("gemini: no API key configured")

        # Lazy import — avoids pulling the google-genai SDK at module
        # load time, matching the pattern used in modules/analyzer.py.
        from services import gemini_client

        video_path = task.clip_url if task.requires_vision else None
        try:
            raw = await gemini_client.analyze(task.prompt, video_path=video_path)
        except Exception as e:
            # gemini_client already swallows most exceptions and returns
            # None ; this is the belt-and-braces last layer.
            log.warn("gemini_provider_threw", error=str(e)[:200])
            raise ProviderUnavailable(f"gemini exception: {type(e).__name__}") from e

        if raw is None:
            # gemini_client logs the specific reason (no key, quota,
            # parse error, etc.) — we just surface a uniform
            # "unavailable" so the router falls back.
            raise ProviderUnavailable("gemini returned None")

        usage = raw.get("_usage") or {}
        # The `description_fr` key is the analyzer's primary output ;
        # callers that need it set their own prompt to ask for it. Free-
        # form prompts (translator, qc) populate other keys — we surface
        # those via raw_response so the caller can pull out what it
        # asked for.
        return AnalysisResult(
            highlight_score=raw.get("highlight_score"),
            tags=raw.get("tags") or [],
            description=raw.get("description_fr") or raw.get("description"),
            confidence=raw.get("confidence_score") or raw.get("confidence"),
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("candidates_tokens"),
            raw_response=raw,
            text=raw.get("text") if isinstance(raw.get("text"), str) else None,
        )

    async def quota_remaining(self) -> int | None:
        """Return live remaining Gemini calls for today.

        Reads from the shared `scheduler` ledger so the router never
        double-counts against a budget the analyzer (direct path) is
        already drawing from.

        Returns None when the scheduler isn't reachable (test contexts) ;
        the router treats None as "unknown, not blocked". Returns 0 when
        no API key is set so the router skips this provider cleanly.
        """
        if not self.api_key:
            return 0
        try:
            from scheduler import scheduler
            remaining = scheduler.get_remaining("gemini")
            if remaining is None:
                return None
            return max(0, int(remaining))
        except Exception:
            # Test / side-process fallback — local counter only.
            return self.daily_cap
