/**
 * Client-side Web Push helpers.
 *
 * Browser-only — every export here is a no-op on the server. The
 * matching SW push handler lives in /public/sw.js, and the server
 * subscribe endpoint at /api/live/subscribe (live-specific) +
 * /api/push/subscribe (legacy, still wired for backward compat).
 *
 * Flow :
 *   1. callerMounts → isPushSupported() guard
 *   2. await getPushPermissionState()              ('default' / 'granted' / 'denied')
 *   3. await requestPushSubscription(vapidKey)     prompts the user, registers SW,
 *                                                   POSTs the subscription
 *   4. await unsubscribePush()                     opt-out path
 *
 * VAPID public key comes from NEXT_PUBLIC_VAPID_PUBLIC_KEY. If absent,
 * subscribe() returns { ok: false, reason: 'missing-vapid' } without
 * touching navigator.* — important in dev where keys aren't generated yet.
 *
 * TODO: generate via `npx web-push generate-vapid-keys` and set
 *       NEXT_PUBLIC_VAPID_PUBLIC_KEY (browser) + VAPID_PRIVATE_KEY (server)
 *       env vars on Vercel before this ships to production. Keep
 *       VAPID_PRIVATE_KEY in the server-only secrets — leaking it lets
 *       anyone send pushes to subscribed devices.
 */

export type PushPermissionState = "default" | "granted" | "denied" | "unsupported";

export interface SubscribeResult {
  ok: boolean;
  /** Reason code when ok === false. Stable strings so callers can branch. */
  reason?:
    | "missing-vapid"
    | "unsupported"
    | "permission-denied"
    | "subscribe-failed"
    | "post-failed";
  /** When ok === true, the toJSON of the active subscription. */
  subscription?: PushSubscriptionJSON;
  /** Surface raw error message for telemetry/logging. */
  message?: string;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** True when the running browser exposes the full Web Push surface. */
export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Current permission state, normalised to include 'unsupported'. */
export function getPushPermissionState(): PushPermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!isPushSupported()) return "unsupported";
  return Notification.permission as PushPermissionState;
}

/**
 * Returns the existing PushSubscription for this device if one is
 * already registered, otherwise null. Useful for the UI toggle to show
 * the "currently on" state without re-prompting.
 */
export async function getActivePushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Request browser permission (if needed), subscribe to the push manager,
 * and POST the subscription to the server.
 *
 * Idempotent — calling twice when the subscription already exists is
 * a no-op past the SW registration (it returns the same object).
 *
 * `subscribeEndpoint` defaults to /api/live/subscribe (the live-banner
 * flow) ; callers in /settings can pass /api/push/subscribe instead to
 * route through the legacy push surface. Both endpoints write to the
 * SAME push_subscriptions table — the split is only there for naming
 * clarity per feature.
 */
export async function subscribeToPush(
  subscribeEndpoint: string = "/api/live/subscribe",
): Promise<SubscribeResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, reason: "missing-vapid" };
  }

  // Prompt the user. If they previously chose 'denied', browsers no
  // longer re-prompt — surface that as a distinct outcome so callers
  // can tell the user to flip the toggle in the browser settings.
  let permission: NotificationPermission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch (err) {
      return {
        ok: false,
        reason: "permission-denied",
        message: (err as Error)?.message,
      };
    }
  }
  if (permission !== "granted") {
    return { ok: false, reason: "permission-denied" };
  }

  let subscription: PushSubscription;
  try {
    const reg = await navigator.serviceWorker.ready;
    // Reuse the existing subscription if present — the browser keeps
    // ONE subscription per service worker registration, and renewing
    // would invalidate the keys server-side.
    const existing = await reg.pushManager.getSubscription();
    subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          .buffer as ArrayBuffer,
      }));
  } catch (err) {
    return {
      ok: false,
      reason: "subscribe-failed",
      message: (err as Error)?.message,
    };
  }

  const subJson = subscription.toJSON();
  try {
    const res = await fetch(subscribeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subJson),
      credentials: "same-origin",
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "post-failed",
        message: `HTTP ${res.status}`,
        subscription: subJson,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: "post-failed",
      message: (err as Error)?.message,
      subscription: subJson,
    };
  }

  return { ok: true, subscription: subJson };
}

/**
 * Unsubscribe locally AND notify the server so it stops sending pushes
 * to this endpoint. Best-effort — the server-side delete uses the same
 * endpoint-as-key pattern as /api/push/subscribe.
 */
export async function unsubscribeFromPush(): Promise<{ ok: boolean }> {
  if (!isPushSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    try {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
        credentials: "same-origin",
      });
    } catch {
      // Server delete is best-effort — the browser unsubscribe already
      // stopped delivery client-side.
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * VAPID public keys are urlsafe-base64 ; the PushManager API wants a
 * binary Uint8Array. Pads, swaps url-alphabet for the standard one, and
 * decodes via atob — same routine MDN ships in its push samples.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
