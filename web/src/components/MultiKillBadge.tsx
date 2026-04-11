"use client";

interface MultiKillBadgeProps {
  type: string | null | undefined;
  size?: "sm" | "md" | "lg";
}

const BADGE_CONFIG: Record<string, { label: string; class: string }> = {
  penta: { label: "PENTA KILL", class: "badge-penta text-lg" },
  quadra: { label: "QUADRA KILL", class: "text-[var(--orange)] font-black" },
  triple: { label: "TRIPLE KILL", class: "text-[var(--orange)] font-bold" },
  double: { label: "DOUBLE KILL", class: "text-[var(--gold-bright)] font-semibold" },
};

const SIZES = { sm: "text-[10px]", md: "text-xs", lg: "text-sm" };

export function MultiKillBadge({ type, size = "md" }: MultiKillBadgeProps) {
  if (!type || !BADGE_CONFIG[type]) return null;
  const cfg = BADGE_CONFIG[type];

  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 uppercase tracking-wider ${cfg.class} ${SIZES[size]}`}
      style={type !== "penta" ? { backgroundColor: "rgba(255,152,0,0.1)" } : undefined}
    >
      {cfg.label}
    </span>
  );
}
