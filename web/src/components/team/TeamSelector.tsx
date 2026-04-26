"use client";

/**
 * TeamSelector — combobox / bottom-sheet for picking a pro LoL team.
 *
 * Two render paths driven by viewport width (matches the Wave 6
 * ReportButton pattern so the UI feels consistent across the app) :
 *
 *   * MOBILE  (<= 768px) — full-screen bottom sheet with search input
 *     pinned at the top, scrollable list of grouped teams below.
 *   * DESKTOP (> 768px)  — anchored popover with search-as-you-type.
 *
 * Selecting a team navigates to `/team/{slug}`. The sheet closes
 * automatically on route change.
 *
 * Data source : `/api/teams` (5-min cached). Teams are grouped by
 * league for visual scannability ("LEC" → KC, FNC, G2, …).
 *
 * Accessibility :
 *   - role="combobox" + aria-expanded on the trigger
 *   - role="listbox" + role="option" inside the dropdown
 *   - focus-visible ring everywhere
 *   - Esc closes ; arrow keys cycle results
 *   - Body scroll locked while the mobile sheet is open
 *   - `prefers-reduced-motion` disables the spring
 *
 * NB : This is a CLIENT component — it owns its own fetch. Do NOT pass
 * the team list as a prop from a server parent ; the component is
 * shared across multiple mount points and the SSR-prefetch dance is
 * not worth it (5 min cache means at most 1 fetch per session anyway).
 */

import { useState, useEffect, useRef, useMemo, useCallback, useId } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

interface WireTeam {
  slug: string;
  code: string;
  name: string;
  region: string | null;
  league: string | null;
  logo_url: string | null;
}

interface TeamsApiResponse {
  teams: WireTeam[];
  count: number;
  mode: "kc_pilot" | "loltok";
}

export interface TeamSelectorProps {
  /** Optional className on the trigger button. */
  className?: string;
  /** Visual variant. "chip" matches the LeagueNav strip ; "button"
   *  is a standalone CTA used by /league/[slug]. */
  variant?: "chip" | "button";
  /** Override the trigger label (defaults to "Équipes"). */
  triggerLabel?: string;
  /** When provided, only teams in this league slug are shown — useful
   *  for the "More teams in LEC" link on the LEC chip. */
  filterLeague?: string;
}

// Drag thresholds — copied from ReportButton for consistency.
const DISMISS_THRESHOLD = 90;
const DISMISS_VELOCITY = 600;

export function TeamSelector({
  className,
  variant = "chip",
  triggerLabel = "Équipes",
  filterLeague,
}: TeamSelectorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<WireTeam[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  // ─── Viewport + a11y media queries ──────────────────────────────────
  useEffect(() => {
    const mqlMobile = window.matchMedia("(max-width: 768px)");
    const mqlMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setIsMobile(mqlMobile.matches);
      setReducedMotion(mqlMotion.matches);
    };
    sync();
    mqlMobile.addEventListener("change", sync);
    mqlMotion.addEventListener("change", sync);
    return () => {
      mqlMobile.removeEventListener("change", sync);
      mqlMotion.removeEventListener("change", sync);
    };
  }, []);

  // ─── Lazy fetch the team list on first open ─────────────────────────
  useEffect(() => {
    if (!open || teams !== null || loading) return;
    setLoading(true);
    fetch("/api/teams", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data: TeamsApiResponse) => {
        setTeams(Array.isArray(data?.teams) ? data.teams : []);
      })
      .catch((err) => {
        console.warn("[TeamSelector] /api/teams fetch failed:", err);
        setTeams([]);
      })
      .finally(() => setLoading(false));
  }, [open, teams, loading]);

  // ─── Body scroll lock + ESC handling on mobile sheet ────────────────
  useEffect(() => {
    if (!open) return;
    if (isMobile) {
      document.body.style.overflow = "hidden";
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Auto-focus the search input on next tick so the spring animation
    // has started painting first.
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => {
      if (isMobile) document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, isMobile]);

  // ─── Click-outside on desktop dropdown ──────────────────────────────
  useEffect(() => {
    if (!open || isMobile) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, isMobile]);

  // ─── Filter + group ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!teams) return [] as WireTeam[];
    const q = query.trim().toLowerCase();
    return teams
      .filter((t) => (filterLeague ? t.league === filterLeague : true))
      .filter((t) => {
        if (!q) return true;
        return (
          t.code.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          (t.region ?? "").toLowerCase().includes(q) ||
          (t.league ?? "").toLowerCase().includes(q)
        );
      });
  }, [teams, query, filterLeague]);

  // Group by league for the panel layout (only when no search query —
  // a search collapses the groups into one flat ranked list).
  const grouped = useMemo(() => {
    if (query.trim()) return null;
    const map = new Map<string, WireTeam[]>();
    for (const t of filtered) {
      const key = t.league ?? "other";
      const bucket = map.get(key) ?? [];
      bucket.push(t);
      map.set(key, bucket);
    }
    // Stable league order : LEC first, then alphabetical, "other" last.
    const order = ["lec", "lcs", "lck", "lpl", "lfl"];
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      if (a === "other") return 1;
      if (b === "other") return -1;
      return a.localeCompare(b);
    });
  }, [filtered, query]);

  // Keep activeIndex in range when the filtered list shrinks.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  const navigateToTeam = useCallback(
    (slug: string) => {
      setOpen(false);
      router.push(`/team/${slug}`);
    },
    [router],
  );

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const t = filtered[activeIndex];
        if (t) navigateToTeam(t.slug);
      }
    },
    [filtered, activeIndex, navigateToTeam],
  );

  const triggerClass =
    variant === "chip"
      ? `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors snap-start whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] ${className ?? ""}`
      : `inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-[var(--bg-elevated)] border border-[var(--border-gold)] text-[var(--text-primary)] hover:border-[var(--gold)]/50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] ${className ?? ""}`;

  const trigger = (
    <button
      type="button"
      role="combobox"
      aria-haspopup={isMobile ? "dialog" : "listbox"}
      aria-expanded={open}
      aria-controls={headingId}
      onClick={() => setOpen((v) => !v)}
      className={triggerClass}
    >
      {triggerLabel}
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {trigger}

      {/* ─── DESKTOP DROPDOWN ─────────────────────────────────────── */}
      {!isMobile && open && (
        <div
          id={headingId}
          role="dialog"
          aria-label="Sélectionner une équipe"
          className="absolute right-0 top-full mt-2 z-[400] w-[340px] max-h-[70vh] flex flex-col rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] shadow-[0_18px_48px_rgba(0,0,0,0.65)] overflow-hidden"
        >
          <div className="p-3 border-b border-white/5">
            <input
              ref={inputRef}
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKeyDown}
              placeholder="Rechercher une équipe…"
              aria-label="Rechercher une équipe"
              className="w-full rounded-lg bg-[var(--bg-elevated)] border border-white/5 px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--gold)]/40"
            />
          </div>
          <ListBody
            loading={loading}
            grouped={grouped}
            filtered={filtered}
            activeIndex={activeIndex}
            onSelect={navigateToTeam}
            onMouseEnter={(i) => setActiveIndex(i)}
          />
        </div>
      )}

      {/* ─── MOBILE BOTTOM SHEET ────────────────────────────────── */}
      <AnimatePresence>
        {isMobile && open && (
          <motion.div
            className="fixed inset-0 z-[400]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
              onClick={() => setOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={headingId}
              className="absolute bottom-0 left-0 right-0 flex flex-col rounded-t-3xl bg-[var(--bg-surface)] border-t border-[var(--gold)]/25 shadow-[0_-30px_80px_rgba(0,0,0,0.75)] max-h-[85vh]"
              initial={reducedMotion ? { opacity: 0 } : { y: "100%" }}
              animate={reducedMotion ? { opacity: 1 } : { y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { y: "100%" }}
              transition={
                reducedMotion
                  ? { duration: 0.18 }
                  : { type: "spring", stiffness: 320, damping: 32 }
              }
              drag={reducedMotion ? false : "y"}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (
                  info.offset.y > DISMISS_THRESHOLD ||
                  info.velocity.y > DISMISS_VELOCITY
                ) {
                  setOpen(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
                <div className="h-1.5 w-11 rounded-full bg-white/25" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3 border-b border-white/5">
                <h3 id={headingId} className="font-display text-lg font-bold text-white leading-none">
                  Équipes
                </h3>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Fermer"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 hover:bg-white/15 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                >
                  <svg className="h-4 w-4 text-white/75" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-3 pt-3 pb-2">
                <input
                  ref={inputRef}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onListKeyDown}
                  placeholder="Rechercher une équipe…"
                  aria-label="Rechercher une équipe"
                  className="w-full rounded-lg bg-[var(--bg-elevated)] border border-white/5 px-3 py-3 text-base text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--gold)]/40"
                />
              </div>
              <ListBody
                loading={loading}
                grouped={grouped}
                filtered={filtered}
                activeIndex={activeIndex}
                onSelect={navigateToTeam}
                onMouseEnter={(i) => setActiveIndex(i)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── List body — shared between desktop dropdown and mobile sheet ────

interface ListBodyProps {
  loading: boolean;
  grouped: [string, WireTeam[]][] | null;
  filtered: WireTeam[];
  activeIndex: number;
  onSelect: (slug: string) => void;
  onMouseEnter: (index: number) => void;
}

function ListBody({ loading, grouped, filtered, activeIndex, onSelect, onMouseEnter }: ListBodyProps) {
  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-6">
        <p className="text-center text-sm text-[var(--text-muted)]">Chargement…</p>
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-6">
        <p className="text-center text-sm text-[var(--text-muted)]">Aucune équipe trouvée.</p>
      </div>
    );
  }

  // Build a flat indexed list so keyboard navigation maps cleanly even
  // when grouped headings interleave items.
  let cursor = 0;

  return (
    <div role="listbox" aria-label="Liste des équipes" className="flex-1 overflow-y-auto px-2 py-2">
      {grouped ? (
        grouped.map(([leagueSlug, items]) => (
          <div key={leagueSlug} className="mb-2">
            <p className="px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-widest text-[var(--gold)]/70">
              {prettyLeague(leagueSlug)}
            </p>
            {items.map((t) => {
              const i = cursor++;
              return (
                <TeamRowButton
                  key={t.slug}
                  team={t}
                  active={i === activeIndex}
                  onSelect={onSelect}
                  onMouseEnter={() => onMouseEnter(i)}
                />
              );
            })}
          </div>
        ))
      ) : (
        filtered.map((t, i) => (
          <TeamRowButton
            key={t.slug}
            team={t}
            active={i === activeIndex}
            onSelect={onSelect}
            onMouseEnter={() => onMouseEnter(i)}
          />
        ))
      )}
    </div>
  );
}

interface TeamRowButtonProps {
  team: WireTeam;
  active: boolean;
  onSelect: (slug: string) => void;
  onMouseEnter: () => void;
}

function TeamRowButton({ team, active, onSelect, onMouseEnter }: TeamRowButtonProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => onSelect(team.slug)}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center gap-3 min-h-[48px] rounded-lg px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
        active
          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
      }`}
    >
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="h-7 w-7 object-contain flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/8 text-[10px] font-bold text-[var(--gold)] flex-shrink-0">
          {team.code.slice(0, 3)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{team.name}</p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {team.code}
          {team.region ? ` · ${team.region}` : ""}
        </p>
      </div>
    </button>
  );
}

// ─── League slug → pretty label ───────────────────────────────────────

const LEAGUE_LABELS: Record<string, string> = {
  lec: "LEC — EMEA",
  lcs: "LCS — Americas",
  lck: "LCK — Korea",
  lpl: "LPL — China",
  lfl: "LFL — France",
  emea_masters: "EMEA Masters",
  worlds: "Worlds",
  msi: "MSI",
  first_stand: "First Stand",
  other: "Autres ligues",
};

function prettyLeague(slug: string): string {
  return LEAGUE_LABELS[slug] ?? slug.toUpperCase();
}
