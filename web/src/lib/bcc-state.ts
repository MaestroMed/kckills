/**
 * BCC state helpers — Wave 25.3 / V59 client-side bookkeeping for the
 * Antre de la BCC easter egg (migration 059).
 *
 * Mirrors `getVSSessionHash()` from `@/lib/vs-roulette` : a stable random
 * id stashed in `localStorage` and reused across the three BCC RPCs
 * (`fn_bcc_punch`, `fn_bcc_tomato`, `fn_bcc_ahou_played`). The SQL guard
 * is `length(p_session_hash) >= 16`, so we always emit 35-char `bcc-<hex32>`.
 *
 * Also exposes the "member" flag — once the BCC ritual fires on Bo's
 * page, we flip `bcc_member` to `"true"` so we can surface a discreet
 * "BCC" hint next time. The cave itself STILL requires the ritual to be
 * performed every visit (per spec) — the flag only unlocks the hint.
 */

const SESSION_KEY = "kckills_bcc_session_id";
const MEMBER_KEY = "bcc_member";

/** Returns the persistent BCC session id, generating one on first call.
 *  Safe to call during SSR — returns a placeholder that gets replaced on
 *  the first client effect. */
export function getBCCSessionHash(): string {
  if (typeof window === "undefined") return "bcc-ssr-placeholder-hash";
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 16) return existing;
    const fresh = generateSessionHash();
    window.localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // localStorage blocked (private browsing, embedded iframe, etc.)
    return generateSessionHash();
  }
}

function generateSessionHash(): string {
  // 16 random bytes → 32 hex chars. `bcc-` prefix makes the id
  // self-describing if it ever leaks into a log.
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
  return `bcc-${hex}`;
}

/** Returns true once the user has performed the BCC ritual at least
 *  once. Drives the subtle "BCC" hint badge on Bo's player page. The
 *  cave itself still requires the ritual every time. */
export function isBCCMember(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MEMBER_KEY) === "true";
  } catch {
    return false;
  }
}

export function markBCCMember(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEMBER_KEY, "true");
  } catch {
    // ignore — private mode
  }
}
