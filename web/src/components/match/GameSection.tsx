import Image from "next/image";
import Link from "next/link";
import { championIconUrl } from "@/lib/constants";
import { pickAssetUrl } from "@/lib/kill-assets";
import type { PublishedKillRow } from "@/lib/supabase/kills";
import type { MatchGame, MatchGameParticipant } from "@/lib/supabase/match";
import { KDAChart, type KDAChartPlayer } from "@/app/match/[slug]/KDAChart";

/**
 * GameSection — per-game premium block under the timeline header.
 *
 *   - Header : Game N · duration · KC win/loss · patch · side.
 *   - Picks bar : 5 KC + 5 opponent champion icons (left/right groups).
 *   - KDAChart (cumulative kills over time).
 *   - Top-5 highlight feed : the 5 highest-scored kills of this game,
 *     rendered as a horizontal scroll strip.
 *
 * The interactive scrubbable timeline + side panel are owned by the
 * page-level `MatchTimeline` (which wraps every game). GameSection
 * focuses on the secondary "what happened in this game" view.
 *
 * Server component — interactivity is delegated to KDAChart (client)
 * and the kill mini-feed (links).
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface GameSectionProps {
  game: MatchGame;
  /** All kills of THIS game, sorted by game_time_seconds. */
  kills: PublishedKillRow[];
  /** True when this is a KC win. */
  kcWon: boolean | null;
  /** 3-letter opponent code, used in alt-text + side labels. */
  opponentCode: string;
  /** KC team UUID (when known) — used to split participants into KC vs
   *  opponent in the picks bar. */
  kcTeamId: string | null;
  /** Anchor id for the scrollIntoView() trigger from the game pills. */
  anchorId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatMinSec(seconds: number | null): string {
  if (seconds == null) return "—";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function topFive(kills: PublishedKillRow[]): PublishedKillRow[] {
  return [...kills]
    .filter((k) => (k.highlight_score ?? 0) > 0)
    .sort((a, b) => (b.highlight_score ?? 0) - (a.highlight_score ?? 0))
    .slice(0, 5);
}

function chartPlayers(
  game: MatchGame,
  kcTeamId: string | null,
): KDAChartPlayer[] {
  if (game.participants.length === 0) {
    // Fallback : derive from kills (worker hasn't filled game_participants
    // yet). We can at least surface the champions split by KC vs opp.
    return [];
  }
  return game.participants.map((p) => ({
    ign: p.playerIgn,
    champion: p.champion,
    side: p.teamId === kcTeamId ? "kc" : "opp",
    kdaLabel: `${p.kills}/${p.deaths}/${p.assists}`,
  }));
}

// ─── Component ────────────────────────────────────────────────────────

export function GameSection({
  game,
  kills,
  kcWon,
  opponentCode,
  kcTeamId,
  anchorId,
}: GameSectionProps) {
  const players = chartPlayers(game, kcTeamId);
  const kcParts = game.participants.filter((p) => p.teamId === kcTeamId);
  const oppParts = game.participants.filter(
    (p) => p.teamId !== kcTeamId && p.teamId != null,
  );
  const kcSide = kcParts[0]?.side ?? null;
  const oppSide = oppParts[0]?.side ?? null;
  const top = topFive(kills);

  return (
    <article
      id={anchorId}
      aria-label={`Section Game ${game.number}`}
      className="scroll-mt-32 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden"
    >
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-gold)] bg-[var(--bg-primary)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-display text-base font-black uppercase tracking-widest text-[var(--gold)]">
            Game {game.number}
          </span>
          <span className="font-data text-[11px] text-[var(--text-muted)]">
            {formatMinSec(game.durationSeconds)}
          </span>
          {kcWon !== null && (
            <span
              className={`rounded-full border px-2 py-0.5 font-data text-[10px] font-bold uppercase tracking-widest ${
                kcWon
                  ? "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)]"
                  : "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]"
              }`}
            >
              {kcWon ? "KC Win" : "KC Loss"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {game.patch && (
            <span className="font-data text-[var(--cyan)]">{game.patch}</span>
          )}
          {kcSide && (
            <span>
              KC side <span className="font-bold text-[var(--gold)]">{kcSide}</span>
            </span>
          )}
        </div>
      </header>

      {/* Picks bar */}
      {(kcParts.length > 0 || oppParts.length > 0) && (
        <div
          className="flex items-center justify-between gap-3 border-b border-[var(--border-gold)] bg-[var(--bg-elevated)]/40 px-4 py-3"
          aria-label="Picks de la game"
        >
          <PickGroup
            label="KC"
            accent="gold"
            side={kcSide}
            participants={kcParts}
          />
          <span aria-hidden className="font-display text-xs text-[var(--text-disabled)]">
            VS
          </span>
          <PickGroup
            label={opponentCode}
            accent="red"
            side={oppSide}
            participants={oppParts}
            alignRight
          />
        </div>
      )}

      {/* KDA chart */}
      {players.length > 0 && (
        <div className="border-b border-[var(--border-gold)] bg-[var(--bg-primary)]/40 p-4">
          <p className="mb-3 font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
            Évolution des kills · cliquez sur un joueur pour masquer la ligne
          </p>
          <KDAChart
            gameNumber={game.number}
            durationSeconds={game.durationSeconds}
            players={players}
            kills={kills}
          />
        </div>
      )}

      {/* Top 5 highlights */}
      {top.length > 0 && (
        <div className="space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
              Top {top.length} highlights de la game
            </p>
            <Link
              href={`/scroll?gameId=${game.externalId}`}
              className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]"
            >
              Voir tous ›
            </Link>
          </div>
          <div className="-mx-4 grid grid-flow-col auto-cols-[78%] gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory sm:grid-flow-row sm:grid-cols-3 sm:auto-cols-auto sm:overflow-visible sm:px-0 sm:mx-0 lg:grid-cols-5">
            {top.map((k) => (
              <MiniHighlightCard key={k.id} kill={k} opponentCode={opponentCode} />
            ))}
          </div>
        </div>
      )}

      {/* No-clip fallback */}
      {top.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          Pas encore de clips publiés pour cette game — le pipeline est en route.
        </div>
      )}
    </article>
  );
}

// ─── Pick group ───────────────────────────────────────────────────────

function PickGroup({
  label,
  accent,
  side,
  participants,
  alignRight,
}: {
  label: string;
  accent: "gold" | "red";
  side: "blue" | "red" | null;
  participants: MatchGameParticipant[];
  alignRight?: boolean;
}) {
  const dotColor =
    side === "blue" ? "bg-blue-400" : side === "red" ? "bg-red-400" : "bg-white/40";
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-3 ${alignRight ? "flex-row-reverse" : ""}`}
    >
      <div className={`flex flex-col gap-0.5 ${alignRight ? "text-right" : "text-left"}`}>
        <span
          className={`font-display text-sm font-black uppercase tracking-widest ${
            accent === "gold" ? "text-[var(--gold)]" : "text-[var(--red)]"
          }`}
        >
          {label}
        </span>
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden />
          {side ? `Côté ${side}` : "—"}
        </span>
      </div>
      <div className={`flex flex-1 items-center gap-1 ${alignRight ? "flex-row-reverse" : ""}`}>
        {participants.slice(0, 5).map((p) => (
          <Link
            key={`${p.participantId}-${p.champion}`}
            href={`/player/${encodeURIComponent(p.playerIgn)}`}
            className="group relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] transition-all hover:border-[var(--gold)]/60 hover:scale-110 sm:h-10 sm:w-10"
            title={`${p.playerIgn} · ${p.champion} · ${p.kills}/${p.deaths}/${p.assists}`}
            aria-label={`${p.playerIgn} a joué ${p.champion} : KDA ${p.kills}/${p.deaths}/${p.assists}`}
          >
            <Image
              src={championIconUrl(p.champion)}
              alt={p.champion}
              fill
              sizes="40px"
              className="object-cover"
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-1 text-center font-data text-[8px] leading-tight text-[var(--text-primary)] opacity-0 transition-opacity group-hover:opacity-100">
              {p.kills}/{p.deaths}/{p.assists}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Mini highlight card (top 5) ──────────────────────────────────────

function MiniHighlightCard({
  kill,
  opponentCode,
}: {
  kill: PublishedKillRow;
  opponentCode: string;
}) {
  const thumb = pickAssetUrl(kill, "thumbnail");
  const score = kill.highlight_score?.toFixed(1) ?? "—";
  const isKc = kill.tracked_team_involvement === "team_killer";
  return (
    <Link
      href={`/kill/${kill.id}`}
      className="group relative block snap-start overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black transition-all hover:border-[var(--gold)]/60 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--gold)]/10"
      style={{ aspectRatio: "9 / 16" }}
      aria-label={`Clip : ${kill.killer_champion ?? "?"} élimine ${kill.victim_champion ?? "?"} à T+${formatMinSec(kill.game_time_seconds)}`}
    >
      {thumb ? (
        <Image
          src={thumb}
          alt=""
          fill
          sizes="(max-width: 640px) 78vw, 240px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
          <span className="font-display text-2xl text-[var(--gold-dark)]">KC</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

      {/* Chips */}
      <div className="absolute right-2 top-2 z-10">
        <span className="rounded-md bg-black/75 backdrop-blur px-1.5 py-0.5 font-data text-[10px] font-bold text-[var(--gold-bright)]">
          {score}
        </span>
      </div>
      <div className="absolute left-2 top-2 z-10">
        <span
          className={`rounded-md backdrop-blur px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-widest ${
            isKc
              ? "bg-[var(--gold)]/85 text-black"
              : "bg-[var(--red)]/85 text-white"
          }`}
        >
          {isKc ? "KC" : opponentCode}
        </span>
      </div>
      {(kill.multi_kill || kill.is_first_blood) && (
        <div className="absolute left-2 right-2 top-9 z-10 flex flex-wrap items-center justify-center gap-1">
          {kill.multi_kill && (
            <span className="rounded-full border border-[var(--gold-bright)]/60 bg-black/70 backdrop-blur px-2 py-0.5 font-display text-[9px] uppercase tracking-widest text-[var(--gold-bright)]">
              {kill.multi_kill}
            </span>
          )}
          {kill.is_first_blood && (
            <span className="rounded-full bg-[var(--red)]/90 px-2 py-0.5 font-data text-[8px] font-bold uppercase tracking-widest text-white">
              First Blood
            </span>
          )}
        </div>
      )}

      {/* Bottom matchup */}
      <div className="absolute inset-x-0 bottom-0 z-[5] p-2.5">
        <p className="font-data text-[8px] uppercase tracking-widest text-[var(--gold)]/85">
          T+{formatMinSec(kill.game_time_seconds)}
        </p>
        <p className="mt-0.5 font-display text-xs font-bold text-white line-clamp-1 drop-shadow-md">
          {kill.killer_champion ?? "?"} → {kill.victim_champion ?? "?"}
        </p>
      </div>
    </Link>
  );
}
