/**
 * OnThisDay — homepage section that surfaces kills from the SAME calendar
 * date in past years. Nostalgia bait : "Il y a 4 ans aujourd'hui,
 * Cabochard 1v3 vs G2". The KC roster has played LEC+LFL since 2021 so
 * there's almost always at least one historical kill to surface.
 *
 * Renders nothing if no historical kills match (e.g. very early in the
 * project's life on a Wednesday). Renders a single curated highlight
 * + a horizontal scroll strip of up to 11 more if matches > 1.
 *
 * Wave 28 (2026-05-11).
 */

import Link from "next/link";
import Image from "next/image";
import {
  getOnThisDayKills,
  getTodayMonthDay,
  type OnThisDayKill,
} from "@/lib/supabase/on-this-day";

const MULTI_KILL_LABEL: Record<string, string> = {
  penta:  "PENTAKILL",
  quadra: "QUADRA",
  triple: "TRIPLE",
  double: "DOUBLE",
};

const DATE_FMT_FR = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function frenchOrdinalDay(): string {
  const { day, month } = getTodayMonthDay();
  const monthNames = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  const dayLabel = day === 1 ? "1er" : String(day);
  return `${dayLabel} ${monthNames[month - 1]}`;
}

function MatchupCard({
  kill,
  hero = false,
}: { kill: OnThisDayKill; hero?: boolean }) {
  const matchup = `${kill.killer_ign || kill.killer_champion || "?"} → ${kill.victim_ign || kill.victim_champion || "?"}`;
  const championLine = `${kill.killer_champion || "?"} vs ${kill.victim_champion || "?"}`;
  // The RPC projects the legacy `thumbnail_url` column directly. We
  // don't have access to the kill_assets manifest here — the legacy
  // URL is fine for thumbnails since they don't go through HLS.
  const thumb = kill.thumbnail_url;
  const score = kill.highlight_score ?? 0;
  const multi = kill.multi_kill ? MULTI_KILL_LABEL[kill.multi_kill] : null;
  const years = kill.years_ago > 0 ? kill.years_ago : null;
  const isoDate = kill.match_date ? new Date(kill.match_date) : null;
  const dateLabel = isoDate ? DATE_FMT_FR.format(isoDate) : null;

  if (hero) {
    return (
      <Link
        href={`/scroll?kill=${kill.id}`}
        aria-label={`Lire le clip d'il y a ${kill.years_ago} ans : ${matchup}`}
        className="group relative block overflow-hidden rounded-2xl border-2 border-[var(--gold)]/40 bg-black transition-all hover:border-[var(--gold)] hover:shadow-2xl hover:shadow-[var(--gold)]/30"
        style={{ aspectRatio: "16 / 9" }}
      >
        {thumb ? (
          <Image
            src={thumb}
            alt={`Clip ${matchup}`}
            fill
            sizes="(max-width: 768px) 100vw, 60vw"
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            priority
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
            <span className="font-display text-5xl text-[var(--gold-dark)]">KC</span>
          </div>
        )}

        {/* Vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

        {/* "Il y a N ans" overlay top-left */}
        {years !== null && (
          <div className="absolute left-4 top-4 z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--gold)] bg-black/85 backdrop-blur px-3 py-1.5 font-display text-xs uppercase tracking-[0.25em] text-[var(--gold-bright)]">
              <span>◆</span>
              <span>{years === 1 ? "Il y a 1 an" : `Il y a ${years} ans`}</span>
            </div>
          </div>
        )}

        {/* Multi-kill / FB chip top-right */}
        {(multi || kill.is_first_blood) && (
          <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-1.5">
            {multi && (
              <span className="rounded-full border border-[var(--gold-bright)] bg-black/85 backdrop-blur px-3 py-1 font-display text-xs uppercase tracking-[0.2em] text-[var(--gold-bright)]">
                {multi}
              </span>
            )}
            {kill.is_first_blood && (
              <span className="rounded-md bg-[var(--red)]/90 backdrop-blur px-2 py-0.5 font-data text-[10px] font-bold uppercase tracking-widest text-white">
                FIRST BLOOD
              </span>
            )}
          </div>
        )}

        {/* Bottom matchup + description */}
        <div className="absolute inset-x-0 bottom-0 z-[5] p-5 md:p-7">
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80 mb-1.5">
            {dateLabel} · {kill.match_stage ?? "LEC"}
          </p>
          <h3 className="font-display text-2xl md:text-3xl text-[var(--gold-bright)] line-clamp-1 drop-shadow-lg">
            {matchup}
          </h3>
          <p className="mt-1 font-display text-sm text-[var(--text-secondary)] line-clamp-1">
            {championLine}
          </p>
          {kill.ai_description && (
            <p className="mt-2.5 max-w-2xl text-sm text-[var(--text-primary)]/85 line-clamp-2 leading-snug">
              {kill.ai_description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-4 text-[11px] font-data">
            {score > 0 && (
              <span className="text-[var(--gold)]">
                IA <strong className="text-[var(--gold-bright)]">{score.toFixed(1)}</strong>/10
              </span>
            )}
            {(kill.avg_rating ?? 0) > 0 && (
              <span className="text-[var(--gold)]/80">
                ★ {(kill.avg_rating ?? 0).toFixed(1)}
                <span className="text-[var(--text-disabled)]"> · {kill.rating_count ?? 0} votes</span>
              </span>
            )}
          </div>
        </div>

        {/* Decorative corner losange */}
        <div className="pointer-events-none absolute right-4 bottom-4 z-[6] opacity-60">
          <div className="w-3 h-3 border border-[var(--gold)] rotate-45" />
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/scroll?kill=${kill.id}`}
      aria-label={`Lire le clip d'il y a ${kill.years_ago} ans : ${matchup}`}
      className="group relative shrink-0 snap-start w-[55vw] max-w-[200px] sm:w-auto sm:max-w-none overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black transition-all hover:border-[var(--gold)]/70 hover:scale-[1.02] hover:-translate-y-0.5"
      style={{ aspectRatio: "9 / 16" }}
    >
      {thumb ? (
        <Image
          src={thumb}
          alt={`Clip ${matchup}`}
          fill
          sizes="(max-width: 640px) 55vw, (max-width: 1024px) 22vw, 16vw"
          className="object-cover transition-transform duration-700 group-hover:scale-110"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
          <span className="font-display text-2xl text-[var(--gold-dark)]">KC</span>
        </div>
      )}

      {/* "Il y a N ans" chip — small */}
      {years !== null && (
        <div className="absolute left-2 top-2 z-10">
          <span className="rounded-md border border-[var(--gold)]/60 bg-black/80 backdrop-blur px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.18em] text-[var(--gold-bright)]">
            -{years} an{years > 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Score chip */}
      {score > 0 && (
        <div className="absolute right-2 top-2 z-10">
          <span className="rounded-md bg-black/80 backdrop-blur px-1.5 py-0.5 font-data text-[10px] font-bold text-[var(--gold-bright)]">
            {score.toFixed(1)}
          </span>
        </div>
      )}

      {multi && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 z-10">
          <span className="rounded-full border border-[var(--gold-bright)]/50 bg-black/70 backdrop-blur px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.18em] text-[var(--gold-bright)]">
            {multi}
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-8">
        <p className="font-display text-xs text-[var(--gold-bright)] line-clamp-1 drop-shadow-md">
          {matchup}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]/80 line-clamp-1">
          {dateLabel}
        </p>
      </div>
    </Link>
  );
}

export async function OnThisDay() {
  const { month, day } = getTodayMonthDay();
  const kills = await getOnThisDayKills(month, day, 12);

  // No historical match on this date — render nothing rather than an
  // empty placeholder. The homepage already has dense content above
  // the fold.
  if (kills.length === 0) {
    return null;
  }

  const hero = kills[0];
  const rest = kills.slice(1);

  return (
    <section className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-10">
      {/* Header */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)] mb-1.5">
            Aujourd&apos;hui · {frenchOrdinalDay()}
          </p>
          <h2 className="font-display text-3xl md:text-4xl text-[var(--gold-bright)] tracking-tight">
            Ce jour-là dans l&apos;histoire KC
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {kills.length === 1
              ? `Un kill marquant joué un ${frenchOrdinalDay()} d'une année passée.`
              : `${kills.length} kills marquants joués un ${frenchOrdinalDay()} dans les années précédentes.`}
          </p>
        </div>
        {/* Decorative gold rule */}
        <div className="hidden md:block flex-1 max-w-[200px] h-px self-end mb-3 bg-gradient-to-r from-transparent via-[var(--gold)]/30 to-transparent" />
      </div>

      {/* Hero card */}
      <MatchupCard kill={hero} hero />

      {/* Strip of additional matches */}
      {rest.length > 0 && (
        <>
          <div className="mt-6 mb-2 flex items-baseline justify-between">
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
              Autres souvenirs du jour
            </p>
            <span className="font-data text-[10px] text-[var(--text-disabled)]">
              {rest.length} kill{rest.length > 1 ? "s" : ""}
            </span>
          </div>
          <div
            className="flex sm:grid sm:grid-cols-4 lg:grid-cols-6 gap-3 overflow-x-auto sm:overflow-visible snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0"
            role="list"
          >
            {rest.map((k) => (
              <MatchupCard key={k.id} kill={k} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
