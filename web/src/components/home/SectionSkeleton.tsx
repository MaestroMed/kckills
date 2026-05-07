/**
 * SectionSkeleton — generic Suspense fallback for below-the-fold async
 * server components on the homepage.
 *
 * Wave 13j (2026-05-07) — picks a fixed `min-h` so the page layout
 * doesn't shift when the section's data resolves and the real content
 * mounts. The actual section heights vary, so each call site picks a
 * size hint (sm/md/lg/xl) calibrated against the rendered card heights.
 */

const HEIGHT_CLASS = {
  sm: "min-h-[200px]",
  md: "min-h-[400px]",
  lg: "min-h-[600px]",
  xl: "min-h-[800px]",
} as const;

interface SectionSkeletonProps {
  size?: keyof typeof HEIGHT_CLASS;
  /** Optional aria-label for screen readers. Defaults to a generic
   *  "Section en cours de chargement". */
  label?: string;
}

export function SectionSkeleton({ size = "md", label }: SectionSkeletonProps) {
  return (
    <section
      aria-label={label ?? "Section en cours de chargement"}
      aria-busy="true"
      className={`${HEIGHT_CLASS[size]} max-w-7xl mx-auto px-4 md:px-6 py-6`}
    >
      <div className="rounded-xl border border-[var(--gold)]/10 bg-[var(--bg-surface)] h-full animate-pulse" />
    </section>
  );
}
