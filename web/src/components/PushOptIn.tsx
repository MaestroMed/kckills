"use client";

import { useEffect, useState } from "react";

/**
 * PushOptIn — small floating button that prompts the user to enable push
 * notifications for new pentas / multi-kills.
 *
 * VAPID public key must be set in NEXT_PUBLIC_VAPID_PUBLIC_KEY.
 * Server endpoint stores the subscription in push_subscriptions table.
 *
 * Hidden by default if:
 *   - Notification API unavailable
 *   - Already subscribed
 *   - Permission denied
 *   - User dismissed (localStorage)
 */
const DISMISSED_KEY = "kc-push-dismissed";
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function PushOptIn() {
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Only show if browser supports it AND no env var means we're in dev
    if (typeof window === "undefined") return;
    if (!VAPID) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Show after 30s of usage so we don't ambush new visitors
    const timer = setTimeout(() => setShow(true), 30_000);
    return () => clearTimeout(timer);
  }, []);

  const subscribe = async () => {
    setSubmitting(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID).buffer as ArrayBuffer,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setShow(false);
    } catch (e) {
      console.warn("Push subscribe failed", e);
      setShow(false);
    } finally {
      setSubmitting(false);
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[80] max-w-xs rounded-2xl border border-[var(--gold)]/30 bg-black/90 backdrop-blur-md p-4 shadow-2xl">
      <p className="font-display text-sm font-bold text-[var(--gold)] mb-1">
        🔔 Notifs penta + multi-kills
      </p>
      <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
        Recevoir une notif quand KC fait un pentakill ou un quadra.
      </p>
      <div className="flex gap-2">
        <button
          onClick={subscribe}
          disabled={submitting}
          className="flex-1 rounded-lg bg-[var(--gold)] px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
        >
          {submitting ? "..." : "Activer"}
        </button>
        <button
          onClick={dismiss}
          className="rounded-lg border border-[var(--border-gold)] px-3 py-2 text-xs text-[var(--text-muted)]"
        >
          Plus tard
        </button>
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
