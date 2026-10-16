/**
 * Galerie des thèmes d'accueil (lib/home-themes) — page cachée
 * (lib/hidden-routes : 404 public, ouverte en dev et pour l'admin).
 *
 * Une carte par thème : les deux étendards (images de repli de chaque côté),
 * l'affiche KC contre l'adversaire, la palette, la fenêtre d'activation.
 * Cliquer ouvre l'aperçu plein écran (/themes/[id]) avec les étendards 3D.
 */
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { GALLERY_THEMES, HOME_THEMES, type HomeTheme } from "@/lib/home-themes";
import { fetchNextKcMatch } from "@/lib/next-match-server";
import { activeHomeTheme } from "@/lib/home-themes";
import { getHomeThemeOverride } from "@/lib/home-theme-settings";

export const metadata: Metadata = { title: "Thèmes de l'accueil", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const KC_LOGO = "/images/teams/KC.png";

function when(th: HomeTheme): string {
  if (!th.spotlight) return "Toute l'année, hors événement";
  if (!th.spotlight.kickoffISO) return "Automatique dès que le match est au calendrier";
  const k = new Date(th.spotlight.kickoffISO);
  return `Le ${k.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" })} à ${k.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`;
}

export default async function ThemesGallery() {
  const next = await fetchNextKcMatch().catch(() => null);
  const forced = (await getHomeThemeOverride().catch(() => null)) ?? process.env.KCKILLS_HOME_THEME;
  const live = activeHomeTheme(new Date(), forced, next);
  const groups: { title: string; items: HomeTheme[] }[] = [
    { title: "En ce moment", items: [live] },
    { title: "Datés", items: HOME_THEMES.filter((t) => t.id !== live.id) },
    { title: "Play-ins du Mondial 2026", items: GALLERY_THEMES.filter((t) => t.spotlight?.stage === "Play-ins" && t.id !== live.id && !HOME_THEMES.some((h) => h.id === t.id)) },
    { title: "Système suisse du Mondial 2026", items: GALLERY_THEMES.filter((t) => t.spotlight?.stage === "Système suisse") },
    { title: "Maison", items: GALLERY_THEMES.filter((t) => !t.spotlight && t.id !== live.id) },
  ].filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-10">
      <header className="mb-10">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">Page cachée · aperçu</p>
        <h1 className="mt-2 font-display text-4xl md:text-5xl font-black text-[var(--gold-bright)]">Thèmes de l&apos;accueil</h1>
        <p className="mt-3 max-w-2xl text-sm text-white/65">
          Un thème par événement. Les jours de match, l&apos;accueil prend tout seul le thème de l&apos;adversaire dès que le match est au calendrier
          officiel (20 h avant le coup d&apos;envoi, jusqu&apos;à 6 h après) : maillot blanc et or à gauche, étendard de l&apos;adversaire à droite,
          Warriors en premier titre. Cliquer un thème ouvre l&apos;aperçu plein écran.
        </p>
      </header>

      {groups.map((g) => (
        <section key={g.title} className="mb-12">
          <h2 className="mb-4 font-display text-lg font-black uppercase tracking-[0.18em] text-white/85">{g.title}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.items.map((th) => (
              <ThemeCard key={th.id} theme={th} active={th.id === live.id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ThemeCard({ theme, active }: { theme: HomeTheme; active: boolean }) {
  const s = theme.spotlight;
  const rival = theme.palette.rival ?? theme.palette.accent;
  return (
    <Link href={`/themes/${theme.id}`} className="theme-card group block" style={{ ["--card-rival" as string]: rival }}>
      <div className="theme-card-stage">
        {/* les deux étendards, à leurs couleurs */}
        <Image src={`${theme.banners.left.posterDir}/etendard-gauche.webp`} alt="" width={76} height={142} unoptimized className="theme-card-banner left-2" />
        <Image src={`${theme.banners.right.posterDir}/etendard-droite.webp`} alt="" width={76} height={142} unoptimized className="theme-card-banner right-2" />
        <div className="absolute inset-0 flex items-center justify-center gap-3 pt-6">
          {s ? (
            <>
              <span className="grid h-16 w-16 place-items-center rounded-2xl border-2 border-[#D9B46A] bg-gradient-to-b from-white to-[#e9e3d6] shadow-lg">
                <Image src={KC_LOGO} alt="KC" width={44} height={44} className="h-11 w-11 object-contain" />
              </span>
              <span className="font-display text-2xl font-black text-[#D9B46A]">VS</span>
              <span className="grid h-16 w-16 place-items-center rounded-2xl border-2 bg-[#0a1428] shadow-lg" style={{ borderColor: rival }}>
                <Image src={s.opponentLogo} alt={s.opponentCode} width={44} height={44} className="h-11 w-11 object-contain" />
              </span>
            </>
          ) : (
            <span className="font-display text-3xl font-black text-[var(--gold)]">KCKILLS</span>
          )}
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-base font-black text-white">{s ? `KC – ${s.opponentName}` : theme.label}</p>
          {active && <span className="rounded-full bg-[var(--green)]/15 px-2 py-0.5 font-data text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--green)]">Actif</span>}
        </div>
        <p className="mt-1 font-data text-[10px] uppercase tracking-[0.2em] text-white/55">{s ? `${s.competition} · ${s.stage} · ${s.format}` : theme.kicker}</p>
        <p className="mt-2 text-[11px] text-white/50">{when(theme)}</p>
        <div className="mt-3 flex gap-1.5" aria-label="Palette">
          {[theme.palette.primary, theme.palette.accent, rival].map((c, i) => (
            <span key={i} className="h-3 w-8 rounded-full border border-white/10" style={{ background: c }} />
          ))}
        </div>
      </div>
    </Link>
  );
}
