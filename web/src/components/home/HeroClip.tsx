import Link from "next/link";
import { getKillById, getTopRecentKcKill, type PublishedKillRow } from "@/lib/supabase/kills";
import { createCachedAnonSupabase } from "@/lib/supabase/server";
import { getTrackedRoster } from "@/lib/supabase/players";
import { resolveOpponentFromCodes } from "@/lib/team-display";
import { championDisplayName } from "@/lib/constants";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";
import { getStaticT } from "@/lib/i18n/server-lang";
import { HeroClipPlayer } from "./HeroClipPlayer";

/**
 * HeroClip — le clip en tête de l'accueil (2026-09-24, accueil « clips
 * d'abord » : KCKILLS est un site de clips, pas de stats). Remplace, dans la
 * colonne droite du hero, les cartes « carrière » (kills, V/D, winrate) et
 * « top scorer », et l'ancien bloc « Kill of the week » plus bas.
 *
 * Choix, dans l'ordre :
 *   1. clip vedette du jour (featured_clips, posé depuis /admin/featured) ;
 *   2. meilleur kill KC des matchs des 7 derniers jours (« clip de la semaine ») ;
 *   3. … des 45 derniers jours (« clip du moment », intersaison) ;
 *   4. meilleur kill KC de tout le catalogue (« clip culte »).
 */

type Pick = { kill: PublishedKillRow; labelKey: string };

async function featuredToday(): Promise<PublishedKillRow | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await createCachedAnonSupabase()
      .from("featured_clips")
      .select("kill_id")
      .eq("feature_date", today)
      .maybeSingle();
    return data?.kill_id ? await getKillById(data.kill_id, { buildTime: true }) : null;
  } catch {
    return null;
  }
}

async function pickHeroClip(): Promise<Pick | null> {
  const featured = await featuredToday();
  if (featured) return { kill: featured, labelKey: "p6_home2.featured_clip_of_day" };
  for (const [days, labelKey] of [
    [7, "p_home.hero_clip_week"],
    [45, "p_home.hero_clip_moment"],
    [3650, "p_home.hero_clip_legend"],
  ] as const) {
    const kill = await getTopRecentKcKill(days);
    if (kill) return { kill, labelKey };
  }
  return null;
}

export async function HeroClip() {
  const [pick, roster] = await Promise.all([pickHeroClip(), getTrackedRoster()]);
  const poster = pick?.kill.thumbnail_url;
  if (!pick || !poster) return null;
  const { t } = getStaticT();
  const { kill } = pick;
  const killer = roster.find((p) => p.id === kill.killer_player_id)?.ign ?? null;
  const match = kill.games?.matches ?? null;
  const opponent = resolveOpponentFromCodes(match?.team_blue_code, match?.team_red_code);
  const date = match?.scheduled_at
    ? new Date(match.scheduled_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : null;
  const gt = kill.game_time_seconds ?? 0;
  const chrono = `${Math.floor(gt / 60)}:${String(gt % 60).padStart(2, "0")}`;
  const killerChamp = championDisplayName(kill.killer_champion);
  const victimChamp = championDisplayName(kill.victim_champion);
  const title = `${killer ?? killerChamp} → ${victimChamp}`;
  const alt = `${killer ? `${killer} (${killerChamp})` : killerChamp} élimine ${victimChamp}`;

  return (
    <Link
      href={`/scroll?kill=${kill.id}`}
      className="group relative flex overflow-hidden rounded-xl border border-[var(--gold)]/20 bg-black/55 backdrop-blur-md transition-colors hover:border-[var(--gold)]/50"
    >
      {/* Vignette verticale compacte (24/09 : « plus subtil », la grande
          carte 4:5 prenait la moitié du hero sur desktop). */}
      <div className="relative aspect-[9/16] w-24 shrink-0 overflow-hidden">
        <HeroClipPlayer src={kill.clip_url_vertical_low ?? kill.clip_url_vertical} poster={poster} alt={alt} />
        <div className="absolute inset-0 flex items-center justify-center md:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--gold)]/60 bg-black/50">
            <svg className="h-4 w-4 translate-x-0.5 text-[var(--gold)]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3">
        <span className="flex items-center gap-2 font-data text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--gold)]">
          {t(pick.labelKey)}
          {kill.multi_kill && (
            <span className="rounded bg-[var(--orange)] px-1.5 py-px text-[9px] font-black tracking-widest text-black">
              {kill.multi_kill}
            </span>
          )}
        </span>
        <p className="font-display text-base font-black leading-tight text-white">{title}</p>
        {isDescriptionClean(kill.ai_description) && (
          <p className="line-clamp-2 text-xs italic text-white/75">« {kill.ai_description} »</p>
        )}
        <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {[opponent ? `vs ${opponent}` : null, date, `T+${chrono}`].filter(Boolean).join(" · ")}
        </p>
        <span className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-widest text-[var(--gold)] group-hover:text-[var(--gold-bright)]">
          {t("p_home.hero_watch_scroll")} →
        </span>
      </div>
    </Link>
  );
}
