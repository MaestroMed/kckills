"use client";

/**
 * QuotesEncyclopedia — client island that owns the /quotes page UI.
 *
 * SSR delivers the initial `topQuotes` slate (server-rendered for SEO +
 * fast first paint). The client takes over once the user types into the
 * search field — it calls a debounced server action that proxies
 * fn_search_quotes and swaps the grid contents. We deliberately avoid
 * re-running the SSR loader on every keystroke ; instead a server action
 * runs the RPC under the request scope and returns the matched rows.
 *
 * Filters :
 *   - text search (full-text via fn_search_quotes)
 *   - energy floor (1-5 stars / flames)
 *   - caster select (dropdown of known voices)
 *
 * The caster + energy filters are applied client-side over the loaded
 * slate — they don't trigger a fetch. The text search is server-side
 * because tsvector matching is expensive in JS and the index is in PG.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { QuoteCard, type QuoteCardData } from "./quotes/QuoteCard";
import { searchQuotesAction } from "@/lib/quotes-search-action";

export interface QuotesEncyclopediaInput {
  /** Top quotes pre-rendered server-side. Displayed on first paint. */
  initialTopQuotes: QuoteCardData[];
  /** "Quote of the day" — pre-picked server-side from the highest
   *  energy + recent extraction. Optional. */
  featured: QuoteCardData | null;
  /** Stats for the hero band. */
  stats: {
    total_quotes: number;
    total_kills: number;
    top_caster: string | null;
    top_caster_quotes: number;
  };
}

export function QuotesEncyclopedia({
  initialTopQuotes,
  featured,
  stats,
}: QuotesEncyclopediaInput) {
  const [query, setQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<QuoteCardData[] | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [minEnergy, setMinEnergy] = useState<number>(1);
  const [casterFilter, setCasterFilter] = useState<string>("all");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger a debounced server action when the query is non-empty.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setSearchResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const rows = await searchQuotesAction(trimmed, 60);
        setSearchResults(rows);
      });
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // The active slate is either the search results or the SSR list.
  const slate = searchResults ?? initialTopQuotes;

  // Caster dropdown options : derive from the union of slate + initial
  // so the list doesn't shrink when search results come in.
  const casterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const q of initialTopQuotes) {
      if (q.caster_name) set.add(q.caster_name);
    }
    for (const q of slate) {
      if (q.caster_name) set.add(q.caster_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [initialTopQuotes, slate]);

  const filtered = useMemo(() => {
    return slate.filter((q) => {
      if ((q.energy_level ?? 0) < minEnergy) return false;
      if (casterFilter !== "all" && q.caster_name !== casterFilter)
        return false;
      return true;
    });
  }, [slate, minEnergy, casterFilter]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-6">
      {/* ─── HERO BAND ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)] py-10 px-6 md:py-14 md:px-12 mb-10">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 80% at 50% 0%, rgba(200,170,110,0.18), transparent 70%)",
          }}
        />
        <div className="relative z-10 flex flex-col items-center text-center gap-5">
          <span className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.5em] text-[var(--gold)]">
            ▽ Encyclopedie sonore Karmine Corp
          </span>
          <h1 className="font-display text-4xl md:text-6xl font-black text-[var(--text-primary)] leading-none">
            Phrases <span className="text-[var(--gold)]">Cultes</span>
          </h1>
          <p className="max-w-2xl text-sm md:text-base text-[var(--text-secondary)]">
            Les shouts des casters · extraits automatiquement de chaque clip
            KC. L&apos;IA transcrit l&apos;audio et garde les pepites — tu
            ecoutes, tu votes, tu cites.
          </p>

          <dl className="grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-12 mt-3 text-center">
            <Stat
              label="Phrases extraites"
              value={stats.total_quotes.toLocaleString("fr-FR")}
            />
            <Stat
              label="Clips analyses"
              value={stats.total_kills.toLocaleString("fr-FR")}
            />
            <Stat
              label={stats.top_caster ?? "Top caster"}
              value={
                stats.top_caster
                  ? `${stats.top_caster_quotes} phrases`
                  : "—"
              }
              hideOnMobile={!stats.top_caster}
            />
          </dl>
        </div>
      </section>

      {/* ─── FEATURED QUOTE ─────────────────────────────────────────── */}
      {featured && (
        <section className="mb-10">
          <header className="flex items-center justify-between mb-4">
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
              ★ Phrase du jour
            </p>
          </header>
          <div className="rounded-3xl border-2 border-[var(--gold)]/30 bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-elevated)] p-6 md:p-10">
            <blockquote className="font-display text-2xl md:text-4xl text-center text-[var(--text-primary)] leading-tight">
              <span className="text-[var(--gold)] mr-2" aria-hidden>
                &laquo;
              </span>
              {featured.quote_text}
              <span className="text-[var(--gold)] ml-2" aria-hidden>
                &raquo;
              </span>
            </blockquote>
            <div className="mt-6 mx-auto max-w-md">
              <QuoteCard quote={featured} variant="inline" />
            </div>
          </div>
        </section>
      )}

      {/* ─── STICKY SEARCH BAND ─────────────────────────────────────── */}
      <div className="sticky top-2 z-30 mb-8 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-primary)]/95 backdrop-blur p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <label className="relative flex-1">
            <span className="sr-only">Rechercher une phrase</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='"absolument insane", "outplay", "pentakill"...'
              className="w-full rounded-xl border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-4 py-3 text-sm md:text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)]/70 focus-visible:ring-2 focus-visible:ring-[var(--gold)]/40"
              aria-label="Rechercher une phrase de caster"
            />
            {pending && (
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-widest text-[var(--gold)]"
                aria-live="polite"
              >
                recherche…
              </span>
            )}
          </label>

          <div className="flex items-center gap-2">
            <EnergyPicker value={minEnergy} onChange={setMinEnergy} />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
              Caster
            </label>
            <select
              value={casterFilter}
              onChange={(e) => setCasterFilter(e.target.value)}
              className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--gold)]/40 focus:outline-none"
              aria-label="Filtrer par caster"
            >
              <option value="all">Tous</option>
              {casterOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ─── GRID ───────────────────────────────────────────────────── */}
      <section>
        {filtered.length === 0 ? (
          <EmptyState query={query} hasSlate={slate.length > 0} />
        ) : (
          <div className="grid gap-4 md:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((q) => (
              <QuoteCard key={q.id} quote={q} />
            ))}
          </div>
        )}
      </section>

      {/* Footer reminder so the page never feels like a dead end */}
      <p className="mt-12 text-center text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
        Les phrases sont extraites par Gemini · vote pour la plus folle
      </p>
    </div>
  );
}

// ─── Small bits ────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  hideOnMobile,
}: {
  label: string;
  value: string;
  hideOnMobile?: boolean;
}) {
  return (
    <div className={hideOnMobile ? "hidden md:block" : undefined}>
      <dt className="font-data text-[10px] uppercase tracking-[0.25em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="font-display text-2xl md:text-3xl font-black text-[var(--gold-bright)] tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function EnergyPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] p-1"
      role="radiogroup"
      aria-label="Filtrer par energie minimum"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(n)}
            className={[
              "h-7 w-7 rounded-md text-xs font-data font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--gold)]",
              active
                ? "bg-[var(--gold)] text-[var(--bg-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--gold)]/15 hover:text-[var(--gold)]",
            ].join(" ")}
            title={`Minimum ${n} flammes`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({
  query,
  hasSlate,
}: {
  query: string;
  hasSlate: boolean;
}) {
  if (query.trim().length > 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-10 text-center">
        <p className="font-display text-lg text-[var(--text-primary)]">
          Aucune phrase ne matche &laquo; {query.trim()} &raquo;.
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Essaie un mot-cle plus court, ou retire les filtres energie / caster.
        </p>
      </div>
    );
  }
  if (!hasSlate) {
    return (
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-10 text-center">
        <p className="font-display text-lg text-[var(--text-primary)]">
          Pas encore de phrase extraite.
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Le worker tourne en continu — repasse dans quelques heures.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-10 text-center">
      <p className="font-display text-lg text-[var(--text-primary)]">
        Aucune phrase ne passe les filtres actuels.
      </p>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Baisse le filtre energie ou choisis &laquo; Tous &raquo; cote casters.
      </p>
    </div>
  );
}
