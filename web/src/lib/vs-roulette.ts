/**
 * VS Roulette — shared types + browser helpers.
 *
 * The roulette page (/vs) wires the user-facing filter UI to the
 * three Postgres RPCs shipped in migration 059_vs_roulette_and_bcc.sql :
 *
 *   - fn_pick_vs_pair(left_filters JSONB, right_filters JSONB)
 *       → returns { kill_a JSONB, kill_b JSONB } at random within
 *         each side's filter set.
 *   - fn_record_vs_vote(p_kill_a, p_kill_b, p_winner, p_session_hash, p_filters)
 *       → idempotently records the vote, updates ELO (K=32) and
 *         returns post-vote {elo, battles, wins} on each side.
 *   - fn_top_elo_kills(p_limit, p_filter_role, p_filter_champion)
 *       → leaderboard (battles_count >= 5 gate).
 *
 * Browser-only — no `server-only` import here so the client component
 * can grab the session hash + filter constants without a separate
 * server bridge.
 */

import type { Era } from "@/lib/eras";

// ════════════════════════════════════════════════════════════════════
// Types — JSON shape returned by the RPCs (mirrors the SQL projections)
// ════════════════════════════════════════════════════════════════════

/** Single kill row inside the `kill_a` / `kill_b` JSONB columns
 *  returned by `fn_pick_vs_pair`. Every field is nullable because the
 *  RPC LEFT-JOINs players / games / matches. */
export interface VSKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  killer_name: string | null;
  killer_role: string | null;
  victim_name: string | null;
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  clip_url_horizontal: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number | null;
  ai_description: string | null;
  ai_tags: string[] | null;
  multi_kill: string | null;
  is_first_blood: boolean | null;
  tracked_team_involvement: string | null;
  game_time_seconds: number | null;
  created_at: string | null;
  elo_rating: number | null;
  elo_battles: number | null;
  match_date: string | null;
}

/** Post-vote summary returned by `fn_record_vs_vote`. The RPC emits a
 *  single row containing both sides — we keep them flat to match. */
export interface VSVoteResult {
  kill_a_id: string;
  kill_a_elo: number;
  kill_a_battles: number;
  kill_a_wins: number;
  kill_b_id: string;
  kill_b_elo: number;
  kill_b_battles: number;
  kill_b_wins: number;
  inserted: boolean;
}

/** A single side of the cascaded filter UI. Every key is optional —
 *  empty side draws from the full pool. We send the JSON to Postgres
 *  exactly as-is, so the keys MUST match the ones the RPC parses
 *  (see `fn_pick_vs_pair` body). */
export interface VSFiltersSide {
  player_slug?: string;
  champion?: string;
  role?: "top" | "jungle" | "mid" | "bottom" | "support";
  era_slug?: string;
  era_date_start?: string;
  era_date_end?: string;
  multi_kill_min?: "double" | "triple" | "quadra" | "penta";
  is_first_blood?: boolean;
  min_highlight_score?: number;
}

/** Roster row sent from the server component → client filters. We
 *  keep the shape narrow (ign + role + slug) to minimise serialised
 *  RSC payload. */
export interface VSPlayerOption {
  ign: string;
  role: string | null;
  slug: string;
}

/** Era option used inside the client filter dropdown. Carries the
 *  pre-resolved ISO date window so the client doesn't need to
 *  re-derive it from the `Era` shape on every vote. */
export interface VSEraOption {
  id: string;
  label: string;
  period: string;
  color: string;
  dateStart: string;
  dateEnd: string;
}

// ════════════════════════════════════════════════════════════════════
// Session hash — stable per-browser id used by fn_record_vs_vote for
// dedup. The SQL guard is `length(p_session_hash) >= 16`.
// ════════════════════════════════════════════════════════════════════

const SESSION_KEY = "kckills_vs_session_id";

/** Returns the persistent VS-roulette session id, generating one on
 *  first call. Format : `vs-<hex32>` (≥ 16 chars, ≤ 35).
 *
 *  Safe to call during SSR — returns a placeholder that gets replaced
 *  on the first client effect. The hash is ALWAYS regenerated when
 *  localStorage is unavailable (private browsing) so each vote still
 *  gets a fresh id (won't dedup, but won't crash either). */
export function getVSSessionHash(): string {
  if (typeof window === "undefined") return "vs-ssr-placeholder-hash";
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 16) return existing;
    const fresh = generateSessionHash();
    window.localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // localStorage blocked (Safari private mode, embedded iframe, etc.)
    return generateSessionHash();
  }
}

function generateSessionHash(): string {
  // 16 random bytes → 32 hex chars. Prefix to make the id self-describing
  // in case it ever leaks into a log.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `vs-${hex}`;
}

// ════════════════════════════════════════════════════════════════════
// Filter helpers
// ════════════════════════════════════════════════════════════════════

/** Strip empty / undefined / null fields so the JSON payload stays
 *  small and Postgres treats the side as "no filter" when every key
 *  is empty. */
export function cleanFiltersSide(side: VSFiltersSide): VSFiltersSide {
  const out: VSFiltersSide = {};
  if (side.player_slug && side.player_slug.trim().length > 0) {
    out.player_slug = side.player_slug.trim();
  }
  if (side.champion && side.champion.trim().length > 0) {
    out.champion = side.champion.trim();
  }
  if (side.role) out.role = side.role;
  if (side.era_slug) out.era_slug = side.era_slug;
  if (side.era_date_start) out.era_date_start = side.era_date_start;
  if (side.era_date_end) out.era_date_end = side.era_date_end;
  if (side.multi_kill_min) out.multi_kill_min = side.multi_kill_min;
  if (side.is_first_blood === true) out.is_first_blood = true;
  if (
    typeof side.min_highlight_score === "number" &&
    side.min_highlight_score > 0
  ) {
    out.min_highlight_score = side.min_highlight_score;
  }
  return out;
}

/** Build a `VSEraOption` array from the canonical KC eras list. We
 *  drop entries that lack a date window (none today, but defensive). */
export function buildEraOptions(eras: Era[]): VSEraOption[] {
  return eras
    .filter((e) => e.dateStart && e.dateEnd)
    .map((e) => ({
      id: e.id,
      label: e.label,
      period: e.period,
      color: e.color,
      dateStart: e.dateStart,
      dateEnd: e.dateEnd,
    }));
}

// ════════════════════════════════════════════════════════════════════
// Audio — slot-machine "tchhhk" lock-in cue
// ════════════════════════════════════════════════════════════════════

/** Plays a synthesised mechanical-click using Web Audio API. No asset
 *  fetched ; one short oscillator + noise burst with a sharp envelope.
 *
 *  Called once at the end of the slot-machine animation. Silent + safe
 *  on prefers-reduced-motion (caller gates the invocation). Errors
 *  silently if AudioContext is unavailable. */
export function playLockInSfx(): void {
  if (typeof window === "undefined") return;
  try {
    type WindowWithWebkitAudio = Window &
      typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
    const w = window as WindowWithWebkitAudio;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    // Resume if the context started suspended (autoplay policy) —
    // browsers allow resume() right after a user gesture (the SPIN click).
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;

    // ─ Layer 1 — short noise burst (high freq) for the "tchhhk" body
    const bufferSize = Math.floor(ctx.sampleRate * 0.06);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 1800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.32, now + 0.005);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.08);

    // ─ Layer 2 — short low-freq "thunk" for the mechanical weight
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(0.4, now + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);

    // Close the context after the sound is done so we don't leak nodes.
    window.setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    }, 400);
  } catch {
    /* silent — sfx is decorative */
  }
}

// ════════════════════════════════════════════════════════════════════
// Misc constants for the UI
// ════════════════════════════════════════════════════════════════════

export const VS_ROLES: Array<{
  value: VSFiltersSide["role"];
  label: string;
}> = [
  { value: "top", label: "Top" },
  { value: "jungle", label: "Jungle" },
  { value: "mid", label: "Mid" },
  { value: "bottom", label: "Bot" },
  { value: "support", label: "Support" },
];

export const VS_MULTIKILL_OPTIONS: Array<{
  value: VSFiltersSide["multi_kill_min"];
  label: string;
}> = [
  { value: "double", label: "Double+" },
  { value: "triple", label: "Triple+" },
  { value: "quadra", label: "Quadra+" },
  { value: "penta", label: "Penta" },
];

/** Pretty-print "+18" / "-18" / "±0" given a delta. */
export function formatEloDelta(delta: number): string {
  if (delta === 0) return "±0";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(Math.round(delta))}`;
}

/** Computes the win % from {wins, battles}. Returns 0 if battles=0. */
export function winRatePct(wins: number, battles: number): number {
  if (battles <= 0) return 0;
  return Math.round((wins / battles) * 100);
}
