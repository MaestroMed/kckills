import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/live/subscribe — register a PushSubscription for live-match
 * notifications.
 *
 * Body : the result of PushSubscription.toJSON() :
 *     { endpoint, keys: { p256dh, auth }, expirationTime? }
 *
 * This endpoint mirrors /api/push/subscribe (the legacy global push
 * subscribe route) but is namespaced under /api/live so the LiveHotNow
 * banner has a clear opt-in surface that telemetry can attribute to
 * the live flow (vs the generic notification toggle in /settings).
 *
 * Storage strategy
 * ────────────────
 * Both routes write to the SAME push_subscriptions table — the only
 * thing that differs is the entry point. Dedupe is by endpoint URL
 * via migration 030's generated `endpoint` column with a UNIQUE partial
 * index. We use the same SELECT-then-UPDATE-or-INSERT pattern as the
 * legacy route :
 *
 *   1. Look up the row by endpoint
 *   2. UPDATE if present (refresh p256dh + auth in case they rotated)
 *   3. INSERT otherwise
 *
 * Hot path : 1 round-trip when subscription is new, 2 when it's a
 * refresh. Fits well inside the Vercel edge function budget.
 *
 * No auth required — the PushSubscription endpoint URL is itself a
 * hard-to-guess secret (it carries the device's FCM/APNs token), so
 * possessing it is enough to bind the subscription to that device.
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

  // Fast path : dedupe by the generated `endpoint` column.
  let existingId: string | null = null;
  const fast = await sb
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .limit(1)
    .maybeSingle();
  if (fast.error) {
    // Migration 030 not yet applied — degrade to substring match.
    const safe = endpoint.replace(/[%_]/g, "");
    const slow = await sb
      .from("push_subscriptions")
      .select("id")
      .ilike("subscription_json", `%${safe}%`)
      .limit(1)
      .maybeSingle();
    existingId = slow.data?.id ?? null;
  } else {
    existingId = fast.data?.id ?? null;
  }

  if (existingId) {
    const { error: updateError } = await sb
      .from("push_subscriptions")
      .update({
        subscription_json: subscriptionJson,
        user_id: user?.id ?? null,
      })
      .eq("id", existingId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, refreshed: true });
  }

  // First-time subscribe — preferences default to the per-device
  // opt-in shape (migration 022) : `{"all": true}`. Worker-side
  // push_notifier respects this map.
  const { error } = await sb.from("push_subscriptions").insert({
    user_id: user?.id ?? null,
    subscription_json: subscriptionJson,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: true });
}

/**
 * DELETE /api/live/subscribe — remove a PushSubscription by endpoint URL.
 *
 * Body : { endpoint }
 *
 * Same model as /api/push/subscribe DELETE. The dual surface lets
 * clients that subscribed via the live flow also unsubscribe via the
 * same path without round-tripping through the global push routes.
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const sb = await createServerSupabase();

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
