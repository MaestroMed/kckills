import { getPublishedKills } from "@/lib/supabase/kills";

/**
 * TaggingInsights — pulls the published-kills sample, computes
 * distributions across the 6 Scroll Vivant dimensions + a few
 * derived signals, renders them as horizontal bar charts.
 *
 * Each chart answers a story-worthy question:
 *   - WHEN does KC strike?      (game_minute_bucket)
 *   - HOW does KC fight?         (fight_type)
 *   - WHAT does KC kill?         (champion_class — victim breakdown)
 *   - WHO carries?               (killer_player_id with quality weight)
 *
 * Pure server component, ~150 lines, no charts library — the bars are
 * styled divs sized by percent. Cheaper than recharts on this surface.
 */

type Bar = { label: string; count: number; pct: number; accent?: string };

const TIME_ORDER = ["0-5", "5-10", "10-15", "15-20", "20-25", "25-30", "30-35", "35+"];
const FIGHT_LABELS: Record<string, string> = {
  solo_kill: "Solo kill",
  gank: "Gank",
  pick: "Pick",
  skirmish_2v2: "Skirmish 2v2",
  skirmish_3v3: "Skirmish 3v3",
  teamfight_4v4: "Teamfight 4v4",
  teamfight_5v5: "Teamfight 5v5",
};
const CLASS_LABELS: Record<string, string> = {
  assassin: "Assassin",
  bruiser: "Bruiser",
  mage: "Mage",
  marksman: "Marksman",
  tank: "Tank",
  enchanter: "Enchanter",
  skirmisher: "Skirmisher",
};

export async function TaggingInsights() {
  const kills = await getPublishedKills(500);
  const kc = kills.filter((k) => k.tracked_team_involvement === "team_killer");
  if (kc.length === 0) return null;

  const total = kc.length;

  // Bucket kills by their tagged dimensions.
  const byMinute = bucketize(kc.map((k) => k.game_minute_bucket), TIME_ORDER);
  const byFight = bucketize(
    kc.map((k) => k.fight_type),
    Object.keys(FIGHT_LABELS),
    FIGHT_LABELS,
  );
  const byClass = bucketize(
    kc.map((k) => k.champion_class),
    Object.keys(CLASS_LABELS),
    CLASS_LABELS,
  );

  // Sample stat: average highlight score.
  const scores = kc.map((k) => k.highlight_score).filter((s): s is number => typeof s === "number");
  const avgHighlight = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const exceptional = kc.filter((k) => (k.highlight_score ?? 0) >= 8.5).length;
  const multiKills = kc.filter((k) => k.multi_kill).length;
  const firstBloods = kc.filter((k) => k.is_first_blood).length;

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border-gold)]" />
        <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
          Tagging Insights
        </span>
        <span className="h-px flex-1 bg-[var(--border-gold)]" />
      </div>

      <p className="text-sm text-[var(--text-muted)] max-w-2xl">
        Distribution des {total} kills KC tagg&eacute;s par le pipeline IA + ground truth serveur.
        Met &agrave; jour automatiquement.
      </p>

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickStat label="Score IA moyen" value={avgHighlight != null ? avgHighlight.toFixed(1) : "—"} suffix="/10" accent="var(--gold)" />
        <QuickStat label="Exceptionnels (\u22658.5)" value={exceptional} accent="var(--orange)" />
        <QuickStat label="Multi-kills" value={multiKills} accent="var(--gold)" />
        <QuickStat label="First Bloods" value={firstBloods} accent="var(--red)" />
      </div>

      {/* Three side-by-side bar charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <BarChart
          title="Quand KC frappe"
          subtitle="Kills par fenetre de 5 minutes in-game"
          bars={byMinute.bars}
          maxCount={byMinute.max}
        />
        <BarChart
          title="Comment KC se bat"
          subtitle="Fight type (calcul\u00e9 server-side)"
          bars={byFight.bars}
          maxCount={byFight.max}
        />
        <BarChart
          title="Cibles favorites"
          subtitle="Classe du killer KC"
          bars={byClass.bars}
          maxCount={byClass.max}
        />
      </div>
    </section>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function QuickStat({ label, value, suffix = "", accent = "var(--gold)" }: { label: string; value: string | number; suffix?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
      <p className="font-data text-2xl font-black" style={{ color: accent }}>
        {value}
        {suffix && <span className="text-base text-white/40 ml-1">{suffix}</span>}
      </p>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">
        {label}
      </p>
    </div>
  );
}

function BarChart({
  title,
  subtitle,
  bars,
  maxCount,
}: {
  title: string;
  subtitle: string;
  bars: Bar[];
  maxCount: number;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
      <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">{title}</h3>
      <p className="text-[11px] text-[var(--text-muted)] mb-4">{subtitle}</p>
      <ul className="space-y-2.5">
        {bars.map((b) => (
          <li key={b.label} className="flex items-center gap-3 text-xs">
            <span className="w-24 truncate text-[var(--text-secondary)]" title={b.label}>
              {b.label}
            </span>
            <div className="flex-1 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${maxCount > 0 ? (b.count / maxCount) * 100 : 0}%`,
                  backgroundColor: b.accent ?? "var(--gold)",
                  boxShadow: `0 0 8px ${b.accent ?? "var(--gold)"}55`,
                }}
              />
            </div>
            <span className="font-data tabular-nums text-white/65 w-12 text-right">
              {b.count}
            </span>
            <span className="font-data text-[10px] text-white/35 w-9 text-right tabular-nums">
              {b.pct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function bucketize(
  values: (string | null | undefined)[],
  order: string[],
  labels?: Record<string, string>,
): { bars: Bar[]; max: number } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    total += 1;
  }
  const bars: Bar[] = order
    .filter((k) => counts.has(k))
    .map((k) => ({
      label: labels?.[k] ?? k,
      count: counts.get(k) ?? 0,
      pct: total > 0 ? ((counts.get(k) ?? 0) / total) * 100 : 0,
    }));
  // Append any unmapped values at the bottom.
  for (const [k, c] of counts) {
    if (!order.includes(k)) {
      bars.push({ label: labels?.[k] ?? k, count: c, pct: total > 0 ? (c / total) * 100 : 0 });
    }
  }
  const max = Math.max(1, ...bars.map((b) => b.count));
  return { bars, max };
}
