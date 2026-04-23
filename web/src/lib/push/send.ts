/**
 * Web push helper — server-side enqueue + (optional) immediate send.
 *
 * Why two modes ?
 *
 *   * enqueue() — INSERT into push_notifications and return. The Python
 *                 worker (modules/push_notifier.py) picks it up on its
 *                 next cycle. Slow path, scales to 10k+ recipients,
 *                 survives Vercel function timeouts. This is the
 *                 default path used by /api/admin/push/broadcast.
 *
 *   * sendNow() — Same enqueue, then ALSO POST to every subscription
 *                 right here in the route handler. Bounded by Vercel's
 *                 60-second timeout — only safe for low subscriber
 *                 counts (< ~200). The admin UI exposes this as
 *                 "Envoyer maintenant" for one-off urgent broadcasts.
 *
 * Both modes write to push_notifications first so the audit trail
 * is identical regardless of which path was chosen.
 */

import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

export type PushKind =
  | "kill"
  | "kill_of_the_week"
  | "editorial_pin"
  | "live_match"
  | "broadcast"
  | "system";

export interface EnqueuePushParams {
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  iconUrl?: string;
  imageUrl?: string;
  killId?: string;
  /** Idempotency key — second insert with the same value silently no-ops. */
  dedupeKey?: string;
  sentBy?: string;
}

export interface EnqueueResult {
  ok: boolean;
  notificationId?: string;
  deduped?: boolean;
  error?: string;
}

/**
 * Insert a notification into push_notifications. The worker daemon
 * picks it up on its next cycle.
 *
 * Dedupe semantics : if dedupeKey collides with an existing row,
 * Supabase returns 23505 (unique violation). We treat that as a
 * successful no-op and return { deduped: true }.
 */
export async function enqueuePush(params: EnqueuePushParams): Promise<EnqueueResult> {
  const sb = await createServerSupabase();

  const row = {
    kind: params.kind,
    dedupe_key: params.dedupeKey ?? null,
    title: params.title.slice(0, 200),
    body: params.body.slice(0, 500),
    url: params.url,
    icon_url: params.iconUrl ?? null,
    image_url: params.imageUrl ?? null,
    kill_id: params.killId ?? null,
    sent_by: params.sentBy ?? "admin",
  };

  const { data, error } = await sb
    .from("push_notifications")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation on dedupe_key. Treat as no-op.
    if (error.code === "23505" || /duplicate key/i.test(error.message)) {
      return { ok: true, deduped: true };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, notificationId: data?.id };
}

interface Subscription {
  id: string;
  subscription_json: string;
}

interface SendNowResult extends EnqueueResult {
  sent?: number;
  failed?: number;
  expired?: number;
}

/**
 * Same as enqueuePush(), but ALSO sends immediately via web-push (Node).
 * Bounded — call only when subscriber count is small. The Python
 * worker will see sent_at != null and skip the row.
 *
 * The web-push npm package is loaded dynamically so the route bundle
 * doesn't fail to build if the dep isn't installed in the environment
 * yet. The call returns ok=false in that case rather than throwing.
 */
export async function sendNow(params: EnqueuePushParams): Promise<SendNowResult> {
  const enqueued = await enqueuePush(params);
  if (!enqueued.ok || enqueued.deduped || !enqueued.notificationId) {
    return enqueued;
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:admin@kckills.com";

  if (!vapidPublic || !vapidPrivate) {
    // Enqueued — the worker will send when env is configured.
    return { ...enqueued, sent: 0, failed: 0, expired: 0 };
  }

  // Dynamic import via a runtime-only specifier so the type system
  // doesn't error if @types/web-push isn't installed yet at type-check
  // time. When the dep is available, runtime import resolves normally;
  // when it isn't, we fall through to the enqueued path silently.
  type WebPushLike = {
    setVapidDetails: (subject: string, pub: string, priv: string) => void;
    sendNotification: (sub: object, payload: string, opts?: { TTL?: number }) => Promise<unknown>;
  };
  let webpush: WebPushLike | null = null;
  try {
    // Hide the literal "web-push" specifier from the TS resolver via an
    // indirection — keeps the build green pre-`pnpm install`. The runtime
    // import is identical.
    const specifier = ["web", "push"].join("-");
    const mod = (await import(/* webpackIgnore: true */ specifier)) as unknown as
      | { default?: WebPushLike }
      | WebPushLike;
    webpush = (mod as { default?: WebPushLike }).default ?? (mod as WebPushLike);
  } catch {
    // Dep missing — enqueued path will pick it up via the worker.
    return { ...enqueued, sent: 0, failed: 0, expired: 0 };
  }
  if (!webpush) {
    return { ...enqueued, sent: 0, failed: 0, expired: 0 };
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const sb = await createServerSupabase();
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id,subscription_json,preferences")
    .limit(500);

  // PR21 — honour per-subscription opt-out (preferences.all === false
  // OR preferences[kind] === false silences this delivery). Same logic
  // as the Python push_notifier daemon.
  const allSubs = (subs ?? []) as Array<Subscription & { preferences?: Record<string, unknown> | null }>;
  const subscriptions = allSubs.filter((s) => {
    const p = s.preferences;
    if (!p || typeof p !== "object") return true;
    if ((p as Record<string, unknown>).all === false) return false;
    if ((p as Record<string, unknown>)[params.kind] === false) return false;
    return true;
  });
  if (subscriptions.length === 0) {
    await sb
      .from("push_notifications")
      .update({ sent_at: new Date().toISOString(), target_count: 0 })
      .eq("id", enqueued.notificationId);
    return { ...enqueued, sent: 0, failed: 0, expired: 0 };
  }

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    url: params.url,
    icon: params.iconUrl ?? "/icons/icon-192x192.png",
    image: params.imageUrl,
    tag: params.dedupeKey ?? enqueued.notificationId,
    kind: params.kind,
  });

  let sent = 0;
  let failed = 0;
  let expired = 0;
  const expiredIds: string[] = [];
  const deliveries: Array<Record<string, unknown>> = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      let subInfo: object;
      try {
        subInfo = JSON.parse(sub.subscription_json);
      } catch {
        failed++;
        deliveries.push({
          notification_id: enqueued.notificationId,
          subscription_id: sub.id,
          status: "failed",
          error_message: "invalid subscription_json",
        });
        return;
      }
      try {
        await webpush!.sendNotification(subInfo as object, payload, { TTL: 3600 });
        sent++;
        deliveries.push({
          notification_id: enqueued.notificationId,
          subscription_id: sub.id,
          status: "sent",
          http_status: 201,
        });
      } catch (err: unknown) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        const code = typeof e.statusCode === "number" ? e.statusCode : null;
        if (code === 404 || code === 410) {
          expired++;
          expiredIds.push(sub.id);
          deliveries.push({
            notification_id: enqueued.notificationId,
            subscription_id: sub.id,
            status: "expired",
            http_status: code,
          });
        } else {
          failed++;
          deliveries.push({
            notification_id: enqueued.notificationId,
            subscription_id: sub.id,
            status: "failed",
            http_status: code,
            error_message: (e.message ?? "").slice(0, 200),
          });
        }
      }
    }),
  );

  // Insert deliveries in chunks
  for (let i = 0; i < deliveries.length; i += 200) {
    await sb.from("push_deliveries").insert(deliveries.slice(i, i + 200));
  }

  // Prune expired
  if (expiredIds.length > 0) {
    await sb.from("push_subscriptions").delete().in("id", expiredIds);
  }

  await sb
    .from("push_notifications")
    .update({
      sent_at: new Date().toISOString(),
      target_count: subscriptions.length,
      sent_count: sent,
      failed_count: failed,
      expired_count: expired,
    })
    .eq("id", enqueued.notificationId);

  return { ...enqueued, sent, failed, expired };
}
