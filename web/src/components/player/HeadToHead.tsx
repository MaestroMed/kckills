/**
 * Head-to-Head section for /player/[slug].
 *
 * Wave 31a — surface the player's biggest nemesis + favourite victim with
 * a direct deep-link into /face-off so the user can see the full side-by-
 * side comparison. Hits the same RPCs the /face-off page uses
 * (getMostKilledOpponent + getMostVictimizedBy from supabase/face-off)
 * so we don't add a new DB query — the data layer already caches the
 * pair via the cache() decorator on each helper.
 *
 * Rendering :
 *   ┌────────────────────────────────┬────────────────────────────────┐
 *   │   ⚔  Sa victime préférée       │   💀  Sa nemesis                │
 *   │   {ign}                        │   {ign}                        │
 *   │   {count} kills · {champion}   │   {count} morts · {champion}   │
 *   │   → Voir le duel               │   → Voir le duel               │
 *   └────────────────────────────────┴────────────────────────────────┘
 *
 * Both cards are clickable Links. We use the player's slug + opponent's
 * IGN as face-off slugs — face-off matches by ilike(ign) so case is OK.
 *
 * Accessibility :
 *   - Each card is wrapped in <Link> with aria-label that combines the
 *     icon meaning + opponent name (e.g. "Voir le duel Caliste vs
 *     Mikyx").
 *   - The icon emoji is aria-hidden because the heading text already
 *     describes the metric.
 */

import Link from "next/link";

import {
  getMostKilledOpponent,
  getMostVictimizedBy,
} from "@/lib/supabase/face-off";

interface HeadToHeadProps {
  playerSlug: string;
  /** Display name — used to build the /face-off deep-link. */
  playerName: string;
}

export async function HeadToHead({ playerSlug, playerName }: HeadToHeadProps) {
  // Both calls in parallel — the data layer's cache() makes the second
  // call free if the same RPC fires later in the render tree.
  const [mostKilled, victimizedBy] = await Promise.all([
    getMostKilledOpponent(playerSlug),
    getMostVictimizedBy(playerSlug),
  ]);

  // Render nothing if both are missing — saves layout space + avoids an
  // empty section with confusing dashes.
  if (!mostKilled && !victimizedBy) return null;

  const playerSlugLow = encodeURIComponent(playerName.toLowerCase());

  return (
    <section
      className="relative max-w-7xl mx-auto px-6 py-12"
      aria-labelledby="player-head-to-head-heading"
    >
      <h2
        id="player-head-to-head-heading"
        className="font-display text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-6"
      >
        Head-to-head
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        {mostKilled ? (
          <Card
            label="Sa victime préférée"
            icon="⚔"
            iconColor="var(--gold)"
            opponentIgn={mostKilled.victim_ign}
            opponentChampion={mostKilled.victim_champion}
            count={mostKilled.count}
            countLabel="kills"
            deeplinkA={playerSlugLow}
            deeplinkB={encodeURIComponent(mostKilled.victim_ign.toLowerCase())}
            cta="Voir le duel"
          />
        ) : (
          <Placeholder label="Sa victime préférée" />
        )}

        {victimizedBy ? (
          <Card
            label="Sa nemesis"
            icon="💀"
            iconColor="var(--red)"
            opponentIgn={victimizedBy.victim_ign}
            opponentChampion={victimizedBy.victim_champion}
            count={victimizedBy.count}
            countLabel="morts"
            deeplinkA={playerSlugLow}
            deeplinkB={encodeURIComponent(victimizedBy.victim_ign.toLowerCase())}
            cta="Voir le duel"
          />
        ) : (
          <Placeholder label="Sa nemesis" />
        )}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Internals
// ════════════════════════════════════════════════════════════════════

interface CardProps {
  label: string;
  icon: string;
  iconColor: string;
  opponentIgn: string;
  opponentChampion: string | null;
  count: number;
  countLabel: string;
  deeplinkA: string;
  deeplinkB: string;
  cta: string;
}

function Card({
  label,
  icon,
  iconColor,
  opponentIgn,
  opponentChampion,
  count,
  countLabel,
  deeplinkA,
  deeplinkB,
  cta,
}: CardProps) {
  return (
    <Link
      href={`/face-off?a=${deeplinkA}&b=${deeplinkB}`}
      aria-label={`${cta} contre ${opponentIgn}`}
      className="group block rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 transition-all hover:scale-[1.01] hover:border-[var(--gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] motion-reduce:hover:scale-100 motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
            {label}
          </p>
          <p className="mt-2 font-display text-3xl font-black text-[var(--text-primary)] truncate">
            {opponentIgn}
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            <span
              className="font-data text-base font-bold tabular-nums"
              style={{ color: iconColor }}
            >
              {count}
            </span>{" "}
            {countLabel}
            {opponentChampion ? (
              <>
                {" · "}
                <span className="text-[var(--text-muted)]">
                  {opponentChampion}
                </span>
              </>
            ) : null}
          </p>
          <p className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] group-hover:text-[var(--gold)]">
            {cta}
            <span aria-hidden>→</span>
          </p>
        </div>
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-3xl"
          style={{
            backgroundColor: `${iconColor}1a`,
            border: `1px solid ${iconColor}55`,
          }}
        >
          {icon}
        </span>
      </div>
    </Link>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 opacity-60">
      <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-sm italic text-[var(--text-muted)]">
        Pas encore assez de data pour ce duel.
      </p>
    </div>
  );
}
