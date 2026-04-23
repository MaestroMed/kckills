/**
 * JSON-LD structured-data helpers + <JsonLd> renderer.
 *
 * We emit schema.org payloads inline as <script type="application/ld+json">
 * tags so Google can build rich snippets without running JS. Each helper
 * returns a plain object; <JsonLd> JSON-stringifies and renders it.
 *
 * Single-file on purpose : Windows filesystems are case-insensitive, so
 * having both `jsonld.ts` and `JsonLd.tsx` in one folder makes the TS
 * compiler choke ("File name differs from already included file name
 * only in casing"). Keeping helpers + component together sidesteps it.
 *
 * Why not next-seo or schema-dts ?
 *   - next-seo bundles unrelated <Head> bloat and we already use the new
 *     `metadata` API for OG / Twitter cards.
 *   - schema-dts is just typings; we type the payloads inline, it's fine.
 *
 * Safety : the helpers only ever take server-controlled data (DB rows,
 * route params). Don't pass unescaped user input — JSON.stringify is
 * XSS-safe for plain JSON, and we defensively escape "</script>" inside
 * the component before emitting.
 */

const SITE_NAME = "KCKILLS";
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://kckills.com");

const SITE_NODE = {
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
} as const;

const KC_NODE = {
  "@type": "SportsTeam",
  name: "Karmine Corp",
  sport: "Esports",
  alternateName: ["KC", "KCorp"],
  url: "https://karminecorp.fr",
} as const;

interface ClipLite {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  highlight_score: number | null;
  created_at: string | null;
  thumbnail_url: string | null;
}

// ─── Renderer component ───────────────────────────────────────────────

/** Server-renders a JSON-LD <script> tag. Pass a helper's output. */
export function JsonLd({ data }: { data: unknown }) {
  // Escape "</script>" defensively. JSON.stringify won't emit that
  // sequence for data values, but escape-on-output is the standard
  // hardening so the pattern is safe by construction if the payload
  // ever gains user-controlled strings later.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

// ─── Payload builders ─────────────────────────────────────────────────

/** /clips — CollectionPage with a sample of items as ItemList. */
export function clipsCollectionLD(opts: {
  totalCount: number;
  sample: ClipLite[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Tous les clips KC — KCKILLS",
    description:
      "Catalogue complet des clips Karmine Corp en LEC. Filtrable, classable par score IA.",
    url: `${SITE_URL}/clips`,
    isPartOf: SITE_NODE,
    about: KC_NODE,
    inLanguage: "fr-FR",
    mainEntity: {
      "@type": "ItemList",
      name: "Clips Karmine Corp",
      numberOfItems: opts.totalCount,
      itemListElement: opts.sample.slice(0, 20).map((k, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}/kill/${k.id}`,
        item: {
          "@type": "VideoObject",
          name:
            k.killer_champion && k.victim_champion
              ? `${k.killer_champion} élimine ${k.victim_champion} — Karmine Corp`
              : "Clip Karmine Corp",
          thumbnailUrl: k.thumbnail_url ?? undefined,
          uploadDate: k.created_at ?? undefined,
        },
      })),
    },
  };
}

/** /week — CollectionPage scoped to the current 7-day window. */
export function weekCollectionLD(opts: {
  count: number;
  weekStartISO: string;
  weekEndISO: string;
  sample: ClipLite[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Cette semaine — KCKILLS",
    description: `Top des clips Karmine Corp publiés entre ${opts.weekStartISO.slice(
      0,
      10,
    )} et ${opts.weekEndISO.slice(0, 10)}.`,
    url: `${SITE_URL}/week`,
    isPartOf: SITE_NODE,
    about: KC_NODE,
    inLanguage: "fr-FR",
    temporalCoverage: `${opts.weekStartISO}/${opts.weekEndISO}`,
    mainEntity: {
      "@type": "ItemList",
      name: "Clips KC de la semaine",
      numberOfItems: opts.count,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: opts.sample.slice(0, 10).map((k, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}/kill/${k.id}`,
        item: {
          "@type": "VideoObject",
          name:
            k.killer_champion && k.victim_champion
              ? `${k.killer_champion} élimine ${k.victim_champion}`
              : `Clip KC #${i + 1}`,
          thumbnailUrl: k.thumbnail_url ?? undefined,
          uploadDate: k.created_at ?? undefined,
        },
      })),
    },
  };
}

/** /records — CollectionPage of curated category lists. */
export function recordsCollectionLD(opts: {
  categories: { name: string; href: string; count: number }[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Records Absolus — KCKILLS",
    description:
      "Hall of fame des plus gros moments Karmine Corp en LEC : pentakills, outplays, teamfights, clutch.",
    url: `${SITE_URL}/records`,
    isPartOf: SITE_NODE,
    about: KC_NODE,
    inLanguage: "fr-FR",
    hasPart: opts.categories.map((c) => ({
      "@type": "ItemList",
      name: c.name,
      url: `${SITE_URL}${c.href}`,
      numberOfItems: c.count,
    })),
  };
}

/** Reusable BreadcrumbList builder. Pass an ordered set of {name, url}. */
export function breadcrumbLD(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url.startsWith("http") ? it.url : `${SITE_URL}${it.url}`,
    })),
  };
}
