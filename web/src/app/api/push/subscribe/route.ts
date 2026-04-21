import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/push/subscribe — store a PushSubscription for later notifications.
 * Body: PushSubscription.toJSON() shape
 *   { endpoint, keys: { p256dh, auth } }
 *
 * No auth required — anonymous subscriptions accepted. We dedupe by endpoint.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.endpoint) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();

  // Upsert by endpoint
  const { error } = await sb.from("push_subscriptions").upsert({
    user_id: user?.id ?? null,
    subscription_json: JSON.stringify(body),
  }, { onConflict: "subscription_json" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
