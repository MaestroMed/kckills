"use client";

/**
 * OfflineBanner — small fixed-bottom banner that appears when the
 * browser flips `navigator.onLine` to `false`. Disappears automatically
 * when the connection returns.
 *
 * Behaviour:
 *   - Fixed at the BOTTOM of the viewport (above the safe-area inset
 *     on PWA / iOS) so it doesn't fight the top bar nor the right
 *     action sidebar
 *   - Slides in from below with a 220ms transform — disabled under
 *     prefers-reduced-motion (instant fade instead)
 *   - Auto-fires `feed.offline_entered` and `feed.offline_exited`
 *     analytics with a duration_ms so we can measure offline session
 *     length on the dashboard
 *   - Doesn't block any interaction — pointer-events: none on the
 *     wrapper, only the inner pill captures hover/focus for the
 *     "Réessayer" link (which retries the next router refresh)
 *
 * Important: cached clips already in the player pool keep playing
 * because the browser already downloaded them. This banner is purely
 * informational — no destructive action.
 *
 * The parent decides what to PAUSE while offline (e.g. SSR refresh
 * loop) via the same navigator.onLine check, see ScrollFeedV2.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { track } from "@/lib/analytics/track";

/**
 * Public hook variant — returns the same isOffline boolean the banner
 * component uses internally. Lets the parent gate behaviour (e.g.
 * pause router.refresh) without reading window.navigator.onLine itself
 * + so the parent and banner stay in sync.
 */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    // Initial sync — navigator.onLine starts true on SSR-hydration.
    setOffline(!navigator.onLine);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return offline;
}

export function OfflineBanner() {
  const isOffline = useIsOffline();
  const offlineSinceRef = useRef<number | null>(null);

  // Fire analytics on transitions. We don't render anything until the
  // hook flips so the banner stays out of the SSR HTML.
  useEffect(() => {
    if (isOffline) {
      offlineSinceRef.current = Date.now();
      track("feed.offline_entered");
    } else if (offlineSinceRef.current != null) {
      const duration = Date.now() - offlineSinceRef.current;
      offlineSinceRef.current = null;
      track("feed.offline_exited", { metadata: { duration_ms: duration } });
    }
  }, [isOffline]);

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          key="offline-banner"
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-0 right-0 z-[180] flex justify-center"
          style={{
            bottom: "max(1rem, env(safe-area-inset-bottom, 1rem))",
          }}
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <div
            className="pointer-events-auto mx-4 flex max-w-md items-center gap-2.5 rounded-full bg-[var(--bg-elevated)]/95 backdrop-blur-md border border-[var(--orange)]/40 px-4 py-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.6)]"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full bg-[var(--orange)] motion-safe:animate-pulse"
            />
            <p className="text-[12px] leading-tight text-white/85">
              <span className="font-bold text-[var(--orange)]">Mode hors ligne</span>
              <span className="ml-1.5 text-white/60">
                — les nouveaux clips se chargeront au retour de la connexion
              </span>
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
