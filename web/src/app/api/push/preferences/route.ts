/**
 * /api/push/preferences — manage per-device push notification opt-out.
 *
 *   GET  → returns this device's current preferences (looked up by
 *          endpoint URL passed in body). 404 if the subscription
 *          doesn't exist (the device hasn't subscribed yet).
 *
 *   PUT  → updates the preferences for the subscription matching the
 *          endpoint URL. Body :
 *              { endpoint, preferences: { all, kill, kill_of_the_week, ... } }
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
  const { data } = await sb
    .from("push_subscriptions")
    .select("id,preferences,subscription_json")
    .ilike("subscription_json", `%${safe}%`)
    .limit(1)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
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
  });
}

export async function PUT(request: NextRequest) {
  let body: { endpoint?: string; preferences?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = body.endpoint;
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const preferences = sanitisePreferences(body.preferences);
  const sb = await createServerSupabase();
  const row = await findByEndpoint(sb, endpoint);
  if (!row) {
    return NextResponse.json({ error: "Not subscribed" }, { status: 404 });
  }

  const { error } = await sb
    .from("push_subscriptions")
    .update({ preferences })
    .eq("id", row.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, preferences });
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
