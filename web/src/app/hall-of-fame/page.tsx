import Link from "next/link";
import type { Metadata } from "next";
import { HALL_OF_FAME, type HofMoment } from "@/lib/hall-of-fame";
import { getEraById } from "@/lib/eras";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hall of Fame",
  description:
    "Les 10 moments qui ont defini la Karmine Corp. Le Sacre, les pentakills, les records, les comebacks. L'histoire du club racontee par ses plus grandes heures.",
  openGraph: {
    title: "Hall of Fame — KCKILLS",
    description: "Les 10 moments qui ont defini la Karmine Corp.",
    type: "website",
  },
};

const TAG_LABELS: Record<HofMoment["tag"], string> = {
  trophy: "Trophee",
  play: "Outplay",
  comeback: "Comeback",
  milestone: "Milestone",
  meme: "Meme",
  record: "Record",
};

export default function HallOfFamePage() {
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
      {/* ═══ HERO ═══ */}
      <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden px-6 md:px-16 py-20">
        {/* Champion splash background */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/hero-bg.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-35 scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)] via-[var(--bg-primary)]/60 to-[var(--bg-primary)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/60" />

        {/* Scanlines */}
        <div
          className="absolute inset-0 opacity-15 mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.1) 3px, transparent 4px)",
          }}
        />

        <div className="relative z-10 text-center max-w-4xl">
          {/* Breadcrumb */}
          <nav className="mb-6 flex items-center justify-center gap-2 text-xs text-white/50">
            <Link href="/" className="hover:text-[var(--gold)]">
              Accueil
            </Link>
            <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
            <span className="text-[var(--gold)]">Hall of Fame</span>
          </nav>

          <div className="inline-flex items-center gap-3 mb-6">
            <span className="rounded-full border border-[var(--gold)]/30 bg-black/50 backdrop-blur-sm px-4 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--gold)]">
              Karmine Corp &middot; Legendes
            </span>
          </div>

          <h1 className="font-display font-black tracking-tight leading-[0.82] text-5xl md:text-7xl lg:text-8xl mb-5">
            <span className="hero-title-glow">
              <span className="text-shimmer">HALL OF FAME</span>
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-base md:text-lg text-white/80 font-medium leading-relaxed">
            Les 10 moments qui ont defini la Karmine Corp. Du premier titre EU
            Masters au Sacre LEC Winter 2025, en passant par les pentakills,
            les comebacks impossibles et les tweets presidentiels. L&apos;histoire
            du club racontee par ses plus grandes heures.
          </p>

          {/* Quick stats */}
          <div className="mt-10 flex items-center justify-center gap-8 flex-wrap text-center">
            <div>
              <p className="font-data text-4xl md:text-5xl font-black text-[var(--gold)] leading-none">
                {HALL_OF_FAME.length}
              </p>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">
                Moments
              </p>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <div>
              <p className="font-data text-4xl md:text-5xl font-black text-[var(--gold)] leading-none">
                {new Set(HALL_OF_FAME.map((m) => m.year)).size}
              </p>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">
                Annees
              </p>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <div>
              <p className="font-data text-4xl md:text-5xl font-black text-[var(--gold)] leading-none">
                {HALL_OF_FAME.filter((m) => m.tag === "trophy" || m.tag === "record").length}
              </p>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">
                Trophees
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ LIST ═══ */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 lg:px-16 py-16 space-y-12">
        {HALL_OF_FAME.map((moment) => {
          const era = getEraById(moment.eraId);
          return (
            <HofCard key={moment.rank} moment={moment} eraLabel={era?.label} />
          );
        })}
      </section>

      {/* ═══ Footer CTA ═══ */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="gold-line mb-8" />
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/60 mb-4">
          La legende continue
        </p>
        <h2 className="font-display text-3xl md:text-5xl font-black mb-6">
          <span className="text-shimmer">Et demain ?</span>
        </h2>
        <p className="max-w-2xl mx-auto text-base text-white/70 leading-relaxed mb-10">
          Chaque split ecrit un nouveau chapitre. Spring 2026 est en cours.
          MSI 2026 est l&apos;objectif. Le prochain moment du Hall of Fame se
          joue peut-etre ce week-end sur la scene LEC.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/scroll"
            className="rounded-xl bg-[var(--gold)] px-8 py-4 font-display text-sm font-black uppercase tracking-widest text-[var(--bg-primary)] transition-all hover:bg-[var(--gold-bright)] hover:scale-[1.03]"
          >
            Scroll les kills
          </Link>
          <Link
            href="/#timeline"
            className="rounded-xl border border-[var(--border-gold)] bg-black/30 backdrop-blur-sm px-8 py-4 font-display text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--gold)]/50 hover:text-[var(--gold)]"
          >
            Explorer les epoques
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ─── Card component ─────────────────────────────────────────────── */

function HofCard({ moment, eraLabel }: { moment: HofMoment; eraLabel?: string }) {
  const videoThumb = moment.videoId
    ? `https://i.ytimg.com/vi/${moment.videoId}/maxresdefault.jpg`
    : null;

  return (
    <div
      id={`rank-${moment.rank}`}
      className="relative scroll-mt-24"
    >
      {/* Massive rank number in the background */}
      <div
        className="pointer-events-none absolute -top-8 left-0 md:left-8 z-0 font-display font-black select-none leading-none opacity-[0.08]"
        style={{
          fontSize: "clamp(10rem, 20vw, 24rem)",
          color: moment.color,
          textShadow: `0 0 80px ${moment.color}40`,
        }}
      >
        {String(moment.rank).padStart(2, "0")}
      </div>

      <div
        className="relative z-10 grid gap-6 md:grid-cols-12 items-center rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-sm p-6 md:p-10 overflow-hidden"
        style={{
          boxShadow: `inset 0 0 0 1px ${moment.color}15, 0 20px 60px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Accent top bar */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${moment.color}, transparent)`,
          }}
        />

        {/* LEFT: Video thumbnail or icon */}
        <div className="md:col-span-5">
          {videoThumb ? (
            <a
              href={`https://www.youtube.com/watch?v=${moment.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block rounded-2xl overflow-hidden border-2 transition-transform hover:scale-[1.02]"
              style={{
                borderColor: `${moment.color}50`,
                boxShadow: `0 20px 50px ${moment.color}30`,
                aspectRatio: "16 / 9",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={videoThumb}
                alt={moment.title}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
              {/* Play button */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full border-2 backdrop-blur-md transition-transform group-hover:scale-110"
                  style={{
                    backgroundColor: `${moment.color}30`,
                    borderColor: `${moment.color}80`,
                  }}
                >
                  <svg
                    className="h-6 w-6 text-white translate-x-0.5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              {/* YouTube badge */}
              <div className="absolute top-3 right-3 rounded-sm bg-red-600/90 backdrop-blur-sm px-1.5 py-0.5">
                <span className="text-[9px] font-black text-white tracking-wider">
                  YOUTUBE
                </span>
              </div>
            </a>
          ) : (
            <div
              className="relative flex items-center justify-center rounded-2xl border-2"
              style={{
                borderColor: `${moment.color}50`,
                backgroundColor: `${moment.color}10`,
                aspectRatio: "16 / 9",
              }}
            >
              <span className="text-8xl opacity-80">{moment.icon}</span>
            </div>
          )}
        </div>

        {/* RIGHT: Text content */}
        <div className="md:col-span-7 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="text-4xl" aria-hidden="true">
              {moment.icon}
            </span>
            <span
              className="rounded-md px-2.5 py-0.5 font-data text-[10px] font-bold tracking-[0.2em] uppercase border"
              style={{
                color: moment.color,
                backgroundColor: `${moment.color}15`,
                borderColor: `${moment.color}40`,
              }}
            >
              {TAG_LABELS[moment.tag]}
            </span>
            <span className="font-data text-[10px] uppercase tracking-[0.2em] text-white/40">
              {moment.year}
            </span>
            {eraLabel && (
              <Link
                href={`/era/${moment.eraId}`}
                className="font-data text-[10px] uppercase tracking-[0.2em] text-white/40 hover:text-[var(--gold)] transition-colors"
              >
                &middot; {eraLabel} &rarr;
              </Link>
            )}
          </div>

          {/* Title */}
          <h3
            className="font-display font-black leading-none mb-2"
            style={{
              fontSize: "clamp(1.75rem, 3.5vw, 3rem)",
              color: moment.color,
              textShadow: `0 0 30px ${moment.color}40`,
            }}
          >
            {moment.title}
          </h3>

          {/* Subtitle */}
          <p className="text-base md:text-lg text-white/70 font-medium mb-5">
            {moment.subtitle}
          </p>

          {/* Narrative */}
          <p className="text-sm md:text-base text-white/80 leading-relaxed mb-5">
            {moment.narrative}
          </p>

          {/* Quote */}
          {moment.quote && (
            <blockquote
              className="relative pl-5 border-l-2 mb-5 italic text-sm md:text-base text-white/70 leading-relaxed"
              style={{ borderColor: `${moment.color}60` }}
            >
              <p>&laquo; {moment.quote} &raquo;</p>
              {moment.quoteAuthor && (
                <cite className="block mt-1 text-[11px] not-italic text-white/40 uppercase tracking-widest">
                  &mdash; {moment.quoteAuthor}
                </cite>
              )}
            </blockquote>
          )}

          {/* Stats */}
          {moment.stats && moment.stats.length > 0 && (
            <ul className="grid gap-2 text-xs md:text-sm">
              {moment.stats.map((stat) => (
                <li
                  key={stat}
                  className="flex items-start gap-2 text-white/60"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: moment.color }}
                  />
                  <span>{stat}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
