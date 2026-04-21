import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/push/subscribe — store a PushSubscription for later notifications.
 * Body: PushSubscription.toJSON() shape
 *   { endpoint, keys: { p256dh, auth } }
 *
 * No auth required — anonymous subscriptions accepted. Dedupe is done
 * in app logic: we look for an existing row with the same endpoint
 * inside subscription_json before inserting. Migration 001 doesn't yet
 * have a unique index on the endpoint, so an `onConflict` upsert would
 * crash. The dedupe SELECT keeps duplicates out without that index —
 * worst-case race condition produces ONE extra row, which the
 * notification batch will dedupe at send time.
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

  // Dedupe by endpoint substring match — JSONB `subscription_json` is
  // TEXT in the schema, so we use ilike on the raw string. The endpoint
  // is unique per browser/device so this is reliable enough.
  const { data: existing } = await sb
    .from("push_subscriptions")
    .select("id")
    .ilike("subscription_json", `%${endpoint.replace(/[%_]/g, "")}%`)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json({ ok: true, deduped: true });
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
