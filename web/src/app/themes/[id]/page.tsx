/**
 * Aperçu plein écran d'un thème d'accueil (galerie /themes) : le vrai hero de
 * l'accueil, ses étendards 3D (le header les monte sur /themes/*) et sa
 * musique. Page cachée (lib/hidden-routes).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentRoster, getMatchesSorted } from "@/lib/real-data";
import { getRealData } from "@/lib/real-data-server";
import { HomeHero } from "@/components/home/HomeHero";
import { findHomeTheme, GALLERY_THEMES, toClientTheme } from "@/lib/home-themes";

export const metadata: Metadata = { title: "Aperçu de thème", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ThemePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const theme = findHomeTheme(id);
  if (!theme) notFound();
  const data = await getRealData();
  const i = GALLERY_THEMES.findIndex((t) => t.id === id);
  const prev = GALLERY_THEMES[(i - 1 + GALLERY_THEMES.length) % GALLERY_THEMES.length];
  const next = GALLERY_THEMES[(i + 1) % GALLERY_THEMES.length];

  return (
    <div
      className="-mt-6"
      data-home-theme={theme.id}
      data-home-theme-json={JSON.stringify(toClientTheme(theme))}
      style={{
        ["--theme-primary" as string]: theme.palette.primary,
        ["--theme-accent" as string]: theme.palette.accent,
        ["--theme-glow" as string]: theme.palette.glow,
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      <HomeHero theme={theme} roster={getCurrentRoster(data)} allMatches={getMatchesSorted(data)} preview />
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-6 font-data text-xs uppercase tracking-[0.2em]">
        <Link href={`/themes/${prev.id}`} className="text-white/60 hover:text-[var(--gold)]">← {prev.label}</Link>
        <Link href="/themes" className="text-[var(--gold)]">Galerie</Link>
        <Link href={`/themes/${next.id}`} className="text-white/60 hover:text-[var(--gold)]">{next.label} →</Link>
      </nav>
    </div>
  );
}
