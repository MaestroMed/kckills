"use client";

import { useEffect, useState } from "react";
import { subscribeToPush } from "@/lib/push";
import { useT } from "@/lib/i18n/use-lang";

/**
 * PushOptIn — small floating button that prompts the user to enable push
 * notifications for new pentas / multi-kills.
 *
 * VAPID public key must be set in NEXT_PUBLIC_VAPID_PUBLIC_KEY — without
 * it the prompt never shows (dev / keys not generated yet).
 * Server endpoint stores the subscription in push_subscriptions table.
 *
 * Wave 38.2 — i18n'd (was hardcoded French while mounted globally in
 * LayoutChrome for all four locales) and rebuilt on lib/push's
 * subscribeToPush so permission handling / subscription reuse / POST
 * live in ONE place. A failed activation now keeps the card up with a
 * retry hint instead of vanishing silently after the user said yes.
 *
 * Hidden by default if:
 *   - Notification API unavailable
 *   - Already subscribed / permission not "default"
 *   - User dismissed (localStorage)
 */
const DISMISSED_KEY = "kc-push-dismissed";
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function PushOptIn() {
  const t = useT();
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

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
    setFailed(false);
    try {
      const result = await subscribeToPush("/api/push/subscribe");
      if (result.ok) {
        setShow(false);
      } else if (
        result.reason === "permission-denied" ||
        result.reason === "unsupported"
      ) {
        // The browser recorded the refusal (or can't do push at all) —
        // re-showing the card can't help, and /settings explains more.
        setShow(false);
      } else {
        console.warn("Push subscribe failed", result.reason, result.message);
        setFailed(true);
      }
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
        {t("p_pushoptin.title")}
      </p>
      <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
        {t("p_pushoptin.body")}
      </p>
      {failed && (
        <p role="alert" className="text-xs text-[var(--red)] mb-3">
          {t("p_pushoptin.error")}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={subscribe}
          disabled={submitting}
          className="flex-1 rounded-lg bg-[var(--gold)] px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
        >
          {submitting ? "..." : t("p_pushoptin.enable")}
        </button>
        <button
          onClick={dismiss}
          className="rounded-lg border border-[var(--border-gold)] px-3 py-2 text-xs text-[var(--text-muted)]"
        >
          {t("p_pushoptin.later")}
        </button>
      </div>
    </div>
  );
}
