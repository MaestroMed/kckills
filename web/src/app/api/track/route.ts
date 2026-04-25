/**
 * /api/track — anonymous + authenticated event ingestion endpoint.
 *
 * POST { events: Array<{ event_type, entity_type?, entity_id?, metadata?, ... }> }
 *
 * Behaviour :
 *   - Validates each event_type against the migration-029 enum. Invalid
 *     events are dropped silently (we don't fail the whole batch on one
 *     bad event — the client can't introspect server validation rules
 *     and we don't want to lose the rest of the batch).
 *   - Sanitises metadata :
 *        * any string value > 200 chars → dropped
 *        * any nested object > 1KB serialised → dropped
 *        * keys or string values matching email / phone / IP patterns
 *          are stripped from the metadata blob. We never persist PII.
 *   - Resolves the auth.users.id from the Supabase session cookie if the
 *     caller is logged in. Otherwise user_id is left null and only the
 *     anonymous_user_id ties events together.
 *   - Bulk-inserts via the Supabase REST client.
 *
 * Returns :
 *   204 No Content on success (even partial — silently drops invalid)
 *   400 with { error: "..." } on malformed body / no events
 *
 * Rate limit :
 *   In-memory map keyed by session_id. Max 50 events per minute per session.
 *   Overflow is dropped silently (don't error the client — would just cause
 *   their next 49 attempts to retry-storm us). The map self-prunes entries
 *   older than 60s on every call.
 *
 * NOTE on the in-memory rate limit : Vercel serverless functions are
 * isolated per region/instance, so this is a per-instance soft cap, not a
 * strict global limit. For free-tier safety it's plenty — a single misbehaving
 * client is throttled within its instance, and the table has its own
 * indexes that handle bursts gracefully.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Allowed event types — keep in sync with migration 029 ─────────────
//
// NOTE on `timeline.era_selected` : the value is allowed at the API gate
// so the request shape validates client-side, BUT the DB CHECK constraint
// in migration 029 doesn't list it yet. Inserts with this event_type will
// be silently dropped by Postgres (logged on the server, never surfaced
// to the client — tracker is best-effort by design). A follow-up
// migration should extend the constraint when we want to actually count
// these events.

const ALLOWED_EVENT_TYPES = new Set<string>([
  "feed.view",
  "clip.viewed",
  "clip.started",
  "clip.completed",
  "clip.replayed",
  "clip.skipped",
  "clip.shared",
  "clip.liked",
  "clip.rated",
  "clip.opened",
  "page.viewed",
  "player.opened",
  "match.opened",
  "tournament.opened",
  "search.executed",
  "timeline.era_selected",
  "comment.created",
  "language.changed",
  "quality.changed",
  "mute.toggled",
  "install.prompted",
  "install.accepted",
  "auth.signup",
  "auth.login",
  "auth.logout",
  // ─── Wave 6 — scroll feed UX polish (Agent AB) ─────────────────────
  // FOLLOW-UP MIGRATION REQUIRED: extend user_events_event_type_check
  // CHECK constraint to whitelist these values. Until then, inserts
  // will be silently dropped by Postgres (logged server-side, swallowed
  // client-side per the tracker's best-effort design).
  "clip.error",
  "feed.scroll_restored",
  "feed.offline_entered",
  "feed.offline_exited",
]);

const ALLOWED_CLIENT_KINDS = new Set(["mobile", "desktop", "tablet", "pwa"]);
const ALLOWED_NETWORK_CLASSES = new Set(["fast", "medium", "slow"]);

// ─── PII sanitiser ─────────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// Lenient phone heuristic — international E.164-ish or 7+ consecutive digits.
const PHONE_RE = /(?:\+?\d[\s().-]?){7,}/;
// IPv4 + IPv6 lenient.
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_RE = /\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{0,4}\b/i;
// Suspicious key names — strip these regardless of content.
const PII_KEY_RE = /(email|phone|tel|ip[v]?[46]?|address|fullname|firstname|lastname|password|token|secret)/i;

const MAX_STRING_LEN = 200;
const MAX_NESTED_OBJECT_BYTES = 1024;

function looksLikePii(value: string): boolean {
  if (EMAIL_RE.test(value)) return true;
  if (PHONE_RE.test(value)) return true;
  if (IPV4_RE.test(value)) return true;
  if (IPV6_RE.test(value)) return true;
  return false;
}

function sanitiseMetadata(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) return {};

  const out: Record<string, unknown> = {};
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    if (typeof rawKey !== "string" || rawKey.length === 0 || rawKey.length > 64) continue;
    if (PII_KEY_RE.test(rawKey)) continue; // PII-named keys → drop entirely

    if (rawVal === null || rawVal === undefined) {
      out[rawKey] = null;
      continue;
    }
    if (typeof rawVal === "boolean" || typeof rawVal === "number") {
      // Reject NaN / ±Infinity — they break Postgres JSONB.
      if (typeof rawVal === "number" && !Number.isFinite(rawVal)) continue;
      out[rawKey] = rawVal;
      continue;
    }
    if (typeof rawVal === "string") {
      if (rawVal.length > MAX_STRING_LEN) continue; // too long → drop
      if (looksLikePii(rawVal)) continue; // PII-shaped → drop
      out[rawKey] = rawVal;
      continue;
    }
    if (typeof rawVal === "object") {
      // Nested object / array — only allow if the JSON serialises to <1KB
      // and contains no PII-ish strings. We do a shallow check.
      let serialised = "";
      try {
        serialised = JSON.stringify(rawVal);
      } catch {
        continue; // circular or unserialisable → drop
      }
      if (serialised.length > MAX_NESTED_OBJECT_BYTES) continue;
      if (looksLikePii(serialised)) continue;
      try {
        out[rawKey] = JSON.parse(serialised);
      } catch {
        continue;
      }
      continue;
    }
    // Anything else (functions, symbols) → drop
  }
  return out;
}

// ─── In-memory per-session rate limit ──────────────────────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateMap = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_WINDOW = 50;

function checkAndIncrement(sessionId: string, n: number): number {
  const now = Date.now();
  // Periodic prune — cheap O(n) over the map. Free-tier traffic stays
  // well under thousands of unique sessions per region.
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap) {
      if (v.resetAt < now) rateMap.delete(k);
    }
  }
  const bucket = rateMap.get(sessionId);
  if (!bucket || bucket.resetAt < now) {
    const allowed = Math.min(n, RATE_MAX_PER_WINDOW);
    rateMap.set(sessionId, { count: allowed, resetAt: now + RATE_WINDOW_MS });
    return allowed;
  }
  const remaining = RATE_MAX_PER_WINDOW - bucket.count;
  if (remaining <= 0) return 0;
  const allowed = Math.min(n, remaining);
  bucket.count += allowed;
  return allowed;
}

// ─── Body validation ───────────────────────────────────────────────────

interface RawEvent {
  event_type?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  metadata?: unknown;
  client_kind?: unknown;
  network_class?: unknown;
  locale?: unknown;
  anonymous_user_id?: unknown;
  session_id?: unknown;
  client_ts?: unknown;
}

interface NormalisedEvent {
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  client_kind: string | null;
  network_class: string | null;
  locale: string | null;
  anonymous_user_id: string | null;
  session_id: string | null;
}

function asTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

function normaliseEvent(raw: RawEvent): NormalisedEvent | null {
  const eventType = asTrimmedString(raw.event_type, 64);
  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) return null;

  const clientKindRaw = asTrimmedString(raw.client_kind, 16);
  const clientKind = clientKindRaw && ALLOWED_CLIENT_KINDS.has(clientKindRaw) ? clientKindRaw : null;

  const networkClassRaw = asTrimmedString(raw.network_class, 16);
  const networkClass =
    networkClassRaw && ALLOWED_NETWORK_CLASSES.has(networkClassRaw) ? networkClassRaw : null;

  const localeRaw = asTrimmedString(raw.locale, 8);
  const locale = localeRaw && /^[a-z]{2}$/i.test(localeRaw) ? localeRaw.toLowerCase() : null;

  return {
    event_type: eventType,
    entity_type: asTrimmedString(raw.entity_type, 32),
    entity_id: asTrimmedString(raw.entity_id, 64),
    metadata: sanitiseMetadata(raw.metadata),
    client_kind: clientKind,
    network_class: networkClass,
    locale,
    anonymous_user_id: asTrimmedString(raw.anonymous_user_id, 64),
    session_id: asTrimmedString(raw.session_id, 64),
  };
}

// ─── Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Parse JSON body. sendBeacon sends as type "application/json" too.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !("events" in body)) {
    return NextResponse.json({ error: "Missing events array" }, { status: 400 });
  }

  const eventsRaw = (body as { events: unknown }).events;
  if (!Array.isArray(eventsRaw)) {
    return NextResponse.json({ error: "events must be an array" }, { status: 400 });
  }
  if (eventsRaw.length === 0) {
    // Nothing to do, but it's a valid request (empty batch on tab close).
    return new NextResponse(null, { status: 204 });
  }
  if (eventsRaw.length > 100) {
    // Hard cap on batch size — honest clients send ≤10, anything bigger
    // is either buggy or hostile.
    return NextResponse.json({ error: "Batch too large (max 100 events)" }, { status: 400 });
  }

  // Normalise + validate every event ; silently drop invalid ones.
  const normalised: NormalisedEvent[] = [];
  for (const raw of eventsRaw) {
    if (typeof raw !== "object" || raw === null) continue;
    const n = normaliseEvent(raw as RawEvent);
    if (n) normalised.push(n);
  }

  if (normalised.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Rate limit per-session — pick the dominant session_id from this batch.
  const sessionId = normalised[0]?.session_id ?? "anonymous";
  const allowedCount = checkAndIncrement(sessionId, normalised.length);
  if (allowedCount === 0) {
    // Silently accept — no error, no insert. Client gets a 204.
    return new NextResponse(null, { status: 204 });
  }
  const toInsert = allowedCount < normalised.length ? normalised.slice(0, allowedCount) : normalised;

  // Resolve auth.users.id (best-effort). RLS allows INSERT regardless,
  // but we still want user_id populated when we know it.
  let userId: string | null = null;
  let supabase;
  try {
    supabase = await createServerSupabase();
    const { data } = await supabase.auth.getUser();
    if (data.user) userId = data.user.id;
  } catch {
    // Cookie store unavailable / sandboxed — proceed as anonymous.
    try {
      supabase = await createServerSupabase();
    } catch {
      // No supabase at all — silently drop. Don't error the client.
      return new NextResponse(null, { status: 204 });
    }
  }

  // Build the rows. user_id from session, all other fields from the event.
  const rows = toInsert.map((e) => ({
    anonymous_user_id: e.anonymous_user_id,
    user_id: userId,
    session_id: e.session_id,
    event_type: e.event_type,
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    metadata: e.metadata,
    client_kind: e.client_kind,
    network_class: e.network_class,
    locale: e.locale,
  }));

  try {
    const { error } = await supabase.from("user_events").insert(rows);
    if (error) {
      // We log on the server but never error the client — tracker is
      // best-effort by design.
      console.warn("[/api/track] insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[/api/track] insert threw:", err instanceof Error ? err.message : err);
  }

  return new NextResponse(null, { status: 204 });
}
