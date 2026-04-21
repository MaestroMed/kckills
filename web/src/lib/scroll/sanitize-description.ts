/**
 * sanitizeDescription — frontend safety net for AI-generated clip
 * descriptions.
 *
 * Mirror of the worker's analyzer.py post-validation: rejects any
 * description that contains encoding artifacts, known hallucinations
 * or banned phrases identified in the Opus 4.7 audit. Returns a safe
 * fallback string built from killer/victim/fightType so we never
 * ship visibly corrupted text to the user.
 *
 * This is BELT-AND-SUSPENDERS — the worker should already filter
 * these out, but bad rows already exist in production until they're
 * regenerated. The helper makes those rows render usable text in the
 * meantime.
 *
 * Used by:
 *   - components/ClipReel.tsx       (compact-grid card)
 *   - components/scroll/ScrollFeed.tsx       (v1 video + moment items)
 *   - components/scroll/v2/FeedItem.tsx      (v2 video + moment items)
 *   - components/HomeRareCards.tsx
 *   - components/KillOfTheWeek.tsx
 *   - components/tcg/ClipCard.tsx
 */

const ENCODING_PATTERNS: RegExp[] = [
  /\$/, // LaTeX dollar
  /\\text\{/, // \text{...}
  /&[a-z]+;/, // HTML entities
  /\\u00[0-9a-f]{2}/, // raw \uXXXX escapes
  /<[a-z]+\/?>/, // stray HTML tags
];

const HALLUCINATION_PATTERNS: RegExp[] = [
  /lance-tolet/i,
  /essence of[a-z]?/i,
  /kal[ée]idoscope fant/i,
];

const BANNED_PHRASES: RegExp[] = [
  // Relaxed — only reject truly broken descriptions, not imperfect ones.
  // The backoffice /review lets the admin fix individual descriptions manually.
];

const MIN_LENGTH = 40;

/** Returns true if the description is safe to display as-is. */
export function isDescriptionClean(text: string | null | undefined): boolean {
  if (!text) return false;
  const stripped = text.trim();
  if (stripped.length < MIN_LENGTH) return false;
  for (const pat of ENCODING_PATTERNS) if (pat.test(stripped)) return false;
  for (const pat of HALLUCINATION_PATTERNS) if (pat.test(stripped)) return false;
  for (const pat of BANNED_PHRASES) if (pat.test(stripped)) return false;
  return true;
}

interface FallbackContext {
  killer?: string | null;
  victim?: string | null;
  fightType?: string | null;
  multiKill?: string | null;
  isFirstBlood?: boolean | null;
  isKcKill?: boolean | null;
}

const FIGHT_LABEL: Record<string, string> = {
  solo_kill: "duel",
  skirmish_2v2: "skirmish 2v2",
  skirmish_3v3: "skirmish 3v3",
  teamfight_4v4: "teamfight 4v4",
  teamfight_5v5: "teamfight 5v5",
  gank: "gank",
  pick: "pick",
};

/** Build a clean factual fallback when the AI description is unusable. */
export function buildFallbackDescription(ctx: FallbackContext): string {
  const killer = ctx.killer ?? "?";
  const victim = ctx.victim ?? "?";
  const fight = ctx.fightType ? FIGHT_LABEL[ctx.fightType] ?? ctx.fightType : null;
  const tags: string[] = [];
  if (ctx.isFirstBlood) tags.push("first blood");
  if (ctx.multiKill) tags.push(`${ctx.multiKill} kill`);
  const tagSuffix = tags.length > 0 ? ` (${tags.join(", ")})` : "";
  const fightSuffix = fight ? ` en ${fight}` : "";
  return `${killer} → ${victim}${fightSuffix}${tagSuffix}`;
}

/**
 * One-call shape for components: returns the description if clean,
 * or a built fallback. Components don't need to know about validation.
 */
export function safeDescription(
  text: string | null | undefined,
  fallbackCtx: FallbackContext,
): string {
  if (isDescriptionClean(text)) return text!.trim();
  return buildFallbackDescription(fallbackCtx);
}
