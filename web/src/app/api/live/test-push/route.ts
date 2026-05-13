import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/live/test-push — admin-only dev tool : enqueue a fake push
 * notification to every active subscriber.
 *
 * Auth model — `X-Admin-Key` header MUST match the server-side env
 * `LIVE_TEST_PUSH_KEY`. No fallback default : if the env is unset, the
 * route 503s. This is intentional — we never want this open in
 * production by accident.
 *
 * What this route actually does
 * ─────────────────────────────
 *
 * The browser-facing route does NOT call `pywebpush.send_push()` —
 * that requires the VAPID private key, which lives in the worker
 * environment and is not (and should not be) accessible to the Node
 * runtime on Vercel.
 *
 * Instead :
 *   1. Insert a row into `push_notifications` with kind='broadcast'
 *      and a "[TEST]" prefix so audit logs are clear.
 *   2. The Python worker's push_notifier picks it up on its next
 *      cycle and fans out the actual web-push HTTP/2 deliveries.
 *
 * Body (all optional) :
 *   {
 *     title?: string,         // default "[TEST] KCKILLS live"
 *     body?:  string,         // default "Test push - safe to ignore"
 *     url?:   string,         // default "/live"
 *   }
 *
 * For end-to-end testing without the worker running, set
 * LIVE_TEST_PUSH_FORCE_DIRECT=1 — the route will return a TODO with
 * the payload it WOULD have sent. (Direct delivery would require
 * the VAPID private key + web-push lib on Vercel ; we deliberately
 * route through the worker instead.)
 */
export async function POST(request: NextRequest) {
  const adminKey = process.env.LIVE_TEST_PUSH_KEY;
  if (!adminKey) {
    return NextResponse.json(
      {
        error:
          "LIVE_TEST_PUSH_KEY env var not set — admin push test endpoint disabled",
      },
      { status: 503 },
    );
  }

  const submitted = request.headers.get("X-Admin-Key");
  if (!submitted || submitted !== adminKey) {
    // Match the timing of a successful header read by always reading
    // the body before returning. Doesn't hurt and reduces tells.
    await request.json().catch(() => null);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const title = (body?.title as string | undefined) ?? "[TEST] KCKILLS live";
  const message = (body?.body as string | undefined) ?? "Test push — safe to ignore.";
  const url = (body?.url as string | undefined) ?? "/live";

  const sb = await createServerSupabase();

  // Count subscribers — useful diagnostic in the response payload so
  // the admin running the test knows whether anyone will actually
  // receive the message.
  const { count: subscriberCount } = await sb
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });

  const dedupeKey = `live-test-${Date.now()}`;

  // TODO: real send — for now we just enqueue. The worker's
  //       push_notifier (lib/push/send.ts:enqueuePush logic) picks
  //       this up on its next cycle and fans out via pywebpush. The
  //       test endpoint is therefore "fire and forget" : a 200 here
  //       means "the row was inserted", not "every subscriber got
  //       the toast". Check the worker logs to confirm delivery.
  const { data: inserted, error } = await sb
    .from("push_notifications")
    .insert({
      kind: "broadcast",
      title,
      body: message,
      url,
      dedupe_key: dedupeKey,
      sent_by: "admin-test",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        hint:
          "Most likely the push_notifications table doesn't exist yet — ensure migration 021_push_history.sql ran.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    notificationId: inserted?.id ?? null,
    subscribers: subscriberCount ?? 0,
    enqueued: { title, body: message, url, dedupeKey },
    note:
      "Push row enqueued. Worker push_notifier delivers on its next cycle. " +
      "For zero-worker dev, run `python worker/live_pusher.py --once` after this call.",
  });
}
