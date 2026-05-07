import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getEraById, getErasSortedByDate, type Era } from "@/lib/eras";
import { loadRealData, type RealMatch } from "@/lib/real-data";
import { championSplashUrl } from "@/lib/constants";
import { KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";
import { EraClipsSection } from "./era-clips";
import { getQuotesByEra } from "@/lib/quotes";
import { QuoteRow } from "@/components/QuoteCard";
import { PortraitCubeMorph } from "@/components/PortraitCubeMorph";

export const revalidate = 3600;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const era = getEraById(id);
  if (!era) return { title: "\u00c9poque \u2014 KCKILLS" };

  const description = `${era.subtitle} \u2014 ${era.result}. ${era.keyMoment.slice(0, 140)}...`;
  const title = `${era.label} \u2014 ${era.period}`;
  const canonicalPath = `/era/${era.id}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title: `${title} \u2014 KCKILLS`,
      description,
      type: "article",
      url: canonicalPath,
      images: era.image
        ? [
            {
              url: era.image,
              width: 1200,
              height: 630,
              alt: `${era.label} \u2014 Karmine Corp ${era.period}`,
            },
          ]
        : undefined,
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} \u2014 KCKILLS`,
      description,
      images: era.image ? [era.image] : undefined,
    },
  };
}

export async function generateStaticParams() {
  return getErasSortedByDate().map((e) => ({ id: e.id }));
}

/** Filter matches that fall within an era's date range */
function matchesInEra(matches: RealMatch[], era: Era): RealMatch[] {
  return matches.filter((m) => m.date >= era.dateStart && m.date <= era.dateEnd);
}

/** Find the previous and next era by date */
function getNavigation(currentId: string) {
  const sorted = getErasSortedByDate();
  const idx = sorted.findIndex((e) => e.id === currentId);
  return {
    prev: idx > 0 ? sorted[idx - 1] : null,
    next: idx < sorted.length - 1 ? sorted[idx + 1] : null,
  };
}

export default async function EraPage({ params }: Props) {
  const { id } = await params;
  const era = getEraById(id);
  if (!era) notFound();

  const data = loadRealData();
  const periodMatches = matchesInEra(data.matches, era);
  const wins = periodMatches.filter((m) => m.kc_won).length;
  const losses = periodMatches.length - wins;
  const totalKills = periodMatches.reduce(
    (acc, m) => acc + m.games.reduce((a, g) => a + g.kc_kills, 0),
    0
  );
  const { prev, next } = getNavigation(era.id);

  // Build the cube-morph palette: top distinct KC champions for this era,
  // ordered by usage frequency, capped at 6 to keep the morph cycle snappy.
  const champCounts = new Map<string, number>();
  for (const m of periodMatches) {
    for (const g of m.games) {
      for (const p of g.kc_players) {
        if (!p.name.startsWith("KC ")) continue;
        champCounts.set(p.champion, (champCounts.get(p.champion) ?? 0) + 1);
      }
    }
  }
  const morphChampions = [...champCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([champ]) => champ);
  // If the era has no recorded matches yet, fall back to a single splash so
  // the cube grid still renders something meaningful.
  if (morphChampions.length === 0) morphChampions.push("Jhin");
  const morphImages = morphChampions.map((c) => championSplashUrl(c));

  return (
    <div className="relative -mx-4 -mt-6">
      {/* ═══ HERO — full-screen cinematic with cube-portrait morph ═══ */}
      <section className="relative h-[85vh] min-h-[640px] w-full overflow-hidden bg-[var(--bg-primary)]">
        {/* Static bottom layer keeps the era's identity image visible while
            the cube morph paints itself on top — gives the hero a base even
            on cold cache or if Canvas fails to mount. */}
        {era.image ? (
          <Image
            src={era.image}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover scale-110"
            style={{ filter: "brightness(0.25) saturate(1.1)" }}
          />
        ) : null}

        {/* Cube-portrait morph — cycles through the era's signature champions
            as a glowing dot-matrix face that breathes between identities. */}
        <PortraitCubeMorph
          images={morphImages}
          accent={era.color}
          cols={70}
          aspect={9 / 16}
          holdMs={5200}
          morphMs={1900}
          className="absolute inset-0 mix-blend-screen opacity-90"
        />

        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)]/80 via-transparent to-[var(--bg-primary)]/60" />
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 60% 40% at 30% 40%, ${era.color}25 0%, transparent 60%)`,
          }}
        />

        {/* Scanline / grid texture */}
        <div
          className="absolute inset-0 opacity-20 mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />

        {/* Breadcrumb */}
        <nav className="absolute top-6 left-6 z-20 flex items-center gap-2 text-xs text-white/50">
          <Link href="/" className="hover:text-[var(--gold)]">
            Accueil
          </Link>
          <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
          <Link href="/#timeline" className="hover:text-[var(--gold)]">
            &Eacute;poques
          </Link>
          <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
          <span className="text-[var(--gold)]">{era.label}</span>
        </nav>

        {/* Prev/next era chips */}
        <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
          {prev && (
            <Link
              href={`/era/${prev.id}`}
              className="group flex items-center gap-2 rounded-full border border-white/15 bg-black/40 backdrop-blur-md px-4 py-2 text-xs text-white/70 transition-all hover:border-[var(--gold)]/50 hover:text-white"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline font-data uppercase tracking-wider">
                {prev.period}
              </span>
            </Link>
          )}
          {next && (
            <Link
              href={`/era/${next.id}`}
              className="group flex items-center gap-2 rounded-full border border-white/15 bg-black/40 backdrop-blur-md px-4 py-2 text-xs text-white/70 transition-all hover:border-[var(--gold)]/50 hover:text-white"
            >
              <span className="hidden sm:inline font-data uppercase tracking-wider">
                {next.period}
              </span>
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>

        {/* Content */}
        <div className="relative z-10 h-full max-w-7xl mx-auto flex flex-col justify-end px-6 pb-16">
          {/* Phase tag */}
          <div className="flex items-center gap-3 mb-4">
            <span
              className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.2em] uppercase backdrop-blur-sm border"
              style={{
                color: era.color,
                backgroundColor: `${era.color}15`,
                borderColor: `${era.color}40`,
              }}
            >
              {era.phase}
            </span>
            <span className="font-data text-xs text-white/50 tracking-[0.2em] uppercase">
              {era.period}
            </span>
          </div>

          {/* Icon + massive title */}
          <div className="flex items-end gap-6 mb-6">
            <span className="text-7xl md:text-9xl leading-none">{era.icon}</span>
            <div>
              <h1
                className="font-display font-black leading-[0.9] text-6xl md:text-8xl lg:text-[9rem]"
                style={{
                  color: era.color,
                  textShadow: `0 0 60px ${era.color}40, 0 6px 30px rgba(0,0,0,0.7)`,
                }}
              >
                {era.label}
              </h1>
              <p className="font-display text-xl md:text-3xl text-white/80 mt-2 font-bold">
                {era.subtitle}
              </p>
            </div>
          </div>

          {/* Result badge + stats grid */}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span
              className="inline-flex items-center rounded-xl border px-5 py-3 font-display font-bold text-lg"
              style={{
                color: era.color,
                borderColor: `${era.color}50`,
                backgroundColor: `${era.color}15`,
              }}
            >
              {era.result}
            </span>
            {periodMatches.length > 0 && (
              <>
                <div className="rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm px-4 py-3">
                  <p className="font-data text-xs text-white/40 uppercase tracking-wider">Matchs</p>
                  <p className="font-data text-xl font-black text-white">
                    <span className="text-[var(--green)]">{wins}</span>
                    <span className="text-white/30 mx-1">-</span>
                    <span className="text-[var(--red)]">{losses}</span>
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm px-4 py-3">
                  <p className="font-data text-xs text-white/40 uppercase tracking-wider">Kills KC</p>
                  <p className="font-data text-xl font-black text-[var(--gold)]">{totalKills}</p>
                </div>
              </>
            )}
            {era.viewership && (
              <div className="rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm px-4 py-3">
                <p className="font-data text-xs text-white/40 uppercase tracking-wider">Audience</p>
                <p className="font-data text-sm font-bold text-white">{era.viewership}</p>
              </div>
            )}
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 text-white/30">
          <span className="text-[10px] uppercase tracking-[0.3em]">D&eacute;rouler</span>
          <svg className="h-4 w-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ═══ KEY MOMENT ═══ */}
      <section className="relative max-w-5xl mx-auto px-6 py-20">
        <div className="flex items-center gap-3 mb-6">
          <span
            className="h-px w-12"
            style={{ backgroundColor: era.color }}
          />
          <span
            className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
            style={{ color: era.color }}
          >
            Moment cl&eacute;
          </span>
        </div>
        <p className="text-xl md:text-2xl leading-relaxed text-white/85 font-light">
          {era.keyMoment}
        </p>
      </section>

      {/* ═══ CLIPS — YouTube searches ═══ */}
      {era.links.length > 0 && (
        <EraClipsSection era={era} />
      )}

      {/* ═══ EVENTS ═══ */}
      {era.events && era.events.length > 0 && (
        <section className="relative max-w-5xl mx-auto px-6 py-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-12" style={{ backgroundColor: era.color }} />
            <span
              className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
              style={{ color: era.color }}
            >
              &Eacute;v&eacute;nements
            </span>
          </div>
          <div className="space-y-3">
            {era.events.map((ev, i) => (
              <div
                key={i}
                className="flex items-start gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 transition-all hover:border-[var(--gold)]/40"
              >
                <div
                  className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center font-data font-bold text-sm"
                  style={{
                    backgroundColor: `${era.color}20`,
                    color: era.color,
                    border: `1px solid ${era.color}40`,
                  }}
                >
                  {i + 1}
                </div>
                <p className="text-base text-white/90 leading-relaxed pt-1">{ev}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ QUOTES ═══ */}
      {(() => {
        const quotes = getQuotesByEra(era.id);
        if (quotes.length === 0) return null;
        return (
          <section className="relative max-w-5xl mx-auto px-6 py-16">
            <div className="flex items-center gap-3 mb-6">
              <span className="h-px w-12" style={{ backgroundColor: era.color }} />
              <span
                className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
                style={{ color: era.color }}
              >
                Citations
              </span>
            </div>
            <QuoteRow quotes={quotes} />
          </section>
        );
      })()}

      {/* ═══ ROSTER ═══ */}
      {era.roster && (
        <section className="relative max-w-5xl mx-auto px-6 py-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-12" style={{ backgroundColor: era.color }} />
            <span
              className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
              style={{ color: era.color }}
            >
              Roster
            </span>
          </div>
          <div
            className="rounded-2xl border p-8"
            style={{
              borderColor: `${era.color}30`,
              background: `linear-gradient(135deg, ${era.color}08 0%, transparent 60%)`,
            }}
          >
            <p className="font-display text-2xl md:text-4xl font-bold leading-relaxed text-white">
              {era.roster}
            </p>
            {era.coach && (
              <p className="mt-4 text-sm text-white/50 font-data uppercase tracking-widest">
                Coach &mdash; {era.coach}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ═══ MATCHES FROM THIS PERIOD ═══ */}
      {periodMatches.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-6 py-16">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <span className="h-px w-12" style={{ backgroundColor: era.color }} />
              <span
                className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
                style={{ color: era.color }}
              >
                Matchs &middot; {periodMatches.length}
              </span>
            </div>
            <Link
              href="/matches"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--gold)]"
            >
              Tous les matchs &rarr;
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {periodMatches.slice(0, 9).map((match) => {
              const totalKc = match.games.reduce((a, g) => a + g.kc_kills, 0);
              const totalOpp = match.games.reduce((a, g) => a + g.opp_kills, 0);
              const date = new Date(match.date);
              const oppLogo = TEAM_LOGOS[match.opponent.code];
              const bgChamp =
                match.games[0]?.kc_players?.find((p) => p.name.startsWith("KC "))?.champion ??
                "Jhin";

              return (
                <Link
                  key={match.id}
                  href={`/match/${match.id}`}
                  className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/50 hover:scale-[1.02]"
                  style={{ aspectRatio: "4/3" }}
                >
                  <Image
                    src={championSplashUrl(bgChamp)}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover opacity-25 group-hover:opacity-50 group-hover:scale-110 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/30" />

                  <div className="absolute top-0 left-0 right-0 p-4 flex items-start justify-between z-10">
                    <div
                      className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm ${
                        match.kc_won
                          ? "bg-[var(--green)]/20 border border-[var(--green)]/40 text-[var(--green)]"
                          : "bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)]"
                      }`}
                    >
                      {match.kc_won ? "Victoire" : "D\u00e9faite"}
                    </div>
                    <span className="text-[10px] text-white/50 font-medium">
                      {date.toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-5 z-10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex flex-col items-center gap-1">
                        <Image
                          src={KC_LOGO}
                          alt="KC"
                          width={44}
                          height={44}
                          className="rounded-xl"
                        />
                        <span className="font-display text-xs font-bold text-[var(--gold)]">
                          KC
                        </span>
                      </div>
                      <div className="text-center">
                        <p className="font-data text-3xl font-black">
                          <span
                            className={match.kc_won ? "text-[var(--green)]" : "text-white/50"}
                          >
                            {match.kc_score}
                          </span>
                          <span className="text-white/20 mx-2">-</span>
                          <span
                            className={!match.kc_won ? "text-[var(--red)]" : "text-white/50"}
                          >
                            {match.opp_score}
                          </span>
                        </p>
                        <p className="font-data text-[10px] text-white/40 mt-1">
                          Kills : <span className="text-[var(--green)]">{totalKc}</span>-
                          <span className="text-[var(--red)]">{totalOpp}</span>
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        {oppLogo ? (
                          <Image
                            src={oppLogo}
                            alt={match.opponent.code}
                            width={44}
                            height={44}
                            className="rounded-xl grayscale group-hover:grayscale-0 transition-all"
                          />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-sm font-bold">
                            {match.opponent.code}
                          </div>
                        )}
                        <span className="font-display text-xs font-bold text-white/70">
                          {match.opponent.code}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          {periodMatches.length > 9 && (
            <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
              + {periodMatches.length - 9} autres matchs
            </p>
          )}
        </section>
      )}

      {/* ═══ BOTTOM NAV ═══ */}
      <section className="relative max-w-7xl mx-auto px-6 py-16">
        <div className="grid gap-4 md:grid-cols-2">
          {prev && <EraNavCard era={prev} direction="prev" />}
          {next && <EraNavCard era={next} direction="next" />}
        </div>
      </section>

      {/* ═══ HIDDEN EASTER EGG ═══ */}
      {/* Only visible on the 3 Dark Era 2024 eras — tiny blood-red hint
          leading to the hidden /era/darkness inverted chronicle. Not in the
          sitemap, noindex, not in the command palette. */}
      {(era.id === "lec-2024-winter" || era.id === "lec-2024-spring" || era.id === "lec-2024-summer") && (
        <section className="relative max-w-5xl mx-auto px-6 pb-16 text-center">
          <Link
            href="/era/darkness"
            className="inline-block font-data text-[10px] uppercase tracking-[0.3em] text-[#5a2020] transition-colors hover:text-[#e84057]"
            aria-label="Le chapitre qu'on prefere oublier"
          >
            &laquo; le chapitre qu&rsquo;on pr&eacute;f&egrave;re oublier
          </Link>
        </section>
      )}
    </div>
  );
}

function EraNavCard({ era, direction }: { era: Era; direction: "prev" | "next" }) {
  return (
    <Link
      href={`/era/${era.id}`}
      className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 transition-all hover:border-[var(--gold)]/40 hover:scale-[1.01]"
    >
      {era.image && (
        <Image
          src={era.image}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover opacity-20 group-hover:opacity-40 transition-opacity"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
      <div
        className="relative z-10 flex items-center gap-4"
        style={direction === "next" ? { flexDirection: "row-reverse", textAlign: "right" } : {}}
      >
        <div
          className="h-14 w-14 flex-shrink-0 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: `${era.color}20`,
            border: `1px solid ${era.color}50`,
          }}
        >
          <svg className="h-5 w-5" fill="none" stroke={era.color} viewBox="0 0 24 24">
            {direction === "prev" ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M15 19l-7-7 7-7"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M9 5l7 7-7 7"
              />
            )}
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-data text-[10px] uppercase tracking-wider text-white/40 mb-1">
            {direction === "prev" ? "\u00c9poque pr\u00e9c\u00e9dente" : "\u00c9poque suivante"}
          </p>
          <p className="font-display text-2xl font-black text-white">{era.label}</p>
          <p className="text-xs text-white/50 mt-1">{era.period}</p>
        </div>
      </div>
    </Link>
  );
}
