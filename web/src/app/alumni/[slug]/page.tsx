/**
 * /alumni/[slug] — Narrative bio page for a legendary ex-KC player.
 *
 * Unlike /player/[slug] (data-driven from kc_matches.json), this page
 * leans on hand-written content in lib/alumni.ts : the legend, the
 * career path, the signature moments. No live stats.
 *
 * 8 sections in order :
 *   1. HERO with LegendSeal + Roman-numeral period
 *   2. STATS STRIP
 *   3. L'HISTOIRE (with drop-cap)
 *   4. CITATION TESTAMENTAIRE
 *   5. MOMENTS SIGNATURES
 *   6. CARRIÈRE TIMELINE
 *   7. ÉPOQUES TRAVERSÉES (HonorsAndEras)
 *   8. POUR ALLER PLUS LOIN (links + prev/next)
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAlumniBySlug, getAllAlumniSlugs, ALUMNI } from "@/lib/alumni";
import { getEraById } from "@/lib/eras";
import { championSplashUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { AntreTrigger } from "@/components/AntreTrigger";

import { AlumniHero } from "@/components/player/AlumniHero";
import { SignatureQuote } from "@/components/player/SignatureQuote";
import { SignatureMoments } from "@/components/player/SignatureMoments";
import { CareerTimeline } from "@/components/player/CareerTimeline";
import { HonorsAndEras } from "@/components/player/HonorsAndEras";
import { PrevNextNavCard } from "@/components/player/PrevNextNavCard";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllAlumniSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const alumni = getAlumniBySlug(slug);
  if (!alumni) return { title: "Alumni — KCKILLS" };

  const title = `${alumni.name} — ${alumni.period}`;
  const description = `${alumni.subtitle}. ${alumni.bio.slice(0, 140)}...`;
  const canonicalPath = `/alumni/${alumni.slug}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: `${title} — KCKILLS`,
      description,
      type: "profile",
      url: canonicalPath,
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — KCKILLS`,
      description,
    },
  };
}

const ROLE_LABEL: Record<string, string> = {
  top: "TOP LANE",
  jungle: "JUNGLE",
  mid: "MID LANE",
  adc: "BOT LANE",
  support: "SUPPORT",
};

export default async function AlumniDetailPage({ params }: Props) {
  const { slug } = await params;
  const alumni = getAlumniBySlug(slug);
  if (!alumni) notFound();

  const eras = alumni.eras
    .map((id) => getEraById(id))
    .filter((e): e is NonNullable<ReturnType<typeof getEraById>> => e !== undefined);
  const paragraphs = alumni.bio.split(/\n\n+/);
  const accent = alumni.accentColor;
  const splash = championSplashUrl(alumni.signatureChampion);
  const photo = PLAYER_PHOTOS[alumni.name];

  // Siblings
  const idx = ALUMNI.findIndex((a) => a.slug === alumni.slug);
  const prev = idx > 0 ? ALUMNI[idx - 1] : null;
  const next = idx < ALUMNI.length - 1 ? ALUMNI[idx + 1] : null;

  // ─── JSON-LD ──────────────────────────────────────────────────────
  const alumniJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: alumni.name,
    alternateName: alumni.realName ?? undefined,
    nationality: alumni.nationality,
    description: `${alumni.subtitle}. ${alumni.bio.slice(0, 200).replace(/\s+/g, " ").trim()}…`,
    url: `https://kckills.com/alumni/${alumni.slug}`,
    image: splash,
    jobTitle: ROLE_LABEL[alumni.role] ?? "Pro Player",
    alumniOf: {
      "@type": "SportsTeam",
      name: "Karmine Corp",
      url: "https://kckills.com",
      sport: "League of Legends",
    },
    knowsAbout: [alumni.signatureChampion],
  };

  // First era used to anchor the deep-link "voir dans la timeline" CTA.
  const anchorEraId = eras[0]?.id ?? "";

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
      {alumni.slug === "bo" && <AntreTrigger />}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(alumniJsonLd) }}
      />

      {/* ═══ 1. HERO ═══════════════════════════════════════════════════ */}
      <AlumniHero
        name={alumni.name}
        realName={alumni.realName}
        role={alumni.role}
        nationality={alumni.nationality}
        period={alumni.period}
        tag={alumni.tag}
        signatureChampion={alumni.signatureChampion}
        accent={accent}
        photoUrl={photo}
      />

      {/* ═══ 2. STATS STRIP ════════════════════════════════════════════ */}
      <section className="mx-auto max-w-5xl px-6 -mt-16 relative z-20">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {alumni.stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border bg-[var(--bg-surface)]/95 backdrop-blur-md p-5"
              style={{ borderColor: `${accent}30` }}
            >
              <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {stat.label}
              </p>
              <p className="mt-2 font-display text-3xl font-black" style={{ color: accent }}>
                {stat.value}
              </p>
              {stat.hint && (
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">{stat.hint}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 3. L'HISTOIRE — with drop-cap ═════════════════════════════ */}
      <section className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <div className="flex items-center gap-3 mb-8">
          <span className="h-px w-12" style={{ backgroundColor: accent }} />
          <span
            className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
            style={{ color: accent }}
          >
            L&rsquo;histoire
          </span>
          <span style={{ color: accent, opacity: 0.4 }} aria-hidden className="text-xs">
            ◆
          </span>
        </div>
        <p className="font-display italic text-2xl md:text-3xl font-bold leading-relaxed text-[var(--text-primary)] mb-10">
          {alumni.subtitle}
        </p>
        <div className="space-y-6 text-lg md:text-xl leading-relaxed text-[var(--text-secondary)]">
          {paragraphs.map((para, i) => {
            const isFirst = i === 0;
            if (!isFirst) {
              return <p key={i} dangerouslySetInnerHTML={{ __html: para }} />;
            }
            // Drop-cap : first char of first paragraph rendered as a giant
            // Cinzel-style serif glyph in the era accent color.
            const trimmed = para.trimStart();
            const first = trimmed.charAt(0);
            const rest = trimmed.slice(1);
            return (
              <p key={i} className="alumni-dropcap">
                <span
                  className="float-left font-display font-black mr-3 leading-[0.8] -mt-1"
                  style={{
                    color: accent,
                    fontSize: "5rem",
                    textShadow: `0 4px 16px ${accent}40`,
                    lineHeight: 0.8,
                  }}
                  aria-hidden
                >
                  {first}
                </span>
                <span dangerouslySetInnerHTML={{ __html: rest }} />
              </p>
            );
          })}
        </div>
      </section>

      {/* ═══ 4. CITATION TESTAMENTAIRE ═════════════════════════════════ */}
      {alumni.testamentaryQuote && (
        <section
          className="relative mx-auto max-w-5xl px-6"
          aria-labelledby="alumni-testamentary-quote"
        >
          <h2 id="alumni-testamentary-quote" className="sr-only">
            Citation testamentaire
          </h2>
          <div
            className="relative rounded-3xl bg-[var(--bg-elevated)] border-t-2 overflow-hidden"
            style={{ borderTopColor: accent }}
          >
            {/* Subtle splash backdrop */}
            <div
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: `url(${splash})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(8px)",
              }}
              aria-hidden
            />
            <div className="relative z-10">
              <SignatureQuote
                text={alumni.testamentaryQuote.text}
                author={alumni.testamentaryQuote.author}
                role={alumni.testamentaryQuote.role}
                source={alumni.testamentaryQuote.source}
                accent={accent}
              />
            </div>
          </div>
        </section>
      )}

      {/* ═══ 5. MOMENTS SIGNATURES ════════════════════════════════════ */}
      {alumni.signatureMoments && alumni.signatureMoments.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
          <div className="flex items-center gap-3 mb-8">
            <span className="h-px w-12" style={{ backgroundColor: accent }} />
            <span
              className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
              style={{ color: accent }}
            >
              Moments signatures
            </span>
            <span style={{ color: accent, opacity: 0.4 }} aria-hidden className="text-xs">
              ◆
            </span>
          </div>
          <SignatureMoments moments={alumni.signatureMoments} accent={accent} />
        </section>
      )}

      {/* ═══ 6. CARRIÈRE TIMELINE ════════════════════════════════════ */}
      {alumni.careerPath && alumni.careerPath.length > 0 && (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div className="flex items-center gap-3 mb-8">
            <span className="h-px w-12" style={{ backgroundColor: accent }} />
            <span
              className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
              style={{ color: accent }}
            >
              Carrière
            </span>
            <span style={{ color: accent, opacity: 0.4 }} aria-hidden className="text-xs">
              ◆
            </span>
          </div>
          <CareerTimeline career={alumni.careerPath} accent={accent} />
        </section>
      )}

      {/* ═══ 7. ÉPOQUES TRAVERSÉES ════════════════════════════════════ */}
      {eras.length > 0 && (
        <section className="mx-auto max-w-5xl px-6 py-16">
          <div className="flex items-center gap-3 mb-8">
            <span className="h-px w-12" style={{ backgroundColor: accent }} />
            <span
              className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
              style={{ color: accent }}
            >
              Époques traversées
            </span>
            <span style={{ color: accent, opacity: 0.4 }} aria-hidden className="text-xs">
              ◆
            </span>
          </div>
          <HonorsAndEras eras={eras} accent={accent} />
        </section>
      )}

      {/* ═══ 8. POUR ALLER PLUS LOIN ════════════════════════════════ */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex items-center gap-3 mb-8">
          <span className="h-px w-12" style={{ backgroundColor: accent }} />
          <span
            className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
            style={{ color: accent }}
          >
            Pour aller plus loin
          </span>
          <span style={{ color: accent, opacity: 0.4 }} aria-hidden className="text-xs">
            ◆
          </span>
        </div>

        <ul className="space-y-2 mb-8">
          {alumni.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-5 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)] focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
              >
                <span className="flex items-center gap-3">
                  <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    {link.type}
                  </span>
                  <span>{link.label}</span>
                </span>
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            </li>
          ))}
          {anchorEraId && (
            <li>
              <a
                href={`/#timeline-${anchorEraId}`}
                className="flex items-center justify-between rounded-xl border bg-[var(--bg-surface)] px-5 py-3 text-sm transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
                style={{ borderColor: `${accent}40`, color: accent }}
              >
                <span className="flex items-center gap-3">
                  <span
                    className="font-data text-[10px] uppercase tracking-widest"
                    style={{ color: accent, opacity: 0.7 }}
                  >
                    timeline
                  </span>
                  <span>Voir cet alumni dans la KC Timeline</span>
                </span>
                <span aria-hidden style={{ color: accent }}>
                  ◆
                </span>
              </a>
            </li>
          )}
        </ul>

        {/* Prev / Next nav */}
        <div className="grid gap-4 md:grid-cols-2">
          {prev && (
            <PrevNextNavCard
              direction="prev"
              variant="alumni"
              basePath="/alumni/"
              entity={{
                slug: prev.slug,
                name: prev.name,
                subtitle: prev.period,
                accentColor: prev.accentColor,
              }}
            />
          )}
          {next && (
            <PrevNextNavCard
              direction="next"
              variant="alumni"
              basePath="/alumni/"
              entity={{
                slug: next.slug,
                name: next.name,
                subtitle: next.period,
                accentColor: next.accentColor,
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}
