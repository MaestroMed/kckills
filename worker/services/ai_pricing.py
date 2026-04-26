"""
AI_PRICING — token cost computation per model.

Single source of truth for "how much did this Gemini call cost". Used by
the analyzer when it inserts an ai_annotations row so the
v_ai_cost_24h view in Supabase shows real spend per model.

Prices are USD per 1M tokens (input, output). Update when Google changes
the rate card. Last refreshed : 24 avr 2026.

Reference :
  - https://ai.google.dev/pricing
  - Gemini 2.5 Flash-Lite : $0.10 in / $0.40 out per 1M tokens
  - Gemini 2.5 Pro        : $1.25 in / $10.00 out per 1M tokens
  - Gemini 3 Flash        : $0.30 in / $2.50 out per 1M tokens
  - Gemini 3 Pro Preview  : $3.50 in / $15.00 out per 1M tokens
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
    # Aliases / preview model names we've seen in the lab
    "gemini-3.1-flash-lite":          (0.10, 0.40),
    "gemini-3.1-pro-preview":         (3.50, 15.00),
}

DEFAULT_PRICE: tuple[float, float] = (0.10, 0.40)


def compute_gemini_cost(
    model_name: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
) -> float | None:
    """Return the USD cost of a Gemini call, or None if tokens are unknown.

    Guarantees a non-negative float. Unknown models fall back to the
    Flash-Lite rate so we never blow up on a typo — but log nothing here
    (the caller does its own structlog).
    """
    if input_tokens is None and output_tokens is None:
        return None
    in_price, out_price = GEMINI_PRICES.get(model_name or "", DEFAULT_PRICE)
    in_tok = max(0, int(input_tokens or 0))
    out_tok = max(0, int(output_tokens or 0))
    cost = (in_tok * in_price + out_tok * out_price) / 1_000_000.0
    return round(cost, 6)
