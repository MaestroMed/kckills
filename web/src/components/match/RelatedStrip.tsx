import Image from "next/image";
import Link from "next/link";
import { TEAM_LOGOS } from "@/lib/kc-assets";
import { pickAssetUrl } from "@/lib/kill-assets";
import type { PublishedKillRow } from "@/lib/supabase/kills";
import type { MatchPreviewRow } from "@/lib/supabase/match";
import type { Era } from "@/lib/eras";

/**
 * RelatedStrip — 4-card "what to read next" strip at the bottom of the
 * /match/[slug] page.
 *
 *   Card 1 — Previous KC match vs same opponent.
 *   Card 2 — Next KC match (any opponent).
 *   Card 3 — Most-rated kill of this match (thumbnail + score + score).
 *   Card 4 — Era card → /era/<id> (the LEC era this match belongs to).
 *
 * Missing data → the card surfaces a graceful empty state. A 0/4 strip
 * is replaced by a slim "Tu retournes au feed" CTA instead so we don't
 * render an empty section.
 */

export interface RelatedStripProps {
  previousVsOpponent: MatchPreviewRow | null;
  next: MatchPreviewRow | null;
  topKill: PublishedKillRow | null;
  era: Era | null;
  opponentCode: string;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMinSec(seconds: number | null): string {
  if (seconds == null) return "—";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

export function RelatedStrip({
  previousVsOpponent,
  next,
  topKill,
  era,
  opponentCode,
}: RelatedStripProps) {
  const allEmpty = !previousVsOpponent && !next && !topKill && !era;

  if (allEmpty) {
    return (
      <section
        aria-label="Lectures recommandées"
        className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]"
      >
        <Link
          href="/matches"
          className="inline-flex items-center gap-2 font-data text-[10px] uppercase tracking-widest text-[var(--gold)] hover:underline"
        >
          ◆ Retour aux matchs
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="related-heading"
      className="space-y-4"
    >
      <h2
        id="related-heading"
        className="font-display text-xl font-black uppercase tracking-widest text-[var(--gold)]"
      >
        À lire ensuite
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PreviousMatchCard match={previousVsOpponent} opponentCode={opponentCode} />
        <NextMatchCard match={next} />
        <TopKillCard kill={topKill} opponentCode={opponentCode} />
        <EraCard era={era} />
      </div>
    </section>
  );
}

// ─── Cards ────────────────────────────────────────────────────────────

function CardShell({
  href,
  kicker,
  children,
}: {
  href: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--gold)]/50 hover:-translate-y-1 hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
    >
      <span
        aria-hidden
        className="absolute top-3 right-3 text-[var(--gold)]/30 transition-colors group-hover:text-[var(--gold)]"
      >
        ◆
      </span>
      <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
        {kicker}
      </p>
      {children}
    </Link>
  );
}

function PreviousMatchCard({
  match,
  opponentCode,
}: {
  match: MatchPreviewRow | null;
  opponentCode: string;
}) {
  if (!match) {
    return (
      <div className="rounded-2xl border border-[var(--border-gold)]/40 bg-[var(--bg-surface)] p-4 opacity-50">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
          Précédent vs {opponentCode}
        </p>
        <p className="mt-3 text-sm italic text-[var(--text-muted)]">
          Première rencontre tracée — pas d&apos;historique vs cette équipe.
        </p>
      </div>
    );
  }
  return (
    <CardShell
      href={`/match/${match.externalId}`}
      kicker={`Précédent vs ${match.opponentCode}`}
    >
      <p className="mt-3 font-display text-3xl font-black tabular-nums leading-none">
        <span
          className={
            match.kcWon === true
              ? "text-[var(--gold)]"
              : match.kcWon === false
                ? "text-[var(--red)]"
                : "text-[var(--text-muted)]"
          }
        >
          {match.kcScore}
        </span>
        <span className="text-[var(--text-muted)] mx-1.5">·</span>
        <span
          className={
            match.kcWon === false
              ? "text-[var(--gold)]"
              : match.kcWon === true
                ? "text-[var(--red)]"
                : "text-[var(--text-muted)]"
          }
        >
          {match.oppScore}
        </span>
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {match.stage ?? "LEC"} · {formatShortDate(match.scheduledAt)}
      </p>
    </CardShell>
  );
}

function NextMatchCard({ match }: { match: MatchPreviewRow | null }) {
  if (!match) {
    return (
      <div className="rounded-2xl border border-[var(--border-gold)]/40 bg-[var(--bg-surface)] p-4 opacity-50">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
          Match suivant
        </p>
        <p className="mt-3 text-sm italic text-[var(--text-muted)]">
          Calendrier non publié.
        </p>
      </div>
    );
  }
  const logo = TEAM_LOGOS[match.opponentCode] ?? null;
  return (
    <CardShell
      href={`/match/${match.externalId}`}
      kicker="Match suivant"
    >
      <div className="mt-3 flex items-center gap-3">
        <div className="relative h-10 w-10 flex-shrink-0 grid place-items-center rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)]">
          {logo ? (
            <Image
              src={logo}
              alt={match.opponentName}
              width={32}
              height={32}
            />
          ) : (
            <span className="font-display text-xs font-black text-[var(--gold)]">
              {match.opponentCode}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-display text-base font-black uppercase truncate text-[var(--text-primary)]">
            vs {match.opponentCode}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            {formatShortDate(match.scheduledAt)}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

function TopKillCard({
  kill,
  opponentCode,
}: {
  kill: PublishedKillRow | null;
  opponentCode: string;
}) {
  if (!kill) {
    return (
      <div className="rounded-2xl border border-[var(--border-gold)]/40 bg-[var(--bg-surface)] p-4 opacity-50">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
          Highlight du match
        </p>
        <p className="mt-3 text-sm italic text-[var(--text-muted)]">
          Pas encore de clip noté pour ce match.
        </p>
      </div>
    );
  }
  const thumb = pickAssetUrl(kill, "thumbnail");
  const score = kill.highlight_score?.toFixed(1) ?? "—";
  const isKc = kill.tracked_team_involvement === "team_killer";
  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-black transition-all hover:border-[var(--gold)]/60 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
    >
      <div className="relative aspect-[4/3]">
        {thumb ? (
          <Image
            src={thumb}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
            <span className="font-display text-3xl text-[var(--gold-dark)]">KC</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
      </div>
      <div className="absolute top-3 left-3 z-10">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/95 drop-shadow">
          Highlight du match
        </p>
      </div>
      <div className="absolute top-3 right-3 z-10">
        <span className="rounded-md bg-black/80 backdrop-blur px-2 py-0.5 font-data text-[11px] font-bold text-[var(--gold-bright)]">
          ★ {score}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-[5] p-3">
        <p className="font-display text-sm font-black uppercase text-white line-clamp-1 drop-shadow-md">
          {kill.killer_champion ?? "?"} → {kill.victim_champion ?? "?"}
        </p>
        <p className="mt-0.5 font-data text-[9px] uppercase tracking-widest text-[var(--text-secondary)]">
          Game {kill.games?.game_number ?? "?"} · T+
          {formatMinSec(kill.game_time_seconds)} ·{" "}
          {isKc ? "KC" : opponentCode}
        </p>
      </div>
    </Link>
  );
}

function EraCard({ era }: { era: Era | null }) {
  if (!era) {
    return (
      <div className="rounded-2xl border border-[var(--border-gold)]/40 bg-[var(--bg-surface)] p-4 opacity-50">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
          Époque KC
        </p>
        <p className="mt-3 text-sm italic text-[var(--text-muted)]">
          Match hors époques tracées.
        </p>
      </div>
    );
  }
  return (
    <Link
      href={`/era/${era.id}`}
      className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] p-4 transition-all hover:border-[var(--gold)]/60 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
      style={{
        background: `linear-gradient(135deg, ${era.color}25 0%, var(--bg-surface) 80%)`,
      }}
    >
      <span
        aria-hidden
        className="absolute top-3 right-3 text-[var(--gold)]/30 transition-colors group-hover:text-[var(--gold)]"
      >
        ◆
      </span>
      <p
        className="font-data text-[10px] uppercase tracking-[0.3em] mb-1"
        style={{ color: era.color }}
      >
        Époque KC
      </p>
      <p className="font-display text-lg font-black uppercase tracking-wide text-[var(--text-primary)] line-clamp-1">
        {era.label}
      </p>
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {era.period} · {era.phase}
      </p>
      {era.result && (
        <p className="mt-2 text-[11px] text-[var(--text-secondary)] line-clamp-2">
          {era.result}
        </p>
      )}
    </Link>
  );
}
