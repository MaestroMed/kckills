"use client";

/**
 * Client-side catalogue grid for /achievements.
 *
 * Receives an SSR shell from the server page (catalogue + recent feed +
 * a "summary" computed with no session). On mount we grab the BCC
 * session hash from localStorage and re-fetch the catalogue + summary so
 * anon visitors immediately see their own earned state.
 *
 * Layout :
 *   - Hero : "BADGES DE LA BCC" + intro + "Mon score" card
 *   - Filter chips : All / Earned / Locked + rarity filter
 *   - Categories : one section per AchievementCategory
 *   - Each card : icon, name, description, rarity dot, points, progress
 *   - Footer feed : "Récemment débloqués par la BCC" (10 rows)
 *
 * Accessibility :
 *   - `prefers-reduced-motion` disables the entrance fade
 *   - Each card is a focusable button so keyboard users can read details
 *   - Rarity color is doubled by a label so colour-blind users aren't
 *     left out
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getBCCSessionHash } from "@/lib/bcc-state";
import {
  type AchievementCategory,
  type AchievementRarity,
  type AchievementRow,
  type RecentUnlockRow,
  type UserPointsSummary,
  CATEGORY_LABEL,
  RARITY_COLOR,
  RARITY_LABEL,
  computeProgressPercent,
  describeProgress,
} from "@/lib/supabase/achievements";

interface AchievementsCatalogProps {
  initialRows: AchievementRow[];
  initialRecent: RecentUnlockRow[];
  initialSummary: UserPointsSummary;
}

type EarnedFilter = "all" | "earned" | "locked";

const CATEGORY_ORDER: AchievementCategory[] = [
  "engagement",
  "social",
  "community",
  "curator",
  "predictor",
  "collector",
];

const RARITY_ORDER: AchievementRarity[] = [
  "common",
  "rare",
  "epic",
  "legendary",
];

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function AchievementsCatalog({
  initialRows,
  initialRecent,
  initialSummary,
}: AchievementsCatalogProps) {
  const [rows, setRows] = useState<AchievementRow[]>(initialRows);
  const [recent, setRecent] = useState<RecentUnlockRow[]>(initialRecent);
  const [summary, setSummary] = useState<UserPointsSummary>(initialSummary);
  const [earnedFilter, setEarnedFilter] = useState<EarnedFilter>("all");
  const [rarityFilter, setRarityFilter] = useState<AchievementRarity | "all">("all");
  const [focused, setFocused] = useState<string | null>(null);
  const focusedRowRef = useRef<HTMLDivElement | null>(null);

  // Re-fetch with the BCC session hash once we're on the client.
  // We hit the same anon-safe Supabase endpoint the server used.
  useEffect(() => {
    let cancelled = false;
    const hash = getBCCSessionHash();
    if (!hash || hash === "bcc-ssr-placeholder-hash") return;

    (async () => {
      try {
        const res = await fetch(`/api/achievements?session=${encodeURIComponent(hash)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          rows: AchievementRow[];
          recent: RecentUnlockRow[];
          summary: UserPointsSummary;
        };
        if (cancelled) return;
        if (Array.isArray(payload.rows)) setRows(payload.rows);
        if (Array.isArray(payload.recent)) setRecent(payload.recent);
        if (payload.summary) setSummary(payload.summary);
      } catch {
        // Silent fail — the SSR shell already rendered the locked grid.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filtering state derived from filters + rows.
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (rarityFilter !== "all" && row.rarity !== rarityFilter) return false;
      if (earnedFilter === "earned" && !row.earned_at) return false;
      if (earnedFilter === "locked" && row.earned_at) return false;
      return true;
    });
  }, [rows, earnedFilter, rarityFilter]);

  const grouped = useMemo(() => {
    const buckets = new Map<AchievementCategory, AchievementRow[]>();
    for (const row of filtered) {
      const list = buckets.get(row.category) ?? [];
      list.push(row);
      buckets.set(row.category, list);
    }
    return CATEGORY_ORDER
      .map((cat) => ({ category: cat, rows: buckets.get(cat) ?? [] }))
      .filter((b) => b.rows.length > 0);
  }, [filtered]);

  const handleCardClick = useCallback((slug: string) => {
    setFocused((prev) => (prev === slug ? null : slug));
    requestAnimationFrame(() => {
      focusedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
      {/* ─── Hero ────────────────────────────────────────────── */}
      <header className="mb-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
            Badges de la BCC
          </h1>
          <p className="mt-3 max-w-2xl text-sm md:text-base text-[var(--text-secondary)]">
            Chaque action sur KCKILLS débloque un badge. Vote, commente,
            partage, prédis : la BCC récompense l&apos;activité. 20 badges
            au total, du commun au légendaire.
          </p>
        </div>
        <ScoreCard summary={summary} />
      </header>

      {/* ─── Filters ────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <FilterChip
          active={earnedFilter === "all"}
          label={`Tous (${rows.length})`}
          onClick={() => setEarnedFilter("all")}
        />
        <FilterChip
          active={earnedFilter === "earned"}
          label={`Débloqués (${summary.earned_count})`}
          onClick={() => setEarnedFilter("earned")}
        />
        <FilterChip
          active={earnedFilter === "locked"}
          label={`À débloquer (${Math.max(0, rows.length - summary.earned_count)})`}
          onClick={() => setEarnedFilter("locked")}
        />
        <span className="mx-2 hidden h-4 w-px bg-[var(--border-gold)] sm:inline-block" />
        <FilterChip
          active={rarityFilter === "all"}
          label="Toutes raretés"
          onClick={() => setRarityFilter("all")}
        />
        {RARITY_ORDER.map((rar) => (
          <FilterChip
            key={rar}
            active={rarityFilter === rar}
            label={RARITY_LABEL[rar]}
            color={RARITY_COLOR[rar]}
            onClick={() => setRarityFilter(rar)}
          />
        ))}
      </div>

      {/* ─── Grid sections ───────────────────────────────────── */}
      {grouped.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-12 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            Aucun badge ne correspond à ce filtre.
          </p>
        </div>
      ) : (
        <div className="space-y-12">
          {grouped.map((bucket) => (
            <section key={bucket.category}>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-display text-xl md:text-2xl font-semibold text-[var(--gold)]">
                  {CATEGORY_LABEL[bucket.category]}
                </h2>
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {bucket.rows.filter((r) => r.earned_at).length} / {bucket.rows.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {bucket.rows.map((row) => (
                  <AchievementCard
                    key={row.slug}
                    row={row}
                    expanded={focused === row.slug}
                    expandedRef={focused === row.slug ? focusedRowRef : null}
                    onClick={() => handleCardClick(row.slug)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ─── Community feed ─────────────────────────────────── */}
      <RecentUnlocksFeed recent={recent} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ScoreCard — sidebar widget
// ════════════════════════════════════════════════════════════════════

function ScoreCard({ summary }: { summary: UserPointsSummary }) {
  const tierColor = (() => {
    switch (summary.tier) {
      case "Bronze":   return "#C97A4B";
      case "Silver":   return "#D8D8D8";
      case "Gold":     return "#C8AA6E";
      case "Platinum": return "#E5E4E2";
      case "Diamond":  return "#B9F2FF";
    }
  })();

  return (
    <div
      className="rounded-xl border bg-[var(--bg-surface)] p-5 min-w-[14rem]"
      style={{ borderColor: `${tierColor}55` }}
      aria-label={`Mon score : ${summary.total_points} points, palier ${summary.tier}`}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Mon score
      </p>
      <p
        className="mt-1 font-display text-3xl font-bold tabular-nums"
        style={{ color: tierColor }}
      >
        {summary.total_points} pts
      </p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wider" style={{ color: tierColor }}>
        Palier {summary.tier}
      </p>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        {summary.earned_count} / {summary.total_count} badges
        {summary.points_to_next > 0
          ? ` · ${summary.points_to_next} pts au prochain palier`
          : " · Palier max atteint"}
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// AchievementCard
// ════════════════════════════════════════════════════════════════════

interface AchievementCardProps {
  row: AchievementRow;
  expanded: boolean;
  onClick: () => void;
  expandedRef: React.RefObject<HTMLDivElement | null> | null;
}

function AchievementCard({ row, expanded, onClick, expandedRef }: AchievementCardProps) {
  const earned = Boolean(row.earned_at);
  const color = RARITY_COLOR[row.rarity];
  const percent = computeProgressPercent(row.criteria, row.progress);
  const counter = describeProgress(row.criteria, row.progress);
  const earnedAt = row.earned_at ? new Date(row.earned_at) : null;

  return (
    <div
      ref={expandedRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-pressed={expanded}
      aria-label={`${row.name} — ${earned ? "débloqué" : "à débloquer"}`}
      className={`group relative cursor-pointer rounded-xl border bg-[var(--bg-surface)] p-4 transition-all duration-200 hover:scale-[1.01] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] motion-reduce:hover:scale-100 motion-reduce:transition-none ${
        earned ? "" : "opacity-70"
      }`}
      style={{
        borderColor: earned ? `${color}88` : "var(--border-subtle)",
        boxShadow: earned ? `0 0 0 1px ${color}33, 0 0 24px -16px ${color}88` : undefined,
      }}
    >
      {/* Earned checkmark */}
      {earned && (
        <span
          aria-hidden
          className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ backgroundColor: color, color: "var(--bg-primary)" }}
        >
          ✓
        </span>
      )}

      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-3xl"
          style={{
            backgroundColor: earned ? `${color}1a` : "var(--bg-elevated)",
            border: `1px solid ${earned ? `${color}55` : "var(--border-subtle)"}`,
            filter: earned ? "none" : "grayscale(80%)",
          }}
        >
          {row.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-display text-base font-semibold text-[var(--text-primary)]">
              {row.name}
            </h3>
            <RarityBadge rarity={row.rarity} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)] line-clamp-2">
            {row.description}
          </p>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {row.points} pts
          </p>
        </div>
      </div>

      {/* Progress / earned-at footer */}
      <div className="mt-4">
        {earned && earnedAt ? (
          <p className="text-[11px] text-[var(--text-secondary)]">
            Tu as débloqué le{" "}
            <span className="text-[var(--gold)]">{dateFmt.format(earnedAt)}</span>
          </p>
        ) : percent !== null && counter ? (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
              <div
                className="h-full transition-all duration-500 motion-reduce:transition-none"
                style={{
                  width: `${percent}%`,
                  backgroundColor: color,
                }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
              />
            </div>
            <p className="mt-1.5 text-[10px] tabular-nums text-[var(--text-muted)]">
              {counter.have} / {counter.need}
            </p>
          </div>
        ) : (
          <p className="text-[10px] text-[var(--text-muted)] italic">
            Action déclenchée par un événement
          </p>
        )}
      </div>

      {expanded && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-muted)]">
          <p className="font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Comment l&apos;obtenir
          </p>
          <p className="mt-1">{row.description}</p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Smaller widgets
// ════════════════════════════════════════════════════════════════════

function FilterChip({
  active,
  label,
  onClick,
  color,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  color?: string;
}) {
  const accent = color ?? "var(--gold)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        active
          ? "text-[var(--bg-primary)]"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
      style={{
        borderColor: active ? accent : "var(--border-subtle)",
        backgroundColor: active ? accent : "transparent",
      }}
    >
      {label}
    </button>
  );
}

function RarityBadge({ rarity }: { rarity: AchievementRarity }) {
  const color = RARITY_COLOR[rarity];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}15`,
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {RARITY_LABEL[rarity]}
    </span>
  );
}

function RecentUnlocksFeed({ recent }: { recent: RecentUnlockRow[] }) {
  if (recent.length === 0) return null;
  return (
    <section className="mt-16">
      <h2 className="font-display text-xl md:text-2xl font-semibold text-[var(--gold)]">
        Récemment débloqués par la BCC
      </h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Les 10 derniers badges débloqués par la communauté.
      </p>
      <ul className="mt-4 divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {recent.map((unlock, idx) => {
          const color = RARITY_COLOR[unlock.rarity];
          const earnedAt = new Date(unlock.earned_at);
          return (
            <li
              key={`${unlock.slug}-${unlock.earned_at}-${idx}`}
              className="flex items-center gap-3 px-4 py-3"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-lg text-xl"
                style={{
                  backgroundColor: `${color}1a`,
                  border: `1px solid ${color}55`,
                }}
              >
                {unlock.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--text-primary)]">
                  <span className="font-semibold">
                    {unlock.display_name ?? "Un membre BCC"}
                  </span>{" "}
                  a débloqué{" "}
                  <span style={{ color }}>{unlock.name}</span>
                </p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {RARITY_LABEL[unlock.rarity]} · {shortDateFmt.format(earnedAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
