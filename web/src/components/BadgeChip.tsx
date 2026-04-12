import { getBadgeDef, type BadgeDef } from "@/lib/badges";

/**
 * Renders a single badge as a small chip with icon, name, and tooltip.
 * Used in user profiles and comment author lines.
 */
export function BadgeChip({ slug }: { slug: string }) {
  const badge = getBadgeDef(slug);
  if (!badge) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border"
      style={{
        color: badge.color,
        borderColor: `${badge.color}40`,
        backgroundColor: `${badge.color}15`,
      }}
      title={`${badge.name} — ${badge.description}`}
    >
      <span>{badge.icon}</span>
      <span className="uppercase tracking-wider">{badge.name}</span>
    </span>
  );
}

/**
 * Renders a row of badges from a list of slugs.
 */
export function BadgeRow({ slugs }: { slugs: string[] }) {
  if (!slugs || slugs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {slugs.map((slug) => (
        <BadgeChip key={slug} slug={slug} />
      ))}
    </div>
  );
}
