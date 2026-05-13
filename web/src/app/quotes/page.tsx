/**
 * /quotes — AI Quote Extractor encyclopedia.
 *
 * Server shell : pulls the top 60 highest-energy quotes + the global
 * stats + a "quote of the day" featured pick. Pushes everything into
 * <QuotesEncyclopedia /> which owns the search + filter interaction.
 *
 * ISR : revalidate every 15 min. The quote_extractor daemon runs every
 * 30 min so 15 min is a comfortable upper bound that keeps the page
 * fresh without burning a regen on every visit.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { QuotesEncyclopedia } from "@/components/QuotesEncyclopedia";
import {
  getQuotesStats,
  getTopQuotes,
  type TopQuoteRow,
} from "@/lib/supabase/quotes";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";
import type { QuoteCardData } from "@/components/quotes/QuoteCard";

export const revalidate = 900;

export const metadata: Metadata = {
  title: "Phrases Cultes — KCKILLS",
  description:
    "Toutes les phrases shoutables des casters extraites des clips Karmine Corp. Ecoute, vote, cite. Encyclopedie generee par IA.",
  alternates: { canonical: "/quotes" },
  openGraph: {
    title: "Phrases Cultes — KCKILLS",
    description:
      "Les shouts des casters · extraits automatiquement de chaque clip KC. ABSOLUMENT INSANE.",
    type: "website",
    url: "/quotes",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Phrases Cultes — KCKILLS",
    description:
      "Les shouts des casters · extraits automatiquement de chaque clip KC.",
  },
};

function toCardData(row: TopQuoteRow): QuoteCardData {
  return {
    id: row.id,
    kill_id: row.kill_id,
    quote_text: row.quote_text,
    quote_start_ms: row.quote_start_ms,
    quote_end_ms: row.quote_end_ms,
    caster_name: row.caster_name,
    energy_level: row.energy_level,
    is_memetic: row.is_memetic,
    upvotes: row.upvotes,
    killer_champion: row.killer_champion,
    victim_champion: row.victim_champion,
    // The /scroll player and the audio button both prefer the vertical
    // (smaller file, same audio track). Horizontal is fallback inside
    // KillCinematicView ; we don't expose it here.
    clip_url: row.clip_url_vertical,
    multi_kill: row.multi_kill,
    is_first_blood: row.is_first_blood,
    match_date: row.match_date,
  };
}

/**
 * Stable "quote of the day" pick. Same input set every day for 24h ;
 * the rotation key is the UTC day-of-year so the page stays
 * deterministic across server instances.
 */
function pickFeatured(rows: TopQuoteRow[]): TopQuoteRow | null {
  const eligible = rows.filter(
    (r) => (r.energy_level ?? 0) >= 4 && r.quote_text.length >= 12,
  );
  const pool = eligible.length > 0 ? eligible : rows;
  if (pool.length === 0) return null;
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const diff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start;
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  return pool[day % pool.length] ?? null;
}

export default async function QuotesPage() {
  const [stats, top] = await Promise.all([
    getQuotesStats({ buildTime: true }),
    getTopQuotes(60, 1, { buildTime: true }),
  ]);

  const featuredRow = pickFeatured(top);
  const featured = featuredRow ? toCardData(featuredRow) : null;
  const initialTopQuotes = top.map(toCardData);

  // JSON-LD : a CollectionPage wrapped around the breadcrumb. Helps
  // Google understand this is a structured list of quotes vs a generic
  // article page, which has historically rewarded list-type pages with
  // sitelinks under the result.
  const breadcrumb = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Phrases Cultes", url: "/quotes" },
  ]);

  return (
    <main className="relative pt-6 pb-20 min-h-[80vh]">
      <JsonLd data={breadcrumb} />

      {/* Subtle top divider so the page reads from the same surface
          rhythm as the rest of the site. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(200,170,110,0.45), transparent)",
        }}
      />

      <QuotesEncyclopedia
        initialTopQuotes={initialTopQuotes}
        featured={featured}
        stats={stats}
      />

      {/* Riot legal disclaimer — required on every public page per
          CLAUDE.md PARTIE 7.6 */}
      <p className="mx-auto mt-16 max-w-3xl text-center text-[10px] uppercase tracking-widest text-[var(--text-disabled)] px-6">
        Les phrases sont extraites par IA depuis les commentaires officiels
        des casts. KCKILLS was created under Riot Games&apos; &laquo; Legal
        Jibber Jabber &raquo; policy using assets owned by Riot Games. Riot
        Games does not endorse or sponsor this project.{" "}
        <Link href="/privacy" className="underline hover:text-[var(--gold)]">
          Politique
        </Link>
        .
      </p>
    </main>
  );
}
