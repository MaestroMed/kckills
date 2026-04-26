/**
 * /search — Public search page (Wave 6, Agent Z, CLAUDE.md §6.5).
 *
 * Server-renders the first page of results from `searchKills()` for SEO
 * and perceived speed, then hands off to the client `SearchResults`
 * component for infinite scroll.
 *
 * The page is a thin shell : SearchBar (pre-filled), FilterChips
 * (URL-driven), and the result grid. Empty states cover both
 * "no input yet" and "no results for this combo".
 *
 * SEO :
 *   - JSON-LD `SearchResultsPage` schema for Google understanding.
 *   - Dynamic <title> reflecting the query so the SERP snippet is
 *     useful when someone bookmarks /search?q=caliste.
 *   - We DON'T `noindex` — the page is a useful entry point for tail
 *     queries. Robots can crawl and index search-with-q variants.
 */

import type { Metadata } from "next";
import { JsonLd } from "@/lib/seo/jsonld";
import { searchKills, type SearchFilters } from "@/lib/supabase/search";
import { SearchBar } from "@/components/search/SearchBar";
import { FilterChips } from "@/components/search/FilterChips";
import { SearchResults } from "./results";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://kckills.com");

// Dynamic by default — search params drive the render entirely.
// Cache headers on /api/search handle the heavy lifting.
export const dynamic = "force-dynamic";

// ─── Search params shape ──────────────────────────────────────────────

interface SearchParams {
  q?: string;
  player?: string;
  multi?: string;
  fb?: string;
  tag?: string;
  era?: string;
  match?: string;
  min_score?: string;
  min_rating?: string;
  kc_role?: string;
}

// ─── Param parser (mirrors the API route) ─────────────────────────────

const ALLOWED_MULTI = new Set(["double", "triple", "quadra", "penta"]);
const ALLOWED_KC_ROLE = new Set(["team_killer", "team_victim", "team_assist"]);

function parseFilters(sp: SearchParams): { q: string; filters: SearchFilters } {
  const q = (sp.q ?? "").trim().slice(0, 120);
  const filters: SearchFilters = {};

  if (sp.player) {
    const v = sp.player.trim().toLowerCase();
    if (v && v.length <= 32) filters.playerSlug = v;
  }
  if (sp.multi && ALLOWED_MULTI.has(sp.multi)) {
    filters.multiKill = sp.multi as SearchFilters["multiKill"];
  }
  if (sp.fb === "1" || sp.fb === "true") {
    filters.isFirstBlood = true;
  }
  if (sp.tag) {
    const v = sp.tag.trim();
    if (v && v.length <= 32) filters.tag = v;
  }
  if (sp.era) {
    const v = sp.era.trim();
    if (v && v.length <= 64) filters.eraId = v;
  }
  if (sp.match) {
    const v = sp.match.trim();
    if (v && v.length <= 64) filters.matchExternalId = v;
  }
  if (sp.min_score) {
    const n = Number(sp.min_score);
    if (Number.isFinite(n) && n >= 0 && n <= 10) filters.minScore = n;
  }
  if (sp.min_rating) {
    const n = Number(sp.min_rating);
    if (Number.isFinite(n) && n >= 0 && n <= 5) filters.minRating = n;
  }
  if (sp.kc_role && ALLOWED_KC_ROLE.has(sp.kc_role)) {
    filters.trackedTeam = sp.kc_role as SearchFilters["trackedTeam"];
  }
  return { q, filters };
}

function hasAnyFilter(filters: SearchFilters): boolean {
  return (
    !!filters.playerSlug ||
    !!filters.multiKill ||
    filters.isFirstBlood === true ||
    !!filters.tag ||
    !!filters.eraId ||
    !!filters.matchExternalId ||
    typeof filters.minScore === "number" ||
    typeof filters.minRating === "number" ||
    !!filters.trackedTeam
  );
}

// ─── Metadata ─────────────────────────────────────────────────────────

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const { q, filters } = parseFilters(sp);
  const filtered = hasAnyFilter(filters);

  let title = "Recherche";
  if (q && filtered) title = `Recherche "${q}" - filtres actifs`;
  else if (q) title = `Recherche "${q}"`;
  else if (filtered) title = "Recherche - filtres actifs";

  const description = q
    ? `Resultats pour "${q}" parmi tous les kills Karmine Corp clippes et notes par la communaute.`
    : "Recherche dans le catalogue de kills Karmine Corp - full-text + filtres avances (joueur, multi-kill, epoque, score IA).";

  return {
    title,
    description,
    alternates: { canonical: "/search" },
    robots: {
      // Index the bare /search but don't index every long-tail query
      // permutation. The bare URL is the entry point Google should send
      // users to.
      index: !q,
      follow: true,
    },
    openGraph: {
      title: `${title} - KCKILLS`,
      description,
      type: "website",
      siteName: "KCKILLS",
      locale: "fr_FR",
      url: `${SITE_URL}/search`,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} - KCKILLS`,
      description,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { q, filters } = parseFilters(sp);
  const filtered = hasAnyFilter(filters);

  // First page — server-rendered. Even if both q and filters are empty,
  // we still hit the loader so the page shows the "freshest published"
  // grid. Cheaper than re-implementing a separate "default" path.
  const page = await searchKills(q, filters, { limit: 24 });

  const ld = {
    "@context": "https://schema.org",
    "@type": "SearchResultsPage",
    name: "Recherche - KCKILLS",
    url: `${SITE_URL}/search${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    isPartOf: {
      "@type": "WebSite",
      name: "KCKILLS",
      url: SITE_URL,
    },
    inLanguage: "fr-FR",
    ...(q ? { keywords: q } : {}),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: page.rows.length,
      itemListElement: page.rows.slice(0, 10).map((kill, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        url: `${SITE_URL}/kill/${kill.id}`,
        item: {
          "@type": "VideoObject",
          name:
            kill.killer_champion && kill.victim_champion
              ? `${kill.killer_champion} elimine ${kill.victim_champion}`
              : `Clip Karmine Corp`,
          thumbnailUrl: kill.thumbnail_url ?? undefined,
          uploadDate: kill.created_at ?? undefined,
        },
      })),
    },
  };

  const isEmpty = !q && !filtered;

  return (
    <>
      <JsonLd data={ld} />

      {/* Hero — sticky search input */}
      <section className="relative -mx-4 mb-6 border-b border-[var(--border-gold)] bg-[var(--bg-surface)]/80 px-4 pb-4 pt-2 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl">
          <h1 className="mb-3 font-display text-2xl font-black tracking-wide text-[var(--gold-bright)]">
            Recherche
          </h1>
          <SearchBar initialQuery={q} autoFocus={isEmpty} />
        </div>
      </section>

      {/* Layout : sidebar (desktop) + grid (always) */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        {/* Filter chips (sticky on desktop) */}
        <div className="md:sticky md:top-4 md:self-start">
          <FilterChips />
        </div>

        {/* Results column */}
        <div className="min-w-0">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-gold)] bg-[var(--bg-surface)]/40 py-20 text-center">
              <svg
                className="h-12 w-12 text-[var(--gold)]/40"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"
                />
              </svg>
              <p className="mt-4 max-w-xs text-sm text-[var(--text-secondary)]">
                Cherche un kill ou utilise les filtres ci-dessus.
              </p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Astuce : tape <kbd className="rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px]">/</kbd> de n&apos;importe ou pour focus.
              </p>
            </div>
          ) : (
            <SearchResults initialRows={page.rows} initialCursor={page.nextCursor} />
          )}
        </div>
      </div>
    </>
  );
}
