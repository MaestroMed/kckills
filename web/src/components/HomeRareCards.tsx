import Link from "next/link";
import { ClipCard } from "@/components/tcg/ClipCard";
import { computeRarity } from "@/lib/tcg/rarity";
import { getPublishedKills } from "@/lib/supabase/kills";

/**
 * Homepage strip — surfaces the 4 rarest cards as a TCG showcase.
 *
 * Pulls a generous slice (top 50 by highlight) then re-ranks by the
 * computed TCG rarity score (highlight + multi-kill + first-blood +
 * fight context, see `lib/tcg/rarity.ts`). Keeps the homepage's
 * "discovery > algorithm" feel: even on a slow news week the visual
 * layer makes a clip feel like an artefact.
 *
 * Server component — no client JS shipped beyond the existing ClipCard
 * primitive. Falls back to nothing if the DB is unreachable so the
 * homepage never crashes on a Supabase blip.
 */
export async function HomeRareCards() {
  const all = await getPublishedKills(50);
  if (all.length === 0) return null;

  const ranked = all
    .filter((k) => !!k.thumbnail_url && k.kill_visible !== false)
    .map((k) => {
      const rarity = computeRarity({
        highlightScore: k.highlight_score,
        avgRating: k.avg_rating,
        ratingCount: k.rating_count,
        multiKill: k.multi_kill,
        isFirstBlood: k.is_first_blood,
        trackedTeamInvolvement: k.tracked_team_involvement,
        fightType: k.fight_type,
      });
      return { kill: k, rarity };
    })
    .sort((a, b) => b.rarity.score - a.rarity.score)
    .slice(0, 4);

  if (ranked.length === 0) return null;

  return (
    <section className="relative py-16 md:py-20">
      <div className="px-4 md:px-8 max-w-7xl mx-auto mb-10 text-center">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-3">
          Cartes du moment
        </p>
        <h2 className="font-display text-4xl md:text-5xl font-black mb-4">
          <span className="text-shimmer">CARTES L&Eacute;GENDAIRES</span>
        </h2>
        <p className="max-w-2xl mx-auto text-sm md:text-base text-white/65 leading-relaxed">
          Chaque clip est un artefact. Raret&eacute; calcul&eacute;e depuis le score IA, le multi-kill,
          le contexte du fight. Les 4 cartes les mieux not&eacute;es du backlog
          actuel &mdash; mises &agrave; jour live au fil des matchs.
        </p>
      </div>

      <div className="px-4 md:px-8 max-w-7xl mx-auto">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ranked.map(({ kill }) => (
            <ClipCard
              key={kill.id}
              variant="portrait"
              signals={{
                id: kill.id,
                killerChampion: kill.killer_champion,
                victimChampion: kill.victim_champion,
                thumbnailUrl: kill.thumbnail_url,
                aiDescription: kill.ai_description,
                highlightScore: kill.highlight_score,
                avgRating: kill.avg_rating,
                ratingCount: kill.rating_count,
                multiKill: kill.multi_kill,
                isFirstBlood: kill.is_first_blood,
                trackedTeamInvolvement: kill.tracked_team_involvement,
                fightType: kill.fight_type,
              }}
            />
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/best"
            className="group inline-flex items-center gap-3 rounded-full border border-[var(--gold)]/35 bg-[var(--bg-surface)]/70 backdrop-blur-md px-6 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] transition-all hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/60 hover:scale-[1.02]"
          >
            Voir tous les meilleurs clips
            <svg
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
