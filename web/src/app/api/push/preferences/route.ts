/**
 * /api/push/preferences — manage per-device push notification opt-out
 *                         AND quiet-hours window.
 *
 *   GET  → returns this device's current preferences + quiet hours
 *          (looked up by endpoint URL passed in body). 404 if the
 *          subscription doesn't exist (the device hasn't subscribed yet).
 *
 *   PUT  → updates the preferences for the subscription matching the
 *          endpoint URL. Body (all keys optional except `endpoint`) :
 *              {
 *                endpoint,
 *                preferences: { all, kill, kill_of_the_week, ... },
 *                quiet_hours_start_utc: 0..23,   // null = clear
 *                quiet_hours_end_utc:   0..23,   // null = clear
 *              }
 *          Wave 9 (PR-arch P2) added the quiet-hours fields ;
 *          the `preferences` map and the quiet-hours fields are
 *          updated independently when present.
 *
 *   DELETE → removes the subscription entirely. Body : { endpoint }
 *
 * No auth required — the endpoint URL is itself a hard-to-guess secret
 * (it carries the device's push service token), so possessing it is
 * enough to authorise changes for that device. Same model as the
 * existing /api/push/subscribe endpoint.
 *
 * Why endpoint-as-key rather than subscription_id ?
 *   The browser only knows its endpoint URL (PushSubscription.endpoint).
 *   Asking the user to round-trip a Supabase row id would force us to
 *   store it in localStorage and complicate the unsubscribe flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

interface SubscriptionRow {
  id: string;
  preferences: Record<string, boolean> | null;
  subscription_json: string;
  quiet_hours_start_utc?: number | null;
  quiet_hours_end_utc?: number | null;
}

/** Default quiet-hours window when migration 042 isn't applied yet. */
const DEFAULT_QUIET_START_UTC = 23;
const DEFAULT_QUIET_END_UTC = 7;

/** Validate a 0-23 hour value. Accepts null/undefined to mean "clear". */
function sanitiseHour(input: unknown): number | null | undefined {
  if (input === null) return null;
  if (input === undefined) return undefined;
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  if (i < 0 || i > 23) return undefined;
  return i;
}

const VALID_KINDS = new Set([
  "all",
  "kill",
  "kill_of_the_week",
  "editorial_pin",
  "live_match",
  "broadcast",
  "system",
]);

function sanitisePreferences(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== "object") return { all: true };
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (VALID_KINDS.has(k) && typeof v === "boolean") out[k] = v;
  }
  // Always carry "all" — the worker reads it as the master switch.
  if (typeof out.all !== "boolean") out.all = true;
  return out;
}

async function findByEndpoint(
  sb: Awaited<ReturnType<typeof createServerSupabase>>,
  endpoint: string,
): Promise<SubscriptionRow | null> {
  // subscription_json is TEXT in the schema (stored as JSON-stringified).
  // Use a substring match on the endpoint URL — endpoints are unique
  // per device so collision risk is essentially zero.
  const safe = endpoint.replace(/[%_]/g, "");
  // Wave 9 — also pull quiet-hours columns. If migration 042 isn't
  // applied yet PostgREST 400s on the unknown column ; fall back to
  // the legacy projection.
  let row: SubscriptionRow | null = null;
  try {
    const { data, error } = await sb
      .from("push_subscriptions")
      .select(
        "id,preferences,subscription_json,quiet_hours_start_utc,quiet_hours_end_utc",
      )
      .ilike("subscription_json", `%${safe}%`)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    row = (data as SubscriptionRow | null) ?? null;
  } catch {
    const { data } = await sb
      .from("push_subscriptions")
      .select("id,preferences,subscription_json")
      .ilike("subscription_json", `%${safe}%`)
      .limit(1)
      .maybeSingle();
    row = (data as SubscriptionRow | null) ?? null;
  }
  return row;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const row = await findByEndpoint(sb, endpoint);
  if (!row) {
    return NextResponse.json({ error: "Not subscribed" }, { status: 404 });
  }
  return NextResponse.json({
    preferences: row.preferences ?? { all: true },
    // Wave 9 — surface quiet hours so the settings UI can pre-fill the
    // pickers. `null` from the DB means "use defaults" ; we always
    // serialize a numeric value to keep the React form simple.
    quiet_hours_start_utc:
      row.quiet_hours_start_utc ?? DEFAULT_QUIET_START_UTC,
    quiet_hours_end_utc:
      row.quiet_hours_end_utc ?? DEFAULT_QUIET_END_UTC,
  });
}

export async function PUT(request: NextRequest) {
  let body: {
    endpoint?: string;
    preferences?: unknown;
    quiet_hours_start_utc?: unknown;
    quiet_hours_end_utc?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = body.endpoint;
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const row = await findByEndpoint(sb, endpoint);
  if (!row) {
    return NextResponse.json({ error: "Not subscribed" }, { status: 404 });
  }

  // Build the patch payload only with fields the caller actually sent.
  // Letting clients update preferences and quiet-hours independently
  // keeps the QuietHoursCard component decoupled from NotificationSettings.
  const patch: Record<string, unknown> = {};
  let preferences: Record<string, boolean> | undefined;
  if ("preferences" in body && body.preferences !== undefined) {
    preferences = sanitisePreferences(body.preferences);
    patch.preferences = preferences;
  }
  const start = sanitiseHour(body.quiet_hours_start_utc);
  const end = sanitiseHour(body.quiet_hours_end_utc);
  if (start !== undefined) patch.quiet_hours_start_utc = start;
  if (end !== undefined) patch.quiet_hours_end_utc = end;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  // Try the full patch first. If migration 042 hasn't been applied
  // yet, PostgREST 400s on the unknown column — strip the quiet
  // hours and retry so we never reject a preferences-only update.
  let error = (
    await sb.from("push_subscriptions").update(patch).eq("id", row.id)
  ).error;
  if (
    error &&
    /quiet_hours/.test(error.message) &&
    ("preferences" in patch)
  ) {
    const fallback = { preferences: patch.preferences };
    error = (
      await sb
        .from("push_subscriptions")
        .update(fallback)
        .eq("id", row.id)
    ).error;
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    preferences: preferences ?? row.preferences ?? { all: true },
    quiet_hours_start_utc:
      "quiet_hours_start_utc" in patch
        ? patch.quiet_hours_start_utc
        : (row.quiet_hours_start_utc ?? DEFAULT_QUIET_START_UTC),
    quiet_hours_end_utc:
      "quiet_hours_end_utc" in patch
        ? patch.quiet_hours_end_utc
        : (row.quiet_hours_end_utc ?? DEFAULT_QUIET_END_UTC),
  });
}

export async function DELETE(request: NextRequest) {
  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = body.endpoint;
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const row = await findByEndpoint(sb, endpoint);
  if (!row) {
    return NextResponse.json({ ok: true, deleted: false });
  }

  const { error } = await sb.from("push_subscriptions").delete().eq("id", row.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: true });
}
