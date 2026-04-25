/**
 * track.ts — anonymous + authenticated event tracker.
 *
 * Public API : track(eventType, opts)
 *
 * Behaviour :
 *   - Generates / retrieves an anonymous_user_id stored in localStorage
 *     ("kc_anon_id"). Crypto.randomUUID() on first call.
 *   - Generates a session_id once per tab, stored in sessionStorage
 *     ("kc_session_id"). Survives reloads of the same tab, NOT across tabs.
 *   - Buffers events in memory. Flushes :
 *        * every 5 seconds (debounced timer)
 *        * OR when the buffer reaches BATCH_THRESHOLD (10 events)
 *        * OR on visibilitychange "hidden" + pagehide / beforeunload
 *          via navigator.sendBeacon (survives tab close).
 *   - POSTs to /api/track with batched events.
 *   - Detects client_kind from window.matchMedia + display-mode standalone.
 *   - Detects network_class from navigator.connection.effectiveType.
 *   - Detects locale from the kc_lang cookie (if present), falling back to
 *     navigator.language → "fr".
 *
 * SAFETY :
 *   - Every code path is wrapped in try/catch — the tracker MUST be silent
 *     on failure (network blip, ad blocker, sandboxed iframe, etc.). It
 *     NEVER throws and NEVER blocks the calling code path.
 *   - SSR-safe : returns immediately if `window` / `navigator` undefined.
 *
 * The /api/track endpoint sanitises payload server-side : metadata strings
 * > 200 chars are dropped, nested objects > 1KB are dropped, key/value
 * patterns matching email/phone/IP are stripped. The client trusts the
 * server to do the final sanitation pass — we just enforce minimal
 * structural validity here.
 */

// ─── Types ─────────────────────────────────────────────────────────────

/** Allowed event_type values — kept in sync with migration 029. */
export type EventType =
  // Scroll feed events
  | "feed.view"
  | "feed.mode_live_entered"
  | "feed.mode_live_exited"
  | "clip.viewed"
  | "clip.started"
  | "clip.completed"
  | "clip.replayed"
  | "clip.skipped"
  | "clip.shared"
  | "clip.liked"
  | "clip.rated"
  | "clip.opened"
  // Wave 6 — scroll feed UX polish (Agent AB).
  // Fired by FeedItemError when a video element 404s / decodes-fail.
  // Fired by FeedItem swipe-left handler / share keyboard shortcut.
  // Fired by FeedItem offline transitions for retention diagnostics.
  | "clip.error"
  | "feed.scroll_restored"
  | "feed.offline_entered"
  | "feed.offline_exited"
  // Browse
  | "page.viewed"
  | "player.opened"
  | "match.opened"
  | "tournament.opened"
  | "search.executed"
  | "timeline.era_selected"
  // Interaction
  | "comment.created"
  // Wave 7 — comment voting (Agent AF). Fired by CommentSheetV2 +
  // KillInteractions when a user toggles a vote on a comment.
  // metadata: { vote: -1 | 0 | 1, prev: -1 | 0 | 1 }. Whitelisted in
  // migration 038 alongside the comment_votes table.
  | "comment.voted"
  | "language.changed"
  | "quality.changed"
  | "mute.toggled"
  | "install.prompted"
  | "install.accepted"
  // Auth
  | "auth.signup"
  | "auth.login"
  | "auth.logout"
  // Riot link (optional secondary OAuth — fired by /api/auth/riot/* +
  // RiotLinkCard). Requires migration 040 to extend the user_events
  // event_type CHECK constraint, otherwise inserts are silently dropped
  // by Postgres (the tracker is best-effort by design — same pattern as
  // the Wave 6 events).
  | "auth.riot_linked"
  | "auth.riot_unlinked"
  | "riot.link_started"
  // Push notifications
  | "push.subscribed"
  | "push.unsubscribed"
  | "push.permission_denied"
  | "push.preferences_updated";

export type ClientKind = "mobile" | "desktop" | "tablet" | "pwa";
export type NetworkClass = "fast" | "medium" | "slow";

export interface TrackMetadata {
  [key: string]: unknown;
}

export interface TrackOpts {
  entityType?: string;
  entityId?: string;
  metadata?: TrackMetadata;
}

interface QueuedEvent {
  event_type: EventType;
  entity_type?: string;
  entity_id?: string;
  metadata?: TrackMetadata;
  client_kind: ClientKind;
  network_class: NetworkClass | null;
  locale: string;
  anonymous_user_id: string;
  session_id: string;
  client_ts: string;
}

// ─── Constants ─────────────────────────────────────────────────────────

const ANON_ID_KEY = "kc_anon_id";
const SESSION_ID_KEY = "kc_session_id";
const TRACK_ENDPOINT = "/api/track";

const FLUSH_INTERVAL_MS = 5000;
const BATCH_THRESHOLD = 10;
const MAX_BUFFER_SIZE = 200; // hard cap to bound memory if endpoint is down

// ─── Module-scope state ────────────────────────────────────────────────

let buffer: QueuedEvent[] = [];
let flushTimer: number | null = null;
let unloadHooksInstalled = false;

// ─── Identity helpers ──────────────────────────────────────────────────

/** Read or create the localStorage anonymous id. SSR-safe. */
function getOrCreateAnonId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = generateUuid();
    window.localStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    // localStorage blocked (private mode, sandbox, etc.) — generate a
    // throwaway id for this call. Won't persist, but events still fire.
    return generateUuid();
  }
}

/** Read or create the sessionStorage per-tab session id. SSR-safe. */
function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = generateUuid();
    window.sessionStorage.setItem(SESSION_ID_KEY, fresh);
    return fresh;
  } catch {
    return generateUuid();
  }
}

/** crypto.randomUUID with a non-crypto fallback for very old browsers. */
function generateUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // RFC4122 v4-ish fallback — good enough for an anon id when
  // crypto.randomUUID is missing.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else if (i === 14) {
      out += "4";
    } else if (i === 19) {
      out += hex[(Math.random() * 4) | 8];
    } else {
      out += hex[(Math.random() * 16) | 0];
    }
  }
  return out;
}

// ─── Client classification ─────────────────────────────────────────────

function detectClientKind(): ClientKind {
  if (typeof window === "undefined") return "desktop";
  try {
    // PWA detection takes precedence over mobile/desktop — a phone in
    // standalone PWA mode reports "pwa", not "mobile", so we can split
    // the metric.
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return "pwa";
    }
    // Tablet : 600px ≤ width < 1024px AND coarse pointer (touch).
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 600px) and (max-width: 1023px) and (pointer: coarse)").matches
    ) {
      return "tablet";
    }
    // Mobile : narrow viewport AND coarse pointer.
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 599px), (pointer: coarse) and (max-width: 767px)").matches
    ) {
      return "mobile";
    }
  } catch {
    /* matchMedia missing or sandboxed — fall through to desktop */
  }
  return "desktop";
}

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

function detectNetworkClass(): NetworkClass | null {
  if (typeof navigator === "undefined") return null;
  try {
    const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection;
    if (!conn || typeof conn.effectiveType !== "string") return null;
    switch (conn.effectiveType) {
      case "4g":
      case "5g":
        return "fast";
      case "3g":
        return "medium";
      case "2g":
      case "slow-2g":
        return "slow";
      default:
        return null;
    }
  } catch {
    return null;
  }
}

const LANG_COOKIE = "kc_lang";

function detectLocale(): string {
  if (typeof document !== "undefined") {
    try {
      const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([^;]+)`));
      if (m && m[1]) {
        const v = m[1].trim();
        if (/^[a-z]{2}$/i.test(v)) return v.toLowerCase();
      }
    } catch {
      /* document.cookie blocked — fall through */
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    const prefix = navigator.language.split("-")[0];
    if (prefix && prefix.length === 2) return prefix.toLowerCase();
  }
  return "fr";
}

// ─── Flush logic ───────────────────────────────────────────────────────

function scheduleFlush(): void {
  if (typeof window === "undefined") return;
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function clearFlushTimer(): void {
  if (typeof window === "undefined") return;
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const events = buffer.splice(0, buffer.length);
  const payload = JSON.stringify({ events });
  try {
    const res = await fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      // keepalive lets the browser send the request even if the tab is
      // closing — but it has a 64KB cap, so we mostly rely on the
      // sendBeacon path in the unload hooks.
      keepalive: true,
      credentials: "same-origin",
    });
    if (!res.ok && res.status >= 500) {
      // Server error — re-queue silently up to MAX_BUFFER_SIZE so we
      // don't lose data on transient outages.
      if (buffer.length + events.length <= MAX_BUFFER_SIZE) {
        buffer = events.concat(buffer);
      }
    }
  } catch {
    // Network blip / blocked by ad blocker / CORS — silently re-queue.
    if (buffer.length + events.length <= MAX_BUFFER_SIZE) {
      buffer = events.concat(buffer);
    }
  }
}

/** Best-effort flush via sendBeacon for the unload path. */
function flushViaBeacon(): void {
  if (buffer.length === 0) return;
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
    // No beacon API — try a synchronous-ish fetch with keepalive.
    void flush();
    return;
  }
  try {
    const events = buffer.splice(0, buffer.length);
    const blob = new Blob([JSON.stringify({ events })], { type: "application/json" });
    const ok = navigator.sendBeacon(TRACK_ENDPOINT, blob);
    if (!ok && events.length > 0 && buffer.length + events.length <= MAX_BUFFER_SIZE) {
      // Beacon refused — re-queue for the next opportunity.
      buffer = events.concat(buffer);
    }
  } catch {
    /* swallow — tracker must never throw */
  }
}

function installUnloadHooks(): void {
  if (unloadHooksInstalled) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  unloadHooksInstalled = true;
  try {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") {
          clearFlushTimer();
          flushViaBeacon();
        }
      },
      { capture: true },
    );
    window.addEventListener("pagehide", () => {
      clearFlushTimer();
      flushViaBeacon();
    });
    window.addEventListener("beforeunload", () => {
      clearFlushTimer();
      flushViaBeacon();
    });
  } catch {
    /* swallow — listeners are best-effort */
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Fire an analytics event.
 *
 * SILENT on failure : this function never throws. Safe to call from any
 * code path, including render-time effects.
 */
export function track(eventType: EventType, opts: TrackOpts = {}): void {
  if (typeof window === "undefined") return;
  try {
    installUnloadHooks();

    const event: QueuedEvent = {
      event_type: eventType,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      metadata: opts.metadata,
      client_kind: detectClientKind(),
      network_class: detectNetworkClass(),
      locale: detectLocale(),
      anonymous_user_id: getOrCreateAnonId(),
      session_id: getOrCreateSessionId(),
      client_ts: new Date().toISOString(),
    };

    if (buffer.length >= MAX_BUFFER_SIZE) {
      // Hard cap reached — drop the OLDEST event, not the newest. The
      // newest is likely the most relevant (latest user action).
      buffer.shift();
    }
    buffer.push(event);

    if (buffer.length >= BATCH_THRESHOLD) {
      clearFlushTimer();
      void flush();
    } else {
      scheduleFlush();
    }
  } catch {
    /* swallow EVERYTHING — tracker must be invisible to the host app */
  }
}

/**
 * Force-flush the buffer immediately. Useful after a navigation triggered
 * by user code (e.g. router.push) where you want the events to land before
 * the next page renders.
 */
export function flushNow(): Promise<void> {
  clearFlushTimer();
  return flush().catch(() => undefined);
}
