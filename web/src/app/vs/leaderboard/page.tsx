/**
 * /vs/leaderboard — VS Roulette ELO leaderboard.
 *
 * Wave 25.3 / V59 stub. The Postgres side is ready :
 *   - `fn_top_elo_kills(p_limit, p_filter_role, p_filter_champion)` returns
 *     the top kills by ELO rating with a battles_count >= 5 gate.
 *
 * This page intentionally ships as a minimal "Coming soon" landing :
 *
 *   1. The voting data set is empty until the /vs page goes live in
 *      production for a couple of days. Rendering a leaderboard against
 *      zero rows produces a misleading first impression.
 *   2. A dedicated PR will wire the full ranked grid + role/champion
 *      filters + paginated lookup once we have enough battles in the
 *      kill_elo table to be meaningful (>= 50 per slot).
 *
 * Until then, the page is reachable from /vs (so we don't 404 on the
 * existing CTA) and explains the gating to the visitor.
 *
 * TODO (next PR after launch) :
 *   - Server-side fetch fn_top_elo_kills (limit 50)
 *   - Role + champion dropdown filters (re-query on change)
 *   - 3-column podium card for the top 3 with thumbnails + clip play on
 *     hover, then a table for ranks 4-50.
 *   - Add a "you've voted in N battles" personal stat (uses the
 *     localStorage VS session id).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "VS Leaderboard — KCKILLS",
  description:
    "Le classement ELO communautaire des meilleurs kills Karmine Corp, alimenté par la VS Roulette.",
  alternates: { canonical: "/vs/leaderboard" },
};

export default function VSLeaderboardPage() {
  const breadcrumbJsonLd = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "VS Roulette", url: "/vs" },
    { name: "Classement", url: "/vs/leaderboard" },
  ]);

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
      <JsonLd data={breadcrumbJsonLd} />

      <section
        className="relative overflow-hidden border-b border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(200,170,110,0.18) 0%, transparent 60%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-4xl px-5 pt-12 pb-12 md:pt-20 md:pb-16 text-center">
          <nav
            aria-label="Fil d'Ariane"
            className="mb-6 flex items-center justify-center gap-2 text-xs text-white/55"
          >
            <Link
              href="/"
              className="hover:text-[var(--gold)] transition-colors"
            >
              Accueil
            </Link>
            <span aria-hidden className="text-white/25">
              {"◆"}
            </span>
            <Link
              href="/vs"
              className="hover:text-[var(--gold)] transition-colors"
            >
              VS Roulette
            </Link>
            <span aria-hidden className="text-white/25">
              {"◆"}
            </span>
            <span className="text-[var(--gold)]">Classement</span>
          </nav>

          <p className="font-data text-[11px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-3">
            Classement ELO
          </p>
          <h1
            className="font-display font-black tracking-tight leading-[0.9] text-4xl md:text-6xl lg:text-7xl"
            style={{
              color: "white",
              textShadow:
                "0 0 60px rgba(200,170,110,0.45), 0 6px 30px rgba(0,0,0,0.85)",
            }}
          >
            <span className="text-shimmer">VS Leaderboard</span>
          </h1>
          <p className="mt-5 mx-auto max-w-xl text-base text-white/80">
            Le tableau classera bientôt chaque kill par son ELO
            communautaire. Pour le moment, on accumule les votes —
            reviens dans quelques jours.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/vs"
              className="rounded-xl bg-[var(--gold)] px-6 py-3 font-display text-xs font-black uppercase tracking-[0.25em] text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] transition-all"
              style={{
                boxShadow:
                  "0 14px 30px rgba(200,170,110,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
              }}
            >
              Voter sur la roulette
            </Link>
            <Link
              href="/scroll"
              className="rounded-xl border border-white/25 bg-black/30 px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/75 hover:border-white/55 hover:text-white transition-all"
            >
              Mode scroll
            </Link>
          </div>

          <div className="mt-12 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md p-6 text-left">
            <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-3">
              À venir
            </p>
            <ul className="space-y-2 text-sm text-white/75">
              <li>
                <span className="text-[var(--gold)]">◆</span> Podium top 3 avec
                clip auto-play au survol
              </li>
              <li>
                <span className="text-[var(--gold)]">◆</span> Filtres par rôle
                + champion + époque
              </li>
              <li>
                <span className="text-[var(--gold)]">◆</span> Stats perso :
                nombre de duels votés
              </li>
              <li>
                <span className="text-[var(--gold)]">◆</span> Activation au
                seuil de 50 battles par slot
              </li>
            </ul>
          </div>
        </div>
      </section>

      <p
        aria-label="Riot Games disclaimer"
        className="px-4 py-6 text-center text-[9px] uppercase tracking-widest text-white/30"
      >
        Not endorsed by Riot Games. League of Legends © Riot Games.
      </p>
    </div>
  );
}
