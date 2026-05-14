"use client";

/**
 * SearchResults — client-side infinite-scroll grid for /search.
 *
 * Server renders the first page (SEO + perceived speed). This component
 * takes those rows as `initialRows` + `initialCursor` and stitches in
 * follow-up pages from /api/search as the user scrolls.
 *
 * State :
 *   - URL params change → reset to page 1 (re-fetch from /api/search).
 *     We wait for the parent server-rendered first page to land, then
 *     subscribe to subsequent param changes here.
 *   - Click "Charger plus" / scroll into the sentinel → fetch next page.
 *
 * Non-React-Query implementation per Wave 4 Agent Q discovery.
 *
 * Wave 31a — empty state now lists active filters as removable chips so
 * users can iteratively widen their search without retyping the URL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import type { PublishedKillRow } from "@/lib/supabase/kills";
import { championIconUrl } from "@/lib/constants";
import { ERAS } from "@/lib/eras";

interface Props {
  initialRows: PublishedKillRow[];
  initialCursor: string | null;
}

interface SearchResponse {
  rows: PublishedKillRow[];
  nextCursor: string | null;
  total: number;
}

// Build the absolute /api/search URL from a URLSearchParams shape.
function buildApiUrl(sp: URLSearchParams, cursor: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of sp.entries()) {
    if (k === "cursor") continue;
    params.set(k, v);
  }
  if (cursor) params.set("cursor", cursor);
  // Default page size matches the server-rendered first page (24).
  if (!params.has("limit")) params.set("limit", "24");
  const qs = params.toString();
  return qs ? `/api/search?${qs}` : "/api/search";
}

export function SearchResults({ initialRows, initialCursor }: Props) {
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<PublishedKillRow[]>(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(initialCursor === null);

  // Snapshot the "params at mount" so we can detect later changes.
  // Update on every searchParams change → reset + refetch page 1.
  const paramsKey = useMemo(() => {
    const keys = ["q", "player", "multi", "fb", "tag", "era", "match", "min_score", "min_rating", "kc_role"];
    return keys
      .map((k) => `${k}=${searchParams.get(k) ?? ""}`)
      .join("&");
  }, [searchParams]);

  // Track the FIRST mount key so we don't re-fetch the page that the
  // server just rendered. Subsequent changes refetch.
  const firstKeyRef = useRef<string>(paramsKey);
  const lastFetchedKeyRef = useRef<string>(paramsKey);

  /**
   * Re-fetch the first page when the URL filter set changes. Skip the
   * very first mount (server already rendered that exact result set).
   */
  useEffect(() => {
    if (paramsKey === lastFetchedKeyRef.current) return;
    lastFetchedKeyRef.current = paramsKey;
    if (paramsKey === firstKeyRef.current) return; // server-rendered

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const url = buildApiUrl(new URLSearchParams(searchParams.toString()), null);
        const res = await fetch(url);
        if (!res.ok) {
          if (!cancelled) {
            setError("Erreur de recherche. Reessaie dans un instant.");
            setLoading(false);
          }
          return;
        }
        const data = (await res.json()) as SearchResponse;
        if (cancelled) return;
        setRows(data.rows);
        setCursor(data.nextCursor);
        setExhausted(data.nextCursor === null);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Erreur reseau. Reessaie dans un instant.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramsKey, searchParams]);

  // Manual + sentinel-driven "load more"
  const loadMore = useCallback(async () => {
    if (loading || exhausted || !cursor) return;
    setLoading(true);
    setError(null);
    try {
      const url = buildApiUrl(new URLSearchParams(searchParams.toString()), cursor);
      const res = await fetch(url);
      if (!res.ok) {
        setError("Impossible de charger la suite.");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as SearchResponse;
      setRows((prev) => {
        // De-dupe by id — if the cursor boundary returned a row already
        // in `prev` we don't want to double-render it.
        const seen = new Set(prev.map((r) => r.id));
        const fresh = data.rows.filter((r) => !seen.has(r.id));
        return [...prev, ...fresh];
      });
      setCursor(data.nextCursor);
      setExhausted(data.nextCursor === null);
      setLoading(false);
    } catch {
      setError("Erreur reseau. Reessaie.");
      setLoading(false);
    }
  }, [cursor, exhausted, loading, searchParams]);

  // IntersectionObserver-driven auto-load. The sentinel sits below
  // the last row. When it scrolls into view, we fire loadMore.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (exhausted) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadMore();
          }
        }
      },
      { rootMargin: "400px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [exhausted, loadMore]);

  if (rows.length === 0 && !loading) {
    return <EmptyResults searchParams={searchParams} />;
  }

  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {rows.map((kill) => (
          <li key={kill.id}>
            <SearchResultCard kill={kill} />
          </li>
        ))}
      </ul>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 p-3 text-center text-sm text-[var(--red)]"
        >
          {error}
        </p>
      )}

      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      {!exhausted && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)] disabled:opacity-40"
          >
            {loading ? "Chargement..." : "Charger plus"}
          </button>
        </div>
      )}

      {exhausted && rows.length > 0 && (
        <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
          Fin des resultats - {rows.length} kill{rows.length > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

// ─── Card sub-component ───────────────────────────────────────────────

function SearchResultCard({ kill }: { kill: PublishedKillRow }) {
  const killerChamp = kill.killer_champion ?? "?";
  const victimChamp = kill.victim_champion ?? "?";
  const score = kill.highlight_score;
  const description =
    kill.ai_description_fr ?? kill.ai_description ?? `${killerChamp} sur ${victimChamp}`;

  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group block overflow-hidden rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
    >
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-[var(--bg-elevated)]">
        {kill.thumbnail_url ? (
          <Image
            src={kill.thumbnail_url}
            alt={`${killerChamp} elimine ${victimChamp}`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            loading="lazy"
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]">
            Pas d&apos;apercu
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2">
          <div className="flex items-center gap-1.5">
            <Image
              src={championIconUrl(killerChamp)}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 rounded border border-[var(--gold)]/40"
            />
            <svg className="h-3 w-3 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            <Image
              src={championIconUrl(victimChamp)}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 rounded border border-[var(--border-gold)]"
            />
          </div>
        </div>

        {/* Score badge top-right */}
        {typeof score === "number" && (
          <div className="absolute top-1.5 right-1.5 rounded-md bg-[var(--gold)]/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--bg-primary)]">
            {score.toFixed(1)}
          </div>
        )}

        {/* Multi-kill badge */}
        {kill.multi_kill && (
          <div className="absolute top-1.5 left-1.5 rounded-md bg-[var(--red)]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
            {kill.multi_kill}
          </div>
        )}

        {kill.is_first_blood && !kill.multi_kill && (
          <div className="absolute top-1.5 left-1.5 rounded-md bg-[var(--red)]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
            FB
          </div>
        )}
      </div>

      <div className="p-2">
        <p className="line-clamp-2 text-[11px] text-[var(--text-secondary)]">{description}</p>
      </div>
    </Link>
  );
}

// ─── Smart empty state (Wave 31a) ─────────────────────────────────────
//
// Lists every active filter as a removable chip so the user can iterate
// without going back to the URL bar. Falls back to a generic suggestion
// when no filters are active (the search query itself is too narrow).

interface ActiveFilter {
  key: string;
  label: string;
}

const FILTER_LABELS: Record<string, (value: string) => string> = {
  multi: (v) => `Multi-kill : ${v}`,
  fb: () => "First Blood",
  tag: (v) => `Tag : ${v}`,
  era: (v) => `Époque : ${labelForEraId(v)}`,
  player: (v) => `Joueur : ${capitalizeWord(v)}`,
  kc_role: (v) =>
    v === "team_killer"
      ? "KC kill"
      : v === "team_victim"
        ? "KC death"
        : `KC : ${v}`,
  min_score: (v) => `Score IA ≥ ${v}`,
  min_rating: (v) => `Note ≥ ${v}★`,
  match: (v) => `Match : ${v}`,
};

function labelForEraId(id: string): string {
  const era = ERAS.find((e) => e.id === id);
  return era ? era.label : id;
}

function capitalizeWord(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function EmptyResults({ searchParams }: { searchParams: URLSearchParams }) {
  const router = useRouter();

  // Collect active filters in the order users typically apply them.
  const active: ActiveFilter[] = [];
  const filterKeys = [
    "multi",
    "fb",
    "tag",
    "era",
    "player",
    "kc_role",
    "min_score",
    "min_rating",
    "match",
  ];
  for (const key of filterKeys) {
    const raw = searchParams.get(key);
    if (!raw || raw === "0") continue;
    if (key === "fb" && raw !== "1" && raw !== "true") continue;
    const labeller = FILTER_LABELS[key];
    if (!labeller) continue;
    active.push({ key, label: labeller(raw) });
  }

  const q = searchParams.get("q") ?? "";

  const removeFilter = (key: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(key);
    next.delete("cursor");
    const qs = next.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  };

  const clearAll = () => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    const qs = next.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  };

  const clearQuery = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("q");
    next.delete("cursor");
    const qs = next.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <svg
        className="h-12 w-12 text-[var(--text-muted)]/40"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>

      <p className="mt-4 max-w-md text-sm text-[var(--text-secondary)]">
        {active.length > 0 || q
          ? "Aucun kill ne matche cette combinaison."
          : "Tape un nom de champion, un tag ou un joueur pour commencer."}
      </p>

      {(active.length > 0 || q) && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Essaie de retirer un filtre pour élargir la recherche.
        </p>
      )}

      {/* Active filter chips — clickable to remove */}
      {(active.length > 0 || q) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {q && (
            <button
              type="button"
              onClick={clearQuery}
              aria-label={`Retirer la recherche "${q}"`}
              className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--red)]/40 hover:text-[var(--red)]"
            >
              <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--red)]/70">
                Mot-clé
              </span>
              <span className="text-[var(--text-primary)] group-hover:text-[var(--red)]">
                {q}
              </span>
              <span aria-hidden className="text-sm leading-none">
                ×
              </span>
            </button>
          )}

          {active.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => removeFilter(f.key)}
              aria-label={`Retirer le filtre ${f.label}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-1.5 text-xs text-[var(--gold)] transition-colors hover:border-[var(--red)]/40 hover:bg-[var(--red)]/10 hover:text-[var(--red)]"
            >
              <span>{f.label}</span>
              <span aria-hidden className="text-sm leading-none">
                ×
              </span>
            </button>
          ))}

          {(active.length + (q ? 1 : 0)) > 1 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-1.5 text-xs text-[var(--red)] transition-colors hover:bg-[var(--red)]/15"
            >
              Tout retirer
            </button>
          )}
        </div>
      )}

      {/* Discovery shortcuts when there's nothing to suggest removing */}
      {active.length === 0 && !q && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/scroll"
            className="rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-2 text-xs text-[var(--gold)] hover:bg-[var(--gold)]/20"
          >
            Découvrir dans le scroll
          </Link>
          <Link
            href="/top"
            className="rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
          >
            Top kills
          </Link>
          <Link
            href="/face-off"
            className="rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
          >
            Face-off
          </Link>
        </div>
      )}
    </div>
  );
}
