import type { ReactNode } from "react";

type StatVariant = "gold" | "cyan" | "red" | "neutral";

interface StatCardProps {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  icon?: ReactNode;
  variant?: StatVariant;
  className?: string;
}

const variantStyles: Record<StatVariant, { border: string; gradient: string; valueColor: string }> = {
  gold: {
    border: "rgba(200,170,110,0.35)",
    gradient: "linear-gradient(135deg, rgba(200,170,110,0.12) 0%, transparent 60%)",
    valueColor: "text-[var(--gold)]",
  },
  cyan: {
    border: "rgba(10,200,185,0.35)",
    gradient: "linear-gradient(135deg, rgba(10,200,185,0.12) 0%, transparent 60%)",
    valueColor: "text-[var(--cyan)]",
  },
  red: {
    border: "rgba(232,64,87,0.35)",
    gradient: "linear-gradient(135deg, rgba(232,64,87,0.12) 0%, transparent 60%)",
    valueColor: "text-[var(--red)]",
  },
  neutral: {
    border: "rgba(255,255,255,0.15)",
    gradient: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 60%)",
    valueColor: "text-white",
  },
};

/**
 * Single-stat card with gold/cyan/red/neutral accents. Replaces the ad-hoc
 * `<div class="... tabular-nums ...">` blocks scattered across records,
 * hall-of-fame, stats, and compare pages.
 */
export function StatCard({
  label,
  value,
  sublabel,
  icon,
  variant = "gold",
  className,
}: StatCardProps) {
  const s = variantStyles[variant];
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 md:p-6 ${className ?? ""}`}
      style={{ borderColor: s.border, background: s.gradient }}
    >
      {icon ? <div className="mb-3 text-xl opacity-80">{icon}</div> : null}
      <p className="text-[10px] uppercase tracking-[0.25em] text-white/50 font-data">
        {label}
      </p>
      <p
        className={`font-data text-3xl md:text-4xl font-black tabular-nums mt-2 ${s.valueColor}`}
      >
        {value}
      </p>
      {sublabel ? (
        <p className="text-xs text-white/60 mt-1">{sublabel}</p>
      ) : null}
    </div>
  );
}
