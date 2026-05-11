/**
 * /alumni/[slug] — Narrative-driven bio page for a legendary ex-KC player.
 *
 * Unlike /player/[slug] which is data-driven from kc_matches.json, this
 * page uses hand-written content from lib/alumni.ts. No match stats, no
 * live data — just the legend.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAlumniBySlug, getAllAlumniSlugs, ALUMNI } from "@/lib/alumni";
import { getEraById } from "@/lib/eras";
import { championSplashUrl, championLoadingUrl } from "@/lib/constants";
import { PortraitCubeMorph } from "@/components/PortraitCubeMorph";
import { AntreTrigger } from "@/components/AntreTrigger";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllAlumniSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const alumni = getAlumniBySlug(slug);
  if (!alumni) return { title: "Alumni \u2014 KCKILLS" };

  const title = `${alumni.name} \u2014 ${alumni.period}`;
  const description = `${alumni.subtitle}. ${alumni.bio.slice(0, 140)}...`;
  const canonicalPath = `/alumni/${alumni.slug}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: `${title} \u2014 KCKILLS`,
      description,
      type: "profile",
      url: canonicalPath,
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} \u2014 KCKILLS`,
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

  const eras = alumni.eras.map((id) => getEraById(id)).filter((e) => e !== undefined);
  const paragraphs = alumni.bio.split(/\n\n+/);
  const accent = alumni.accentColor;
  const splash = championSplashUrl(alumni.signatureChampion);
  const loading = championLoadingUrl(alumni.signatureChampion);

  // Siblings for prev/next nav
  const idx = ALUMNI.findIndex((a) => a.slug === alumni.slug);
  const prev = idx > 0 ? ALUMNI[idx - 1] : null;
  const next = idx < ALUMNI.length - 1 ? ALUMNI[idx + 1] : null;

  // ─── JSON-LD: Person schema for the alumnus, with alumniOf back to KC.
  //     Different from active /player schema because there's no live
  //     stats payload — we lean on the curated bio text instead.
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
      {/* BCC easter egg — only on Bo's alumni page. Listens for the B-C-C
          keyboard ritual and opens the Antre de la BCC fan cave (migration
          059 + 060). Lazy-loads the cave component so the alumni-page
          chunk stays slim until the ritual fires. Bo = jungler chinois
          2024 (Zhu Yi-Long), ex-Vitality, the BCC's adopted patron. */}
      {alumni.slug === "bo" && <AntreTrigger />}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(alumniJsonLd) }}
      />
      {/* ─── HERO — cinematic with cube-portrait morph ──────── */}
      <section className="relative h-[78vh] min-h-[640px] w-full overflow-hidden bg-[var(--bg-primary)]">
        {/* Soft splash backdrop — heavily darkened so the cube animation owns
            the visual weight without losing the champion silhouette context. */}
        <Image
          src={loading}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover scale-110"
          style={{ filter: "brightness(0.22) saturate(1.15)" }}
        />

        {/* Cube morph alternates between splash + loading art so the alumni's
            signature champion materialises as a living dot-matrix portrait. */}
        <PortraitCubeMorph
          images={[loading, splash]}
          accent={accent}
          cols={68}
          aspect={9 / 16}
          holdMs={6000}
          morphMs={2200}
          className="absolute inset-0 mix-blend-screen opacity-95"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)] via-transparent to-[var(--bg-primary)]/70" />
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: `radial-gradient(ellipse at 20% 60%, ${accent}30, transparent 60%)`,
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl h-full flex flex-col justify-end px-6 pb-16">
          <nav className="absolute top-6 left-6 right-6 flex items-center justify-between text-sm text-white/60">
            <Link href="/alumni" className="flex items-center gap-2 hover:text-[var(--gold)]">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Tous les alumni
            </Link>
            <span className="font-data text-[10px] uppercase tracking-widest">{alumni.period}</span>
          </nav>

          <p
            className="font-display text-xs md:text-sm font-bold uppercase tracking-[0.3em] mb-3"
            style={{ color: accent }}
          >
            {ROLE_LABEL[alumni.role]} &middot; {alumni.nationality}
          </p>

          <h1
            className="font-display text-6xl md:text-8xl lg:text-[10rem] font-black uppercase leading-none"
            style={{
              color: "white",
              textShadow: `0 0 60px ${accent}40, 0 4px 20px rgba(0,0,0,0.8)`,
              letterSpacing: "-0.02em",
            }}
          >
            {alumni.name}
          </h1>

          {alumni.realName && (
            <p className="mt-4 text-lg md:text-xl text-white/60 font-medium">{alumni.realName}</p>
          )}

          <p
            className="mt-6 font-display text-sm md:text-base font-bold uppercase tracking-[0.25em]"
            style={{ color: accent }}
          >
            {alumni.tag}
          </p>
        </div>
      </section>

      {/* ─── STATS STRIP ──────────────────────────────────── */}
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

      {/* ─── BIO ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="flex items-center gap-3 mb-8">
          <span className="h-px w-12" style={{ backgroundColor: accent }} />
          <span
            className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
            style={{ color: accent }}
          >
            L&rsquo;histoire
          </span>
        </div>
        <p className="font-display text-2xl md:text-3xl font-bold leading-relaxed text-[var(--text-primary)] mb-10">
          {alumni.subtitle}
        </p>
        <div className="space-y-6 text-lg md:text-xl leading-relaxed text-[var(--text-secondary)]">
          {paragraphs.map((para, i) => (
            <p key={i} dangerouslySetInnerHTML={{ __html: para }} />
          ))}
        </div>
      </section>

      {/* ─── ERAS ────────────────────────────────────────── */}
      {eras.length > 0 && (
        <section className="mx-auto max-w-5xl px-6 py-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-12" style={{ backgroundColor: accent }} />
            <span
              className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
              style={{ color: accent }}
            >
              Epoques
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {eras.map((era) => (
              <Link
                key={era!.id}
                href={`/era/${era!.id}`}
                className="group flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 transition-all hover:border-[var(--gold)]/50 hover:-translate-y-0.5"
              >
                <div
                  className="h-12 w-12 rounded-lg flex items-center justify-center text-2xl"
                  style={{
                    backgroundColor: `${era!.color}20`,
                    border: `1px solid ${era!.color}50`,
                  }}
                >
                  {era!.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-[var(--text-primary)] group-hover:text-[var(--gold)] transition-colors">
                    {era!.label}
                  </div>
                  <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                    {era!.period} &middot; {era!.result}
                  </div>
                </div>
                <svg className="h-3 w-3 text-[var(--text-muted)] group-hover:text-[var(--gold)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── LINKS ───────────────────────────────────────── */}
      {alumni.links.length > 0 && (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-12" style={{ backgroundColor: accent }} />
            <span
              className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
              style={{ color: accent }}
            >
              Pour aller plus loin
            </span>
          </div>
          <ul className="space-y-2">
            {alumni.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-5 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)]"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                      {link.type}
                    </span>
                    <span>{link.label}</span>
                  </span>
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── PREV / NEXT ─────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-4 md:grid-cols-2">
          {prev && <AlumniNavCard alumni={prev} direction="prev" />}
          {next && <AlumniNavCard alumni={next} direction="next" />}
        </div>
      </section>
    </div>
  );
}

function AlumniNavCard({
  alumni,
  direction,
}: {
  alumni: { slug: string; name: string; period: string; tag: string; accentColor: string };
  direction: "prev" | "next";
}) {
  return (
    <Link
      href={`/alumni/${alumni.slug}`}
      className={`group flex items-center gap-5 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 transition-all hover:border-[var(--gold)]/50 hover:-translate-y-0.5 ${
        direction === "next" ? "md:text-right md:flex-row-reverse" : ""
      }`}
    >
      <div
        className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center"
        style={{
          backgroundColor: `${alumni.accentColor}20`,
          border: `1px solid ${alumni.accentColor}50`,
        }}
      >
        <svg className="h-4 w-4" style={{ color: alumni.accentColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3}
            d={direction === "prev" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {direction === "prev" ? "Alumni precedent" : "Alumni suivant"}
        </p>
        <p className="font-display text-2xl font-black text-[var(--text-primary)] group-hover:text-[var(--gold)] transition-colors">
          {alumni.name}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1">{alumni.period}</p>
      </div>
    </Link>
  );
}
