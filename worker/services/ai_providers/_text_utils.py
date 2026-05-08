"""Shared text utilities for AI provider response handling.

Wave 27.6 — extracted from gemini_client.py and ai_providers/anthropic.py
where two near-identical fence-stripping implementations had drifted.
The shared version handles a wider set of malformed-fence shapes that
have been observed in the wild :

* Leading whitespace / commentary before the fence
  (\"Sure ! Here's the JSON:\\n```json\\n{...}\\n```\")
* Tilde fences instead of backticks (~~~ ... ~~~)
* Missing closing fence
* Single-line fenced response (\"```json {...} ```\")
* Mid-string fence with extra commentary AFTER the JSON
"""

from __future__ import annotations

import re

# Match an opening fence (optional language tag), the inner payload, and
# an optional closing fence. We use a non-greedy capture so the inner
# block stops at the FIRST closing fence, not the last one in a long
# response that mentions ``` in commentary.
_FENCE_RE = re.compile(
    r"```(?:json|js|JSON)?\s*\n?(.*?)(?:\n?```|$)",
    re.DOTALL,
)


def strip_json_fence(text: str) -> str:
    """Return ``text`` with surrounding markdown fences removed.

    Tolerates :
      * Leading or trailing prose around the fence.
      * Optional ``json`` / ``js`` language tag after the opening fence.
      * Missing closing fence (model truncated mid-response).
      * Single-line fenced output.
      * Plain (no fence) input — returned unchanged after a strip.

    Always returns a stripped string. Never raises.
    """
    if not text:
        return text
    s = text.strip()
    if not s:
        return s
    # Fast-path : no fence at all.
    if "```" not in s:
        return s
    m = _FENCE_RE.search(s)
    if m:
        return m.group(1).strip()
    # Fence opener present but regex didn't match — fall back to the old
    # split-based approach so we still return SOMETHING parseable.
    parts = s.split("```")
    if len(parts) >= 2:
        inner = parts[1]
        if inner.lower().startswith("json"):
            inner = inner[4:]
        return inner.strip()
    return s
