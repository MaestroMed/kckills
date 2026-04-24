"use client";

import { LazyMotion, domAnimation } from "framer-motion";
import { ToastProvider } from "./Toast";
import { CommandPalette } from "./CommandPalette";
import { KonamiBlueWall } from "./KonamiBlueWall";
import { PwaInstallPrompt } from "./PwaInstallPrompt";
import { LangProvider } from "@/lib/i18n/use-lang";
import type { Lang } from "@/lib/i18n/lang";
import { AuthEventTracker } from "./analytics/AuthEventTracker";

/**
 * App-wide providers.
 *
 * LazyMotion + domAnimation lets us use the `m` component (imported by
 * individual pages/components) instead of the full `motion` bundle. This
 * shaves ~21 KB from the client JS because transforms/layout/drag features
 * are no longer shipped by default.
 *
 * Children must import `m` from framer-motion (not `motion`) and keep
 * hooks like useMotionValue / useInView as direct imports.
 *
 * The CommandPalette is mounted globally so the ⌘K / Ctrl+K shortcut works
 * on every route.
 */
export function Providers({
  children,
  initialLang,
}: {
  children: React.ReactNode;
  /** Resolved server-side via getServerLang() — passed in from the root
   *  layout so the first paint matches the user's preference (no flash
   *  of French content for an English-speaking visitor). */
  initialLang?: Lang;
}) {
  return (
    <LangProvider initialLang={initialLang}>
      <LazyMotion features={domAnimation} strict>
        <ToastProvider>
          {children}
          <CommandPalette />
          <KonamiBlueWall />
          <PwaInstallPrompt />
          <AuthEventTracker />
        </ToastProvider>
      </LazyMotion>
    </LangProvider>
  );
}
