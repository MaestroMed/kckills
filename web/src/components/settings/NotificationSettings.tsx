"use client";

/**
 * NotificationSettings — full push notification management for /settings.
 *
 * Three states the UI handles :
 *
 *   1. UNSUPPORTED — browser has no Notification API or no service worker.
 *      We just render a flat "ton navigateur ne supporte pas les notifs"
 *      with a faded card.
 *
 *   2. NOT SUBSCRIBED — Notification.permission ∈ {default, denied}.
 *      Show an "Activer" button. If permission is denied, the button is
 *      disabled with an explainer pointing the user at their browser
 *      settings (we can't programmatically re-prompt once denied).
 *
 *   3. SUBSCRIBED — render per-kind toggles. The user can :
 *        * silence specific kinds (kill / kotw / live_match / broadcast)
 *        * silence everything via "all"
 *        * unsubscribe (deletes the row from push_subscriptions)
 *
 * Preferences are persisted via PUT /api/push/preferences with the
 * device's endpoint URL as the lookup key (no auth needed — possessing
 * the endpoint is the auth).
 *
 * The PushOptIn floating prompt and this settings panel co-exist
 * peacefully : the prompt only appears when permission === "default" AND
 * the user hasn't dismissed. Once they subscribe via either path, the
 * dismissed flag is irrelevant.
 */

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/track";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type Permission = "default" | "granted" | "denied" | "unsupported" | "ios_needs_install";

/**
 * iOS PWA gate
 * ════════════
 * Web Push on iOS Safari requires :
 *   1. iOS / iPadOS 16.4+ (released March 2023)
 *   2. The site MUST be installed to the home screen first — Safari
 *      will not surface the permission prompt from a regular browser
 *      tab. Calling Notification.requestPermission() throws.
 *
 * Detect : iPhone/iPad UA + display-mode is NOT standalone → block the
 * subscribe button and surface the install instructions instead.
 *
 * Returns true ONLY when running on iOS in a regular browser tab. iOS
 * inside an installed PWA returns false (push works normally there).
 * Non-iOS platforms always return false.
 */
function needsIosInstall(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  // Modern detection — iPadOS 13+ reports "MacIntel" platform but has touch.
  const ua = navigator.userAgent || "";
  const isIos =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints !== undefined && ((navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1);
  if (!isIos) return false;
  try {
    const standalone =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches;
    // Legacy iOS exposes navigator.standalone (non-standard) before
    // they added matchMedia support for display-mode.
    const legacyStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return !standalone && !legacyStandalone;
  } catch {
    return true; // err on the side of showing the explainer
  }
}

interface Preferences {
  all: boolean;
  kill: boolean;
  kill_of_the_week: boolean;
  editorial_pin: boolean;
  live_match: boolean;
  broadcast: boolean;
  system: boolean;
}

const DEFAULT_PREFS: Preferences = {
  all: true,
  kill: true,
  kill_of_the_week: true,
  editorial_pin: true,
  live_match: true,
  broadcast: true,
  system: true,
};

const KIND_LABELS: Array<{ key: keyof Preferences; label: string; desc: string }> = [
  { key: "kill_of_the_week", label: "Kill of the Week", desc: "Pick éditorial du dimanche soir." },
  { key: "kill", label: "Highlights", desc: "Pentakills, quadras, plays exceptionnelles." },
  { key: "live_match", label: "Live KC", desc: "Quand KC entre en game live LEC." },
  { key: "editorial_pin", label: "Pick éditorial", desc: "Quand on épingle un clip à l'accueil." },
  { key: "broadcast", label: "Annonces", desc: "Événements, anniversaires, etc." },
  { key: "system", label: "Système", desc: "Maintenance, downtime (rare)." },
];

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function NotificationSettings() {
  const [permission, setPermission] = useState<Permission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect support + current state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      // iOS-in-Safari-tab gate runs BEFORE the API check — Safari does
      // expose the Notification API in a regular tab on 16.4+, but the
      // permission prompt throws there. Show the install explainer
      // instead so the user knows what to do.
      if (needsIosInstall()) {
        if (!cancelled) setPermission("ios_needs_install");
        return;
      }
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setPermission("unsupported");
        return;
      }
      const perm = Notification.permission as Permission;
      if (!cancelled) setPermission(perm);
      if (perm !== "granted") return;

      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) {
          // Permission granted but no subscription — happens when the
          // browser cleared push state but kept the permission. Treat
          // as not-subscribed so the user can re-activate.
          if (!cancelled) setPermission("default");
          return;
        }
        if (!cancelled) setEndpoint(sub.endpoint);

        // Load saved preferences for this device.
        const r = await fetch(
          `/api/push/preferences?endpoint=${encodeURIComponent(sub.endpoint)}`,
        );
        if (r.ok) {
          const data = await r.json();
          if (!cancelled && data?.preferences) {
            setPrefs({ ...DEFAULT_PREFS, ...data.preferences });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = async () => {
    if (!VAPID) {
      setError("Push notifications non configurées (VAPID key manquante)");
      return;
    }
    setBusy("subscribe");
    setError(null);
    try {
      // Explicit requestPermission() handles the case where permission
      // is "default" — calling pushManager.subscribe() with
      // userVisibleOnly: true does prompt automatically, but doing it
      // separately lets us track the denial as a distinct analytics
      // event and surface a friendlier UX.
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        if (result !== "granted") {
          setPermission(result === "denied" ? "denied" : "default");
          track("push.permission_denied", { metadata: { result } });
          return;
        }
      } else if (Notification.permission === "denied") {
        // Shouldn't reach here from the UI, but defensive.
        setPermission("denied");
        track("push.permission_denied", { metadata: { result: "denied" } });
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID).buffer as ArrayBuffer,
      });
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEndpoint(sub.endpoint);
      setPermission("granted");
      setPrefs(DEFAULT_PREFS);
      track("push.subscribed", {
        metadata: { endpoint_host: safeHost(sub.endpoint) },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur d'abonnement";
      setError(msg);
      // Treat NotAllowedError as a permission denial — the browser may
      // throw this when the user rejected an OS-level prompt that we
      // don't see as a "denied" state on the Notification.permission API.
      if (e instanceof Error && e.name === "NotAllowedError") {
        setPermission("denied");
        track("push.permission_denied", { metadata: { reason: "NotAllowedError" } });
      }
    } finally {
      setBusy(null);
    }
  };

  const updatePrefs = async (next: Preferences) => {
    if (!endpoint) return;
    const previous = prefs;
    setPrefs(next); // optimistic
    setBusy("prefs");
    setError(null);
    try {
      const r = await fetch("/api/push/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, preferences: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Diff the prefs and report which kinds flipped — useful to spot
      // which categories users actually mute in aggregate.
      const flipped: string[] = [];
      for (const k of Object.keys(next) as Array<keyof Preferences>) {
        if (previous[k] !== next[k]) flipped.push(k);
      }
      track("push.preferences_updated", { metadata: { flipped } });
    } catch (e) {
      setPrefs(previous); // rollback
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  };

  const togglePref = (key: keyof Preferences) => {
    updatePrefs({ ...prefs, [key]: !prefs[key] });
  };

  const unsubscribe = async () => {
    if (!endpoint) return;
    if (!confirm("Désactiver les notifications ? Tu ne recevras plus rien depuis ce navigateur.")) return;
    setBusy("unsubscribe");
    setError(null);
    try {
      // 1. Tell our backend to forget the subscription.
      await fetch("/api/push/preferences", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      // 2. Tell the push service to revoke (releases the OS-level
      //    permission for clean re-subscription later).
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      setEndpoint(null);
      setPermission("default");
      setPrefs(DEFAULT_PREFS);
      track("push.unsubscribed", {
        metadata: { endpoint_host: safeHost(endpoint) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  };

  // ── Render branches ────────────────────────────────────────────────

  if (permission === "unsupported") {
    return (
      <Card>
        <h2 className="font-display font-semibold">Notifications</h2>
        <p className="text-sm text-[var(--text-muted)]" role="status" aria-live="polite">
          Ton navigateur ne supporte pas les notifications push.
        </p>
      </Card>
    );
  }

  if (permission === "ios_needs_install") {
    return (
      <Card>
        <h2 className="font-display font-semibold">Notifications</h2>
        <div className="space-y-2" role="status" aria-live="polite">
          <p className="text-sm text-[var(--text-muted)]">
            Sur iOS, installe d&apos;abord l&apos;app sur ton écran d&apos;accueil pour activer les notifications.
          </p>
          <ol className="text-xs text-[var(--text-muted)] space-y-1 list-decimal list-inside pl-1">
            <li>Touche le bouton <strong>Partager</strong> en bas de Safari.</li>
            <li>Choisis <strong>« Sur l&apos;écran d&apos;accueil »</strong>.</li>
            <li>Ouvre KCKILLS depuis l&apos;icône, puis reviens ici.</li>
          </ol>
          <p className="text-[10px] text-[var(--text-muted)] opacity-70">
            iOS 16.4 ou plus récent requis.
          </p>
        </div>
      </Card>
    );
  }

  if (!endpoint || permission !== "granted") {
    return (
      <Card>
        <h2 className="font-display font-semibold">Notifications</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Reçois une notif quand un pentakill, un quadra, ou le Kill of the Week tombe.
        </p>
        <div role="status" aria-live="polite" className="space-y-2">
        {permission === "denied" ? (
          <div className="space-y-2">
            <p className="text-xs text-[var(--red)]">
              Les notifications sont bloquées dans ton navigateur. Réactive-les depuis :
            </p>
            <ul className="text-xs text-[var(--text-muted)] space-y-1 list-disc list-inside pl-1">
              <li><strong>Chrome / Edge</strong> : icône cadenas (barre d&apos;adresse) → Notifications → Autoriser</li>
              <li><strong>Firefox</strong> : icône cadenas → Permissions → Notifications</li>
              <li><strong>Safari</strong> : Réglages &gt; Sites web &gt; Notifications</li>
            </ul>
            <button
              disabled
              className="w-full md:w-auto rounded-lg border border-[var(--border-gold)] px-4 py-3 text-sm text-[var(--text-muted)] opacity-50 cursor-not-allowed min-h-[44px]"
            >
              Bloquées par le navigateur
            </button>
          </div>
        ) : (
          <button
            onClick={subscribe}
            disabled={busy === "subscribe" || !VAPID}
            className="w-full md:w-auto rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-bold text-black disabled:opacity-50 min-h-[44px]"
          >
            {busy === "subscribe" ? "Activation…" : !VAPID ? "Indisponible" : "Activer les notifications"}
          </button>
        )}
        {error && (
          <p className="text-xs text-[var(--red)]">{error}</p>
        )}
        </div>
      </Card>
    );
  }

  // Subscribed — show preferences.
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Notifications</h2>
        <span
          className="text-[10px] uppercase tracking-widest text-[var(--green)]"
          role="status"
          aria-live="polite"
        >
          ● Actif
        </span>
      </div>

      {/* Master toggle */}
      <label className="flex items-start gap-3 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={prefs.all}
          onChange={() => togglePref("all")}
          disabled={busy === "prefs"}
          className="mt-0.5 h-4 w-4 accent-[var(--gold)]"
        />
        <div className="flex-1">
          <div className="text-sm font-bold text-[var(--gold)]">
            Master switch
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Désactive tout sans te désabonner. Tu peux réactiver kind par kind plus bas.
          </div>
        </div>
      </label>

      {/* Per-kind toggles */}
      <div className="space-y-1.5">
        {KIND_LABELS.map((k) => (
          <label
            key={k.key}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              prefs.all
                ? "border-[var(--border-gold)] bg-[var(--bg-elevated)]/40 hover:border-[var(--gold)]/40"
                : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]/20 opacity-50 cursor-not-allowed"
            }`}
          >
            <input
              type="checkbox"
              checked={prefs[k.key]}
              onChange={() => togglePref(k.key)}
              disabled={!prefs.all || busy === "prefs"}
              className="mt-0.5 h-4 w-4 accent-[var(--gold)]"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {k.label}
              </div>
              <div className="text-xs text-[var(--text-muted)]">{k.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Unsubscribe */}
      <div className="pt-2 border-t border-[var(--border-subtle)]">
        <button
          onClick={unsubscribe}
          disabled={busy === "unsubscribe"}
          className="inline-flex items-center min-h-[44px] py-2 text-xs text-[var(--text-muted)] hover:text-[var(--red)] underline"
        >
          {busy === "unsubscribe" ? "Désactivation…" : "Désactiver complètement les notifications"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-[var(--red)]" role="status" aria-live="polite">{error}</p>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
      {children}
    </section>
  );
}

/**
 * Strip the secret token from a push endpoint URL so we can include just
 * the host (fcm.googleapis.com / updates.push.services.mozilla.com /
 * web.push.apple.com / …) in analytics. The token portion of the URL
 * is the device's push credential — never log it.
 */
function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}
