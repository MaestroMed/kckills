/** Chargement d'une page admin : squelette sobre, la barre latérale reste en place. */
export default function AdminLoading() {
  return (
    <div role="status" aria-label="Chargement" className="space-y-4 motion-safe:animate-pulse">
      <div className="h-8 w-56 rounded-md bg-[var(--bg-elevated)]" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]" />
        ))}
      </div>
      <div className="h-72 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]" />
    </div>
  );
}
