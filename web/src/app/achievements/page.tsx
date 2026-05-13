/**
 * /achievements — BCC badge catalogue.
 *
 * Wave 31a (2026-05-14). Server shell that resolves the catalogue +
 * earned state for the current viewer (logged-in OR anonymous via
 * session_hash) and the community "recent unlocks" feed, then hands
 * everything to <AchievementsCatalog /> for the interactive grid.
 *
 * Anon callers : the page renders without a session_hash on first
 * visit ; the client component refreshes the data once it has access
 * to localStorage and can grab/create the hex hash. We don't bother
 * with a cookie because every other community surface (vs / face-off /
 * bcc) already uses localStorage and we want one source of truth.
 *
 * ISR : 60s. The evaluator runs every 5 min so 60s is comfortable
 * while still keeping the page light to regenerate.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AchievementsCatalog } from "@/components/AchievementsCatalog";
import {
  getRecentUnlocks,
  getUserAchievements,
  getUserPointsSummary,
} from "@/lib/supabase/achievements";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Badges de la BCC — KCKILLS",
  description:
    "Le catalogue complet des badges KCKILLS. Vote, commente, partage, prédis : chaque action de la BCC débloque un badge.",
  alternates: { canonical: "/achievements" },
  openGraph: {
    title: "Badges de la BCC — KCKILLS",
    description:
      "20 badges à débloquer. Commun, rare, épique, légendaire. Habitudes de la BCC.",
    type: "website",
    url: "/achievements",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Badges de la BCC — KCKILLS",
    description: "Toutes les médailles de la communauté KCKILLS.",
  },
};

export default async function AchievementsPage() {
  // First-render pass : no session hash because we're on the server with
  // no localStorage access. The client refreshes once it knows the hash.
  const [rows, recent, summary] = await Promise.all([
    getUserAchievements(null, { buildTime: true }),
    getRecentUnlocks(10, { buildTime: true }),
    getUserPointsSummary(null),
  ]);

  const breadcrumb = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Badges", url: "/achievements" },
  ]);

  return (
    <main className="relative pt-6 pb-24 min-h-[80vh]">
      <JsonLd data={breadcrumb} />

      {/* Subtle gold ribbon at the very top — same surface rhythm as
          /quotes and /face-off. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(200,170,110,0.45), transparent)",
        }}
      />

      <AchievementsCatalog
        initialRows={rows}
        initialRecent={recent}
        initialSummary={summary}
      />

      {/* Riot legal disclaimer — required on every public page
          (CLAUDE.md PARTIE 7.6). */}
      <p className="mx-auto mt-16 max-w-3xl text-center text-[10px] uppercase tracking-widest text-[var(--text-disabled)] px-6">
        Les badges récompensent l&apos;activité de la communauté KCKILLS.
        KCKILLS was created under Riot Games&apos; &laquo; Legal Jibber
        Jabber &raquo; policy using assets owned by Riot Games. Riot Games
        does not endorse or sponsor this project.{" "}
        <Link href="/privacy" className="underline hover:text-[var(--gold)]">
          Politique
        </Link>
        .
      </p>
    </main>
  );
}
