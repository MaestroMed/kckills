/**
 * dynamic-imports-skeleton.tsx — JSX placeholder for the lazy admin
 * components defined in `dynamic-imports.ts`.
 *
 * Lives in its own .tsx file because `dynamic-imports.ts` (per the
 * Wave 11 perf brief from PR-loltok DF) must remain a .ts module — the
 * file ownership rule names it explicitly with the .ts extension.
 * JSX requires a .tsx extension, so the placeholder lives next to it.
 *
 * Visual contract :
 *   • Dark surface + gold border to match the admin chrome.
 *   • animate-pulse so the operator knows the chunk is loading.
 *   • Optional `label` because admin pages typically tell the operator
 *     what's about to mount ("Chargement de la file de modération…").
 *
 * Importing this in a non-admin route is harmless — the skeleton is
 * tiny and reuses CSS variables that all routes inherit from globals.
 */
export function AdminLoadingSkeleton({
  height = 240,
  label,
}: {
  height?: number;
  label?: string;
}) {
  return (
    <div
      className="w-full rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] animate-pulse flex items-center justify-center"
      style={{ height }}
      aria-busy="true"
      aria-live="polite"
    >
      {label ? (
        <span className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
          {label}
        </span>
      ) : null}
    </div>
  );
}
