import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getPublishedKills, type PublishedKillRow } from "@/lib/supabase/kills";
import { championIconUrl } from "@/lib/constants";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";
import { TEAM_LOGOS } from "@/lib/kc-assets";
import { loadRealData } from "@/lib/real-data";

/**
 * /week — "Cette semaine" recap page.
 *
 * Shows every KC clip the pipeline has processed in the last 7 days,
 * ranked by a "weekly score" (highlight_score × recency bonus + multi-kill
 * boost). Designed to be the landing URL for a weekly Discord recap post
 * / email newsletter: one shareable link that always reflects the current
 * 7-day window.
 *
 * Cooldown: 10 min CDN cache — the window shifts slowly, no reason to
 * hammer the DB on every pageview.
 */

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Cette semaine — KCKILLS",
  description:
    "Top des clips Karmine Corp des 7 derniers jours. Pentakills, outplays, teamfights — le best-of de la semaine LEC.",
  openGraph: {
    title: "Cette semaine — KCKILLS",
    description:
      "Top des clips KC des 7 derniers jours. Le best-of de la semaine.",
    type: "website",
    siteName: "KCKILLS",
  },
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Compute a "freshness-weighted" score inside the 7-day window:
 *  - base = highlight_score (1-10)
 *  - recency = 1 - (age / WEEK_MS), so day-1 = 1.0, day-7 = 0.0
 *  - final = base × (0.7 + recency × 0.3)   // 70% quality, 30% recency
 *  - multipliers for penta / quadra / first-blood
 */
function weeklyScore(k: PublishedKillRow, now: number): number {
  const base = k.highlight_score ?? 5;
  const ts = k.created_at ? new Date(k.created_at).getTime() : now;
  const age = Math.max(0, now - ts);
  const recency = Math.max(0, 1 - age / WEEK_MS);
  let score = base * (0.7 + recency * 0.3);
  if (k.multi_kill === "penta") score *= 2.0;
  else if (k.multi_kill === "quadra") score *= 1.5;
  else if (k.multi_kill === "triple") score *= 1.2;
  if (k.is_first_blood) score *= 1.1;
  return score;
}

export default async function WeekPage() {
  const now = Date.now();
  const since = now - WEEK_MS;

  const all = await getPublishedKills(500);
  const data = loadRealData();

  // Filter: visible KC-killer clips from last 7 days
  const recent = all.filter((k) => {
    if (k.tracked_team_involvement !== "team_killer") return false;
    if (k.kill_visible === false) return false;
    if (!k.clip_url_vertical || !k.thumbnail_url) return false;
    const ts = k.created_at ? new Date(k.created_at).getTime() : 0;
    return ts >= since;
  });

  // Rank + slice
  const ranked = recent
    .map((k) => ({ kill: k, score: weeklyScore(k, now) }))
    .sort((a, b) => b.score - a.score);

  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3, 20);

  // Aggregate stats for the hero
  const totalClips = recent.length;
  const totalPentas = recent.filter((k) => k.multi_kill === "penta").length;
  const totalQuadras = recent.filter((k) => k.multi_kill === "quadra").length;
  const topScore = recent.reduce(
    (acc, k) => Math.max(acc, k.highlight_score ?? 0),
    0,
  );

  // Humanised date range for the header label
  const weekStart = new Date(since).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
  const weekEnd = new Date(now).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ─── HERO ──────────────────────────────────────────────────── */}
      <section className="relative py-16 px-6 md:py-24 bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-surface)] to-[var(--bg-primary)] overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(0,200,185,0.12) 0%, transparent 60%)",
          }}
        />

        <div className="relative max-w-5xl mx-auto text-center">
          <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--cyan)]/70 mb-4">
            ▽ Hebdomadaire · {weekStart} → {weekEnd}
          </p>
          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black leading-none">
            <span className="text-white">CETTE </span>
            <span className="text-shimmer">SEMAINE</span>
          </h1>

          {totalClips === 0 ? (
            <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-white/60 leading-relaxed">
              Aucun clip publié dans les 7 derniers jours. Le pipeline attend
              le prochain match KC.
            </p>
          ) : (
            <>
              <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-white/70 leading-relaxed">
                Les meilleurs moments Karmine Corp des 7 derniers jours,
                classés par score IA et bonus multi-kills.
              </p>

              {/* Quick stats */}
              <div className="mt-8 flex flex-wrap gap-6 justify-center items-center">
                <Stat value={totalClips} label="Clips publiés" />
                {totalPentas > 0 && <Stat value={totalPentas} label="Pentakills" accent="orange" />}
                {totalQuadras > 0 && <Stat value={totalQuadras} label="Quadras" accent="orange" />}
                {topScore > 0 && (
                  <Stat value={topScore.toFixed(1)} label="Top score IA" accent="gold" suffix="/10" />
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ─── TOP 3 PODIUM ──────────────────────────────────────────── */}
      {top3.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 md:px-6 py-12">
          <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--gold)] mb-6">
            🏆 Podium de la semaine
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {top3.map(({ kill }, i) => (
              <PodiumCard key={kill.id} kill={kill} rank={i + 1} data={data} />
            ))}
          </div>
        </section>
      )}

      {/* ─── THE REST ──────────────────────────────────────────────── */}
      {rest.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 md:px-6 pb-16">
          <h2 className="font-display text-xl md:text-2xl font-black text-white/80 mb-6">
            Et aussi...
          </h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
            {rest.map(({ kill }) => (
              <MiniCard key={kill.id} kill={kill} data={data} />
            ))}
          </div>
        </section>
      )}

      {/* ─── DEEPER DIVE CTA ────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <p className="text-sm text-white/60 mb-4">
          Besoin d&apos;aller plus loin ?
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link
            href="/records"
            className="rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-5 py-2.5 text-xs font-display font-bold uppercase tracking-widest text-[var(--gold)] hover:bg-[var(--gold)]/15 transition-all"
          >
            ★ Records Absolus
          </Link>
          <Link
            href="/scroll"
            className="rounded-xl border border-[var(--cyan)]/30 bg-[var(--cyan)]/5 px-5 py-2.5 text-xs font-display font-bold uppercase tracking-widest text-[var(--cyan)] hover:bg-[var(--cyan)]/15 transition-all"
          >
            ▶ Scroll complet
          </Link>
          <Link
            href="/clips?sort=recent"
            className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-5 py-2.5 text-xs font-display font-bold uppercase tracking-widest text-white/70 hover:text-white hover:border-[var(--gold)]/40 transition-all"
          >
            Tous les clips
          </Link>
        </div>
      </section>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────

function Stat({
  value,
  label,
  accent = "white",
  suffix,
}: {
  value: number | string;
  label: string;
  accent?: "gold" | "orange" | "cyan" | "white";
  suffix?: string;
}) {
  const color =
    accent === "gold"
      ? "var(--gold)"
      : accent === "orange"
        ? "var(--orange)"
        : accent === "cyan"
          ? "var(--cyan)"
          : "white";
  return (
    <div>
      <p className="font-data text-3xl md:text-4xl font-black" style={{ color }}>
        {value}
        {suffix && <span className="text-base opacity-60">{suffix}</span>}
      </p>
      <p className="text-[10px] uppercase tracking-widest text-white/40 mt-0.5">
        {label}
      </p>
    </div>
  );
}

function PodiumCard({
  kill,
  rank,
  data,
}: {
  kill: PublishedKillRow;
  rank: number;
  data: ReturnType<typeof loadRealData>;
}) {
  const matchExt = kill.games?.matches?.external_id;
  const matchJson = matchExt ? data.matches.find((m) => m.id === matchExt) : null;
  const oppLogo = matchJson ? TEAM_LOGOS[matchJson.opponent.code] : undefined;

  return (
    <Link
      href={`/scroll?kill=${kill.id}`}
      className="group relative overflow-hidden rounded-2xl border-2 border-[var(--gold)]/20 bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[var(--gold)]/20"
      style={{ aspectRatio: "9/16" }}
    >
      {kill.thumbnail_url && (
        <Image
          src={kill.thumbnail_url}
          alt={`${kill.killer_champion} vs ${kill.victim_champion}`}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          priority={rank === 1}
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

      {/* Rank medal + multi-kill badge */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full font-display text-xl font-black"
          style={{
            background:
              rank === 1
                ? "linear-gradient(135deg, #FFD700, #FFA500)"
                : rank === 2
                  ? "linear-gradient(135deg, #C0C0C0, #909090)"
                  : "linear-gradient(135deg, #CD7F32, #8B4513)",
            color: "black",
            boxShadow:
              rank === 1
                ? "0 0 30px rgba(255,215,0,0.6)"
                : rank === 2
                  ? "0 0 20px rgba(192,192,192,0.4)"
                  : "0 0 20px rgba(205,127,50,0.4)",
          }}
        >
          {rank}
        </div>
        {kill.multi_kill && (
          <span className="rounded-md bg-[var(--orange)]/90 px-1.5 py-0.5 text-[10px] font-black uppercase text-black text-center">
            ⚡ {kill.multi_kill}
          </span>
        )}
      </div>

      {/* Match metadata top right */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1">
        {oppLogo ? (
          <Image src={oppLogo} alt="" width={16} height={16} className="object-contain" />
        ) : null}
        <span className="text-[10px] font-bold text-white">
          KC {matchJson?.kc_score ?? ""}-{matchJson?.opp_score ?? ""} {matchJson?.opponent.code ?? ""}
        </span>
      </div>

      {/* Score pill bottom right */}
      {kill.highlight_score !== null && (
        <div className="absolute bottom-28 right-3 z-10 rounded-md bg-[var(--gold)]/90 px-2 py-1">
          <span className="font-data text-sm font-black text-black">
            {kill.highlight_score.toFixed(1)}/10
          </span>
        </div>
      )}

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
        <div className="flex items-center gap-1.5 mb-2">
          <Image
            src={championIconUrl(kill.killer_champion ?? "Aatrox")}
            alt={kill.killer_champion ?? ""}
            width={28}
            height={28}
            className="rounded-full border border-[var(--gold)]/60"
          />
          <span className="text-[var(--gold)] text-sm">&rarr;</span>
          <Image
            src={championIconUrl(kill.victim_champion ?? "Aatrox")}
            alt={kill.victim_champion ?? ""}
            width={22}
            height={22}
            className="rounded-full border border-white/20 opacity-70"
          />
        </div>
        {isDescriptionClean(kill.ai_description) && (
          <p className="text-xs text-white/85 italic line-clamp-2 leading-tight">
            &laquo; {kill.ai_description} &raquo;
          </p>
        )}
      </div>

      {/* Hover play */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="h-16 w-16 rounded-full bg-[var(--gold)]/30 backdrop-blur-md border border-[var(--gold)]/60 flex items-center justify-center">
          <svg
            className="h-6 w-6 text-[var(--gold)] translate-x-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

function MiniCard({
  kill,
  data,
}: {
  kill: PublishedKillRow;
  data: ReturnType<typeof loadRealData>;
}) {
  const matchExt = kill.games?.matches?.external_id;
  const matchJson = matchExt ? data.matches.find((m) => m.id === matchExt) : null;

  return (
    <Link
      href={`/scroll?kill=${kill.id}`}
      className="group relative overflow-hidden rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/50 hover:-translate-y-0.5"
      style={{ aspectRatio: "9/16" }}
    >
      {kill.thumbnail_url && (
        <Image
          src={kill.thumbnail_url}
          alt=""
          fill
          sizes="(max-width: 768px) 50vw, 20vw"
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

      {/* Top meta */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-1 z-10">
        <span className="rounded bg-black/70 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-bold text-white">
          vs {matchJson?.opponent.code ?? "?"}
        </span>
        {kill.highlight_score !== null && (
          <span className="rounded bg-black/70 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-bold text-[var(--gold)]">
            {kill.highlight_score.toFixed(1)}
          </span>
        )}
      </div>

      {/* Multi-kill badge */}
      {kill.multi_kill && (
        <div className="absolute top-8 left-2 z-10">
          <span className="rounded bg-[var(--orange)]/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
            ⚡ {kill.multi_kill}
          </span>
        </div>
      )}

      {/* Bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-2 z-10">
        <div className="flex items-center gap-1">
          <Image
            src={championIconUrl(kill.killer_champion ?? "Aatrox")}
            alt=""
            width={20}
            height={20}
            className="rounded border border-[var(--gold)]/60"
          />
          <span className="text-[var(--gold)] text-[9px]">→</span>
          <Image
            src={championIconUrl(kill.victim_champion ?? "Aatrox")}
            alt=""
            width={16}
            height={16}
            className="rounded border border-white/20 opacity-70"
          />
        </div>
      </div>
    </Link>
  );
}
