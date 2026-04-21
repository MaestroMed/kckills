interface Props {
  status: string;
  className?: string;
}

const COLORS: Record<string, { bg: string; text: string; border: string }> = {
  // Job statuses
  pending: { bg: "var(--orange)", text: "var(--orange)", border: "var(--orange)" },
  running: { bg: "var(--cyan)", text: "var(--cyan)", border: "var(--cyan)" },
  completed: { bg: "var(--green)", text: "var(--green)", border: "var(--green)" },
  failed: { bg: "var(--red)", text: "var(--red)", border: "var(--red)" },
  cancelled: { bg: "var(--text-muted)", text: "var(--text-muted)", border: "var(--text-muted)" },
  // Kill statuses
  raw: { bg: "var(--text-muted)", text: "var(--text-muted)", border: "var(--text-muted)" },
  vod_found: { bg: "var(--cyan)", text: "var(--cyan)", border: "var(--cyan)" },
  clipping: { bg: "var(--orange)", text: "var(--orange)", border: "var(--orange)" },
  clipped: { bg: "var(--orange)", text: "var(--orange)", border: "var(--orange)" },
  analyzed: { bg: "var(--blue-kc)", text: "var(--blue-kc)", border: "var(--blue-kc)" },
  published: { bg: "var(--green)", text: "var(--green)", border: "var(--green)" },
  manual_review: { bg: "var(--red)", text: "var(--red)", border: "var(--red)" },
  // Comment moderation
  approved: { bg: "var(--green)", text: "var(--green)", border: "var(--green)" },
  flagged: { bg: "var(--orange)", text: "var(--orange)", border: "var(--orange)" },
  rejected: { bg: "var(--red)", text: "var(--red)", border: "var(--red)" },
};

export function StatusPill({ status, className = "" }: Props) {
  const c = COLORS[status] ?? { bg: "var(--text-muted)", text: "var(--text-muted)", border: "var(--text-muted)" };
  const animate = status === "running" || status === "clipping" ? "animate-pulse" : "";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${animate} ${className}`}
      style={{
        color: c.text,
        borderColor: c.border + "60",
        backgroundColor: c.bg + "20",
      }}
    >
      {status}
    </span>
  );
}
