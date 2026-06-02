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

import { Film, Clock, Link2 } from "lucide-react";

import { getPublishedKills } from "@/lib/supabase/kills";
import { pickAssetUrl } from "@/lib/kill-assets";
import { Breadcrumb } from "@/components/Breadcrumb";
import { CompilationBuilder } from "./CompilationBuilder";
import type { BuilderKill } from "./CompilationBuilder";

export const revalidate = 600;

export const metadata = {
  title: "Compilation Builder",
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
      {/* ─── HERO — cinematic full-bleed band ─────────────────────── */}
      <section
        className="relative overflow-hidden border-b border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(200,170,110,0.18) 0%, transparent 60%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
        }}
      >
        {/* Scanline overlay — matches the homepage + /vs hero */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />
        {/* Floating gold rhombus accents */}
        <div
          aria-hidden
          className="absolute left-[5%] top-10 hidden md:block"
          style={{
            width: 14,
            height: 14,
            transform: "rotate(45deg)",
            background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
            opacity: 0.55,
            boxShadow: "0 0 22px rgba(200,170,110,0.5)",
          }}
        />
        <div
          aria-hidden
          className="absolute right-[7%] top-24 hidden md:block"
          style={{
            width: 9,
            height: 9,
            transform: "rotate(45deg)",
            background: "var(--gold)",
            opacity: 0.4,
            boxShadow: "0 0 14px rgba(200,170,110,0.4)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-6xl px-5 pt-10 pb-9 md:pt-16 md:pb-12 text-center">
          <div className="flex justify-center">
            <Breadcrumb
              items={[
                { label: "Accueil", href: "/" },
                { label: "Compilation" },
              ]}
            />
          </div>

          <p className="mt-8 flex items-center justify-center gap-2.5 font-data text-[11px] uppercase tracking-[0.4em] text-[var(--gold)]/70">
            <span
              aria-hidden
              className="inline-block"
              style={{
                width: 8,
                height: 8,
                transform: "rotate(45deg)",
                background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                boxShadow: "0 0 10px rgba(200,170,110,0.5)",
              }}
            />
            Studio de montage KC
          </p>
          <h1
            className="mt-3 font-display font-black tracking-tight leading-[0.9] text-5xl md:text-7xl lg:text-[7rem]"
            style={{ letterSpacing: "-0.015em" }}
          >
            <span className="text-shimmer">COMPILATION</span>
          </h1>
          <p className="mt-5 mx-auto max-w-2xl text-base md:text-lg text-[var(--text-muted)] font-medium">
            Choisis 3 à 10 clips, réordonne-les, ajoute une intro et un outro.
            Notre pipeline assemble le MP4 1080p en quelques minutes et te donne
            un lien partageable.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <SpecChip icon={<Film className="size-3.5" aria-hidden />} accent="var(--gold)">
              1080p H.264
            </SpecChip>
            <SpecChip icon={<Clock className="size-3.5" aria-hidden />} accent="var(--cyan)">
              Rendu 2–5 min
            </SpecChip>
            <SpecChip icon={<Link2 className="size-3.5" aria-hidden />} accent="var(--blue-kc)">
              Lien court /c/…
            </SpecChip>
          </div>
        </div>
      </section>

      {/* ───── Wizard ─────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pb-16">
        <CompilationBuilder pool={pool} />
      </div>
    </div>
  );
}

/** Hero spec pill — gold-bordered glass chip with a lucide mark. */
function SpecChip({
  icon,
  accent,
  children,
}: {
  icon: React.ReactNode;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-black/30 px-3 py-1.5 font-data text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)] backdrop-blur-sm"
      style={{ borderColor: `${accent}40` }}
    >
      <span style={{ color: accent }}>{icon}</span>
      {children}
    </span>
  );
}
