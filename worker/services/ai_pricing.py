"""
AI_PRICING — token cost computation per model.

Single source of truth for "how much did this Gemini call cost". Used by
the analyzer when it inserts an ai_annotations row so the
v_ai_cost_24h view in Supabase shows real spend per model.

Prices are USD per 1M tokens (input, output). Update when Google changes
the rate card. Last refreshed : 14 mai 2026 — added Gemini 3.5 Flash.

Reference :
  - https://ai.google.dev/pricing
  - https://deepmind.google/models/model-cards/gemini-3-5-flash/

Verified prices (2026-05-14) :
  - Gemini 3.5 Flash         : $1.50 in / $9.00 out per 1M tokens
                                ($0.15 cached input — see compute helper)
                                GA 2026-05-19, beats 3.1 Pro on agentic.
  - Gemini 3.1 Flash-Lite    : $0.10 in / $0.40 out per 1M tokens
  - Gemini 3.1 Pro Preview   : $3.50 in / $15.00 out per 1M tokens
  - Gemini 3 Flash           : $0.30 in / $2.50 out per 1M tokens
  - Gemini 2.5 Flash-Lite    : $0.10 in / $0.40 out per 1M tokens
  - Gemini 2.5 Flash         : $0.30 in / $2.50 out per 1M tokens
  - Gemini 2.5 Pro           : $1.25 in / $10.00 out per 1M tokens
"""

from __future__ import annotations

# ─── Price table (USD per 1M tokens) ─────────────────────────────────
# Keys are the model_name strings we pass to GenerativeModel(...). Add a
# new key when we adopt a new model. Falls back to the cheapest tier so
# we never silently overcharge — the worst case is under-reporting cost
# for an exotic preview model, which is still better than a KeyError.

GEMINI_PRICES: dict[str, tuple[float, float]] = {
    # Flash-Lite (free + paid tier)
    "gemini-2.5-flash-lite":          (0.10, 0.40),
    "gemini-2.5-flash":               (0.30, 2.50),
    "gemini-2.5-pro":                 (1.25, 10.00),
    # Gemini 3 family
    "gemini-3-flash":                 (0.30, 2.50),
    "gemini-3-flash-lite":            (0.10, 0.40),
    "gemini-3-pro-preview":           (3.50, 15.00),
    # Gemini 3.1 family
    "gemini-3.1-flash-lite":          (0.10, 0.40),
    "gemini-3.1-pro-preview":         (3.50, 15.00),
    # Gemini 3.5 family (Wave 33 — GA 2026-05-19)
    # Positionnée comme remplacement de 2.5-pro : qualité Pro à vitesse
    # Flash, beats 3.1 Pro sur les benchmarks agentic. Cached-input
    # $0.15/M tokens (10× moins) — bonus séparé via compute helper.
    "gemini-3.5-flash":               (1.50, 9.00),
}

# Cached input pricing — when the same prompt prefix is reused inside the
# implicit cache window (Gemini batches identical context across calls
# under the hood). 10× cheaper than the full input rate for 3.5 Flash.
# Not all models support implicit caching ; absent keys fall back to the
# full input rate.
GEMINI_CACHED_INPUT_PRICES: dict[str, float] = {
    "gemini-3.5-flash":               0.15,
    # Older Flash family didn't have an explicit cached tier.
}

DEFAULT_PRICE: tuple[float, float] = (0.10, 0.40)


def compute_gemini_cost(
    model_name: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
    cached_input_tokens: int | None = None,
) -> float | None:
    """Return the USD cost of a Gemini call, or None if tokens are unknown.

    Guarantees a non-negative float. Unknown models fall back to the
    Flash-Lite rate so we never blow up on a typo — but log nothing here
    (the caller does its own structlog).

    Wave 33 — `cached_input_tokens` (optional) splits the input bucket
    between full-price tokens and the implicit-cache discount tier
    (Gemini 3.5 Flash exposes a 10× cheaper rate when the prompt prefix
    is reused across calls within the cache window). Callers that don't
    surface cached usage just leave it None.
    """
    if input_tokens is None and output_tokens is None and cached_input_tokens is None:
        return None
    in_price, out_price = GEMINI_PRICES.get(model_name or "", DEFAULT_PRICE)
    in_tok = max(0, int(input_tokens or 0))
    out_tok = max(0, int(output_tokens or 0))
    cached_tok = max(0, int(cached_input_tokens or 0))
    # Cached tokens are part of the input window but billed at a lower
    # rate — subtract them from the full-price bucket first.
    full_in_tok = max(0, in_tok - cached_tok)
    cached_price = GEMINI_CACHED_INPUT_PRICES.get(model_name or "", in_price)
    cost = (
        full_in_tok * in_price
        + cached_tok * cached_price
        + out_tok * out_price
    ) / 1_000_000.0
    return round(cost, 6)
