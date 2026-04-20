export function ScoreChip({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className="text-[10px] text-[var(--text-disabled)]">—</span>;
  const color =
    value >= 8 ? "bg-[var(--green)]/20 text-[var(--green)] border-[var(--green)]/40"
    : value >= 6 ? "bg-[var(--gold)]/20 text-[var(--gold)] border-[var(--gold)]/40"
    : value >= 4 ? "bg-[var(--orange)]/20 text-[var(--orange)] border-[var(--orange)]/40"
    : "bg-[var(--red)]/20 text-[var(--red)] border-[var(--red)]/40";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 font-mono font-bold text-[11px] min-w-[38px] ${color} ${className ?? ""}`}
    >
      {value.toFixed(1)}
    </span>
  );
}
