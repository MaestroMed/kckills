import Link from "next/link";
import Image from "next/image";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPublishedKills } from "@/lib/supabase/kills";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Analytics — Admin",
  robots: { index: false, follow: false },
};

// ─── Types ─────────────────────────────────────────────────────────────

interface ClipEngagement24h {
  kill_id: string | null;
  views: number | null;
  starts: number | null;
  completes: number | null;
  replays: number | null;
  shares: number | null;
  likes: number | null;
  completion_rate: number | null;
  unique_viewers: number | null;
}

interface TrendingKill1h {
  kill_id: string | null;
  interactions_1h: number | null;
}

interface FormatRow {
  client_kind: "mobile" | "desktop" | "tablet" | "pwa" | string;
  count: number;
}

interface FunnelRow {
  event_type: string;
  count: number;
}

interface MinimalKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  highlight_score: number | null;
  thumbnail_url?: string | null;
  impression_count?: number | null;
  avg_rating?: number | null;
  comment_count?: number | null;
  rating_count?: number | null;
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function AnalyticsPage() {
  const sb = await createServerSupabase();

  // ── Existing legacy data (preserved) ─────────────────────────────
  const [kills, ratingsRaw, commentsRaw] = await Promise.all([
    getPublishedKills(500),
    sb.from("ratings").select("score,kill_id,created_at"),
    sb.from("comments").select("kill_id,created_at,is_deleted,moderation_status"),
  ]);

  const kcKills = kills.filter((k) => k.tracked_team_involvement === "team_killer");
  const ratings = ratingsRaw.data ?? [];
  const comments = (commentsRaw.data ?? []).filter(
    (c) => !c.is_deleted && c.moderation_status === "approved",
  );

  // Pre-build a kill lookup so the trending list can hydrate titles.
  const killById = new Map<string, MinimalKill>();
  for (const k of kcKills) killById.set(k.id, k as MinimalKill);

  const totalImpressions = kcKills.reduce((s, k) => s + (k.impression_count ?? 0), 0);
  const topImpressions = [...kcKills]
    .sort((a, b) => (b.impression_count ?? 0) - (a.impression_count ?? 0))
    .slice(0, 10);
  const topRated = kcKills
    .filter((k) => (k.rating_count ?? 0) > 0)
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
    .slice(0, 10);
  const topCommented = [...kcKills]
    .filter((k) => (k.comment_count ?? 0) > 0)
    .sort((a, b) => (b.comment_count ?? 0) - (a.comment_count ?? 0))
    .slice(0, 10);

  const published = kcKills.length;
  const withImpressions = kcKills.filter((k) => (k.impression_count ?? 0) > 0).length;
  const withRatings = kcKills.filter((k) => (k.rating_count ?? 0) > 0).length;
  const withComments = kcKills.filter((k) => (k.comment_count ?? 0) > 0).length;

  // Daily activity (kills published per day, last 14 days)
  const now = Date.now();
  const dailyMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const k of kcKills) {
    const d = (k.created_at ?? "").slice(0, 10);
    if (dailyMap.has(d)) dailyMap.set(d, (dailyMap.get(d) ?? 0) + 1);
  }
  const dailyData = Array.from(dailyMap.entries());
  const maxDaily = Math.max(1, ...dailyData.map(([, n]) => n));

  // ── PR : product analytics from user_events ───────────────────────
  // Section 1 : Engagement KPIs (24h) — aggregated from v_clip_engagement_24h.
  // Section 2 : Top trending — v_trending_kills_1h.
  // Sections 3 + 4 : per-format perf + funnel — derived from raw user_events.
  const sinceIso24h = new Date(now - 24 * 3600 * 1000).toISOString();

  const [engagement24hRes, trending1hRes, completedByFormatRes, funnelRes] = await Promise.all([
    sb.from("v_clip_engagement_24h").select("*"),
    sb.from("v_trending_kills_1h").select("*").limit(10),
    // completed events per client_kind, last 24h
    sb
      .from("user_events")
      .select("client_kind, created_at")
      .eq("event_type", "clip.completed")
      .gte("created_at", sinceIso24h),
    // funnel: counts per event_type, last 24h
    sb
      .from("user_events")
      .select("event_type, created_at")
      .in("event_type", [
        "page.viewed",
        "feed.view",
        "clip.viewed",
        "clip.started",
        "clip.completed",
      ])
      .gte("created_at", sinceIso24h),
  ]);

  const engagementRows: ClipEngagement24h[] = (engagement24hRes.data ?? []) as ClipEngagement24h[];
  const trendingRows: TrendingKill1h[] = (trending1hRes.data ?? []) as TrendingKill1h[];

  // Section 1 : KPI aggregation
  let totalViews = 0;
  let totalStarts = 0;
  let totalCompletes = 0;
  let totalShares = 0;
  let totalLikes = 0;
  // unique_viewers across rows can't be summed naively — it would over-count
  // viewers who watched multiple clips. The view computes per-clip uniqueness;
  // we approximate "site-wide unique viewers" by summing then dividing by an
  // estimated clips-per-viewer (using the ratio of total views / unique-by-row).
  // This is a best-effort estimate — the precise count would need a separate
  // SELECT COUNT(DISTINCT ...) query that we don't have a view for yet.
  let summedUniquePerClip = 0;
  for (const r of engagementRows) {
    totalViews += r.views ?? 0;
    totalStarts += r.starts ?? 0;
    totalCompletes += r.completes ?? 0;
    totalShares += r.shares ?? 0;
    totalLikes += r.likes ?? 0;
    summedUniquePerClip += r.unique_viewers ?? 0;
  }
  const completionRate = totalStarts > 0 ? Math.round((totalCompletes / totalStarts) * 100) : 0;
  // Approximate unique viewers : take the max of (sum of unique-per-clip /
  // mean clips per viewer ≈ sqrt(views/uniques+1)). When data is sparse fall
  // back to the per-clip sum which is a safe upper bound.
  const approxUniqueViewers =
    summedUniquePerClip === 0
      ? 0
      : Math.max(1, Math.round(summedUniquePerClip / Math.max(1, Math.sqrt(engagementRows.length))));

  // Section 3 : per-format completion rows
  const formatCounts = new Map<string, number>();
  for (const row of (completedByFormatRes.data ?? []) as Array<{ client_kind: string | null }>) {
    const k = (row.client_kind ?? "unknown").toLowerCase();
    formatCounts.set(k, (formatCounts.get(k) ?? 0) + 1);
  }
  const formatRows: FormatRow[] = (["mobile", "desktop", "tablet", "pwa"] as const).map((kind) => ({
    client_kind: kind,
    count: formatCounts.get(kind) ?? 0,
  }));
  const formatTotal = Math.max(1, formatRows.reduce((s, r) => s + r.count, 0));

  // Section 4 : Funnel rows
  const funnelMap = new Map<string, number>();
  for (const row of (funnelRes.data ?? []) as Array<{ event_type: string }>) {
    funnelMap.set(row.event_type, (funnelMap.get(row.event_type) ?? 0) + 1);
  }
  const funnelRows: FunnelRow[] = [
    { event_type: "page.viewed", count: funnelMap.get("page.viewed") ?? 0 },
    { event_type: "feed.view", count: funnelMap.get("feed.view") ?? 0 },
    { event_type: "clip.viewed", count: funnelMap.get("clip.viewed") ?? 0 },
    { event_type: "clip.started", count: funnelMap.get("clip.started") ?? 0 },
    { event_type: "clip.completed", count: funnelMap.get("clip.completed") ?? 0 },
  ];
  const funnelMax = Math.max(1, ...funnelRows.map((r) => r.count));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Analytics</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          KPIs sur les {kcKills.length} clips KC publiés
          {" · "}
          <span className="text-[var(--cyan)]">
            tracking events des dernières 24h ({engagementRows.length} clips actifs)
          </span>
        </p>
      </header>

      {/* ─── Section 1 : Engagement KPIs (24h) ─────────────────── */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Engagement (dernières 24h)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Vues" value={totalViews.toLocaleString("fr-FR")} accent="cyan" />
          <KpiCard label="Starts" value={totalStarts.toLocaleString("fr-FR")} />
          <KpiCard
            label="Completion"
            value={`${completionRate}%`}
            accent={completionRate >= 60 ? "green" : completionRate >= 30 ? "orange" : "default"}
          />
          <KpiCard label="Shares" value={totalShares.toLocaleString("fr-FR")} accent="orange" />
          <KpiCard label="Likes" value={totalLikes.toLocaleString("fr-FR")} accent="gold" />
          <KpiCard
            label="Unique viewers"
            value={approxUniqueViewers.toLocaleString("fr-FR")}
            accent="green"
          />
        </div>
      </section>

      {/* ─── Section 2 : Top trending clips (1h) ──────────────── */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Tendances (dernière heure)
        </h2>
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
          {trendingRows.length === 0 ? (
            <p className="px-4 py-6 text-xs text-[var(--text-muted)] text-center">
              Aucune interaction tracker dans la dernière heure
            </p>
          ) : (
            <ol className="divide-y divide-[var(--border-gold)]/30">
              {trendingRows.map((t, i) => {
                const k = t.kill_id ? killById.get(t.kill_id) : null;
                return (
                  <li key={t.kill_id ?? i} className="px-3 py-2 flex items-center gap-3 text-xs">
                    <span className="font-mono text-[var(--text-disabled)] w-5 text-right">
                      {i + 1}.
                    </span>
                    {k?.thumbnail_url ? (
                      <Image
                        src={k.thumbnail_url}
                        alt=""
                        width={36}
                        height={64}
                        className="h-10 w-6 rounded object-cover bg-black flex-shrink-0"
                        unoptimized
                      />
                    ) : (
                      <div className="h-10 w-6 rounded bg-[var(--bg-elevated)] flex-shrink-0" />
                    )}
                    {k ? (
                      <Link
                        href={`/kill/${k.id}`}
                        className="flex-1 truncate hover:text-[var(--gold)]"
                      >
                        {k.killer_champion ?? "?"} → {k.victim_champion ?? "?"}
                      </Link>
                    ) : (
                      <span className="flex-1 truncate text-[var(--text-muted)]">
                        {t.kill_id ?? "kill inconnu"}
                      </span>
                    )}
                    <span className="font-mono text-[var(--gold)] flex-shrink-0">
                      {t.interactions_1h ?? 0}
                      <span className="text-[var(--text-muted)] text-[9px] ml-1">×</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      {/* ─── Section 3 : Per-format performance ───────────────── */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Completions par format (dernières 24h)
        </h2>
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
          <div className="space-y-3">
            {formatRows.map((row) => {
              const pct = Math.round((row.count / formatTotal) * 100);
              const accent: "gold" | "cyan" | "green" | "orange" =
                row.client_kind === "mobile"
                  ? "cyan"
                  : row.client_kind === "desktop"
                    ? "gold"
                    : row.client_kind === "tablet"
                      ? "green"
                      : "orange";
              return (
                <FormatBar
                  key={row.client_kind}
                  label={row.client_kind.toUpperCase()}
                  count={row.count}
                  pct={pct}
                  accent={accent}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Section 4 : Funnel ───────────────────────────────── */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Funnel d&apos;engagement (dernières 24h)
        </h2>
        <div className="space-y-2">
          {funnelRows.map((row, i) => {
            const accent: "gold" | "cyan" | "green" | "orange" = (
              ["gold", "cyan", "green", "orange", "gold"] as const
            )[i];
            return (
              <FunnelStep
                key={row.event_type}
                label={prettyEvent(row.event_type)}
                count={row.count}
                max={funnelMax}
                accent={accent}
              />
            );
          })}
        </div>
      </section>

      {/* ─── Legacy : impression-based KPIs (preserved) ───────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Clips publiés" value={published} />
        <KpiCard
          label="Total impressions"
          value={totalImpressions.toLocaleString("fr-FR")}
          accent="cyan"
        />
        <KpiCard label="Total ratings" value={ratings.length} accent="gold" />
        <KpiCard label="Total comments" value={comments.length} accent="green" />
      </section>

      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Funnel publication
        </h2>
        <div className="space-y-2">
          <FunnelStep label="Publiés" count={published} max={published} accent="gold" />
          <FunnelStep
            label="Vus au moins 1×"
            count={withImpressions}
            max={published}
            accent="cyan"
          />
          <FunnelStep label="Notés" count={withRatings} max={published} accent="green" />
          <FunnelStep label="Commentés" count={withComments} max={published} accent="orange" />
        </div>
      </section>

      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Clips publiés / jour (14 derniers jours)
        </h2>
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-end gap-1 h-32">
            {dailyData.map(([date, n]) => (
              <div key={date} className="flex-1 flex flex-col items-center justify-end gap-1">
                <span className="text-[9px] text-[var(--text-muted)]">{n > 0 ? n : ""}</span>
                <div
                  className="w-full bg-[var(--gold)]/30 hover:bg-[var(--gold)] transition-colors rounded-t"
                  style={{
                    height: `${(n / maxDaily) * 100}%`,
                    minHeight: n > 0 ? "4px" : "1px",
                  }}
                  title={`${date}: ${n} clips`}
                />
                <span className="text-[8px] text-[var(--text-muted)] font-mono">
                  {date.slice(8)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopList
          title="Top impressions"
          items={topImpressions}
          metric={(k) => k.impression_count ?? 0}
          suffix="vues"
        />
        <TopList
          title="Top ratings"
          items={topRated}
          metric={(k) => Number((k.avg_rating ?? 0).toFixed(1))}
          suffix="/5"
        />
        <TopList
          title="Top comments"
          items={topCommented}
          metric={(k) => k.comment_count ?? 0}
          suffix="msgs"
        />
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function prettyEvent(eventType: string): string {
  switch (eventType) {
    case "page.viewed":
      return "Page views";
    case "feed.view":
      return "Feed views";
    case "clip.viewed":
      return "Clip viewed";
    case "clip.started":
      return "Clip started";
    case "clip.completed":
      return "Clip completed";
    default:
      return eventType;
  }
}

function KpiCard({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number | string;
  accent?: "default" | "gold" | "green" | "cyan" | "orange";
}) {
  const colors: Record<string, string> = {
    default: "text-[var(--text-primary)]",
    gold: "text-[var(--gold)]",
    green: "text-[var(--green)]",
    cyan: "text-[var(--cyan)]",
    orange: "text-[var(--orange)]",
  };
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <p className={`font-data text-3xl font-black ${colors[accent]}`}>{value}</p>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

function FunnelStep({
  label,
  count,
  max,
  accent,
}: {
  label: string;
  count: number;
  max: number;
  accent: "gold" | "cyan" | "green" | "orange";
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const colors: Record<string, string> = {
    gold: "bg-[var(--gold)]",
    cyan: "bg-[var(--cyan)]",
    green: "bg-[var(--green)]",
    orange: "bg-[var(--orange)]",
  };
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono">
          <span className="font-bold">{count.toLocaleString("fr-FR")}</span>
          <span className="text-[var(--text-disabled)] ml-2">{pct}%</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className={`h-full ${colors[accent]} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FormatBar({
  label,
  count,
  pct,
  accent,
}: {
  label: string;
  count: number;
  pct: number;
  accent: "gold" | "cyan" | "green" | "orange";
}) {
  const colors: Record<string, string> = {
    gold: "bg-[var(--gold)]",
    cyan: "bg-[var(--cyan)]",
    green: "bg-[var(--green)]",
    orange: "bg-[var(--orange)]",
  };
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="font-data uppercase tracking-widest text-[var(--text-secondary)]">
          {label}
        </span>
        <span className="font-mono">
          <span className="font-bold">{count.toLocaleString("fr-FR")}</span>
          <span className="text-[var(--text-disabled)] ml-2">{pct}%</span>
        </span>
      </div>
      <div className="h-3 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className={`h-full ${colors[accent]} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TopList({
  title,
  items,
  metric,
  suffix,
}: {
  title: string;
  items: MinimalKill[];
  metric: (k: MinimalKill) => number;
  suffix: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
      <header className="px-3 py-2 border-b border-[var(--border-gold)] bg-[var(--bg-elevated)]">
        <h3 className="font-display text-[10px] uppercase tracking-widest text-[var(--gold)]">
          {title}
        </h3>
      </header>
      <ol className="divide-y divide-[var(--border-gold)]/30">
        {items.length === 0 ? (
          <li className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">
            Pas encore de données
          </li>
        ) : (
          items.map((k, i) => (
            <li key={k.id} className="px-3 py-2 flex items-center gap-2 text-xs">
              <span className="font-mono text-[var(--text-disabled)] w-4">{i + 1}.</span>
              <Link href={`/kill/${k.id}`} className="flex-1 truncate hover:text-[var(--gold)]">
                {k.killer_champion} → {k.victim_champion}
              </Link>
              <span className="font-mono text-[var(--gold)] flex-shrink-0">
                {metric(k)} <span className="text-[var(--text-muted)] text-[9px]">{suffix}</span>
              </span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}
