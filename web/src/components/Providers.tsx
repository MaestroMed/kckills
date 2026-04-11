"use client";

import { LazyMotion, domAnimation } from "framer-motion";
import { ToastProvider } from "./Toast";

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
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <ToastProvider>{children}</ToastProvider>
    </LazyMotion>
  );
}
