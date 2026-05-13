/**
 * /compilation — Compilation Builder hero + wizard.
 *
 * Server component : fetches the kill picker source (top published
 * clips), then hands off to <CompilationBuilder /> which owns the
 * 3-step wizard interactively on the client.
 *
 * Rendering strategy
 * ──────────────────
 *   • `revalidate = 600` (10 min ISR). Same cadence as /scroll —
 *     the source clip pool only refreshes when new matches land, so
 *     a 10-min stale window is plenty for the picker.
 *   • Picker pool : top 200 published kills by highlight score, the
 *     same shape /scroll uses for its initial feed. Anything below
 *     the cut is reachable via the search filters on the client.
 *
 * Disclaimer note
 * ───────────────
 * /compilation lives under LayoutChrome so the global Riot Games
 * disclaimer in the footer already fires. We don't double it on the
 * page itself.
 */

import { getPublishedKills } from "@/lib/supabase/kills";
import { pickAssetUrl } from "@/lib/kill-assets";
import { CompilationBuilder } from "./CompilationBuilder";
import type { BuilderKill } from "./CompilationBuilder";

export const revalidate = 600;

export const metadata = {
  title: "Compilation Builder — KCKILLS",
  description:
    "Construis ton best-of Karmine Corp. Choisis tes clips, réordonne-les, et reçois un MP4 partageable en quelques minutes.",
  alternates: { canonical: "/compilation" },
  openGraph: {
    title: "Compilation Builder — KCKILLS",
    description:
      "Crée ta compilation Karmine Corp en quelques clics. 3 à 20 clips, intro + outro, lien de partage.",
    type: "website" as const,
    url: "/compilation",
    siteName: "KCKILLS",
    locale: "fr_FR",
    images: [
      {
        url: "/images/hero-bg.jpg",
        width: 1920,
        height: 1280,
        alt: "Compilation Builder — KCKILLS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Compilation Builder — KCKILLS",
    description: "Construis ton best-of KC en quelques clics.",
    images: ["/images/hero-bg.jpg"],
  },
};

export default async function CompilationPage() {
  // Top 200 published KC kills. We filter to team_killer = KC and
  // require a horizontal clip (the worker concatenates the 16:9
  // source). Mirrors the gates used by /scroll except we DON'T
  // need vertical clips here.
  const all = await getPublishedKills(200);

  const pool: BuilderKill[] = all
    .filter(
      (k) =>
        k.tracked_team_involvement === "team_killer" &&
        k.kill_visible !== false &&
        pickAssetUrl(k, "horizontal") !== null &&
        pickAssetUrl(k, "thumbnail") !== null,
    )
    .map((k) => ({
      id: k.id,
      killerChampion: k.killer_champion ?? null,
      victimChampion: k.victim_champion ?? null,
      killerPlayerId: k.killer_player_id ?? null,
      thumbnailUrl: pickAssetUrl(k, "thumbnail"),
      clipUrlVertical: pickAssetUrl(k, "vertical"),
      clipUrlHorizontal: pickAssetUrl(k, "horizontal"),
      multiKill: k.multi_kill ?? null,
      isFirstBlood: Boolean(k.is_first_blood),
      highlightScore: k.highlight_score ?? null,
      avgRating: k.avg_rating ?? null,
      ratingCount: k.rating_count ?? 0,
      aiDescription: k.ai_description_fr ?? k.ai_description ?? null,
      aiTags: k.ai_tags ?? [],
      matchDate: k.games?.matches?.scheduled_at ?? k.created_at,
      matchStage: k.games?.matches?.stage ?? null,
      gameNumber: k.games?.game_number ?? 1,
    }));

  return (
    <div className="-mt-6 -mx-4 px-4 pb-16">
      {/* ───── Hero ───────────────────────────────────────────── */}
      <header className="relative isolate overflow-hidden border-b border-[var(--border-gold)] py-12 sm:py-16">
        {/* Subtle hextech glow backdrop */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, rgba(10,200,185,0.10), transparent 55%), radial-gradient(circle at 80% 70%, rgba(200,170,110,0.10), transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(200,170,110,0.5), transparent)",
          }}
        />
        <div className="mx-auto max-w-5xl text-center">
          <p className="mb-3 text-[11px] uppercase tracking-[0.32em] text-[var(--gold)]/80">
            Compilation Builder
          </p>
          <h1 className="font-display text-3xl font-black tracking-tight sm:text-5xl">
            Crée ton <span className="text-[var(--gold)]">best-of</span> KC
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-[var(--text-secondary)] sm:text-base">
            Choisis 3 à 10 clips, réordonne-les, ajoute une intro et un outro. Notre
            pipeline assemble le MP4 1080p en quelques minutes et te donne un lien
            partageable.
          </p>
          <div className="mt-6 flex items-center justify-center gap-6 text-[11px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-[var(--gold)]" /> 1080p H.264
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-[var(--cyan)]" /> Rendu 2-5 min
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-[var(--blue-kc)]" /> Lien court /c/…
            </span>
          </div>
        </div>
      </header>

      {/* ───── Wizard ─────────────────────────────────────────── */}
      <CompilationBuilder pool={pool} />
    </div>
  );
}
