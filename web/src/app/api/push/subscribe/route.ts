import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/push/subscribe — store a PushSubscription for later notifications.
 *
 * Body : PushSubscription.toJSON() shape
 *     { endpoint, keys: { p256dh, auth } }
 *
 * Dedupe strategy
 * ───────────────
 * Migration 030 added a generated `endpoint` column on push_subscriptions
 * with a UNIQUE partial index (idx_push_subscriptions_endpoint). We
 * leverage that : look up the row by endpoint, UPDATE if it exists
 * (refreshes subscription_json — important because keys.p256dh / keys.auth
 * can rotate when the browser refreshes the subscription, and a stale
 * payload would make every push delivery fail with 410), INSERT
 * otherwise.
 *
 * Why not a single `upsert(..., { onConflict: 'endpoint' })` — Supabase
 * client requires the conflict target to be a real column, and the
 * generated column was unknown to PostgREST at the time PR21 landed. The
 * SELECT-then-INSERT/UPDATE pattern is the safe portable workaround and
 * costs at most 2 round-trips on the cold path (1 on the hot path).
 *
 * No auth required — anonymous subscriptions accepted. The endpoint URL
 * itself is a hard-to-guess secret, so possessing it is enough to bind
 * a subscription to a device.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  const subscriptionJson = JSON.stringify(body);

  // Try the fast path first — match on the generated `endpoint` column
  // (added by migration 030). Falls back to ILIKE on the raw JSON if
  // the column lookup fails (e.g. migration not yet applied in dev).
  let existingId: string | null = null;
  const fast = await sb
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .limit(1)
    .maybeSingle();
  if (fast.error) {
    // Generated column missing or unreachable — degrade to substring match.
    const slow = await sb
      .from("push_subscriptions")
      .select("id")
      .ilike("subscription_json", `%${endpoint.replace(/[%_]/g, "")}%`)
      .limit(1)
      .maybeSingle();
    existingId = slow.data?.id ?? null;
  } else {
    existingId = fast.data?.id ?? null;
  }

  if (existingId) {
    // Refresh the stored payload — keys can rotate between renewals and
    // a stale auth/p256dh would silently break every future delivery.
    const { error: updateError } = await sb
      .from("push_subscriptions")
      .update({ subscription_json: subscriptionJson, user_id: user?.id ?? null })
      .eq("id", existingId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deduped: true, refreshed: true });
  }

  const { error } = await sb.from("push_subscriptions").insert({
    user_id: user?.id ?? null,
    subscription_json: subscriptionJson,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/push/subscribe — remove a PushSubscription.
 *
 * Body : { endpoint } — the endpoint URL of the subscription to drop.
 *
 * /api/push/preferences DELETE does the same thing today (PR21), but
 * exposing it here too matches the REST mental model (POST/DELETE on
 * the same URL) and lets clients use a single endpoint for the
 * subscribe-then-unsubscribe round-trip.
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const sb = await createServerSupabase();

  // Same fast/slow split as POST — the generated `endpoint` column is
  // the canonical lookup, fall back to ILIKE if it's unavailable.
  const fast = await sb
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .select("id");

  if (fast.error) {
    const safe = endpoint.replace(/[%_]/g, "");
    const slow = await sb
      .from("push_subscriptions")
      .delete()
      .ilike("subscription_json", `%${safe}%`)
      .select("id");
    if (slow.error) {
      return NextResponse.json({ error: slow.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: (slow.data?.length ?? 0) > 0 });
  }

  return NextResponse.json({ ok: true, deleted: (fast.data?.length ?? 0) > 0 });
}
