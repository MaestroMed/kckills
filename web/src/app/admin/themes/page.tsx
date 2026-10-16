import type { Metadata } from "next";
import { GALLERY_THEMES, HOME_THEMES, activeHomeTheme } from "@/lib/home-themes";
import { fetchNextKcMatch } from "@/lib/next-match-server";
import { getHomeThemeSetting } from "@/lib/home-theme-settings";
import { adminPageDb } from "@/lib/admin/db";
import { ThemeControl, type ThemeOption } from "./theme-control";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thèmes d'accueil — Admin", robots: { index: false, follow: false } };

export default async function AdminThemesPage() {
  await adminPageDb(); // contrôle admin
  const [setting, next] = await Promise.all([getHomeThemeSetting(), fetchNextKcMatch().catch(() => null)]);
  const auto = activeHomeTheme(new Date(), null, next);
  const all = [...HOME_THEMES, ...GALLERY_THEMES.filter((g) => !HOME_THEMES.some((h) => h.id === g.id))];
  const options: ThemeOption[] = all.map((t) => ({
    id: t.id,
    label: t.label,
    kicker: t.kicker,
    primary: t.palette.primary,
    accent: t.palette.accent,
    rival: t.palette.rival ?? null,
    when: t.spotlight?.kickoffISO ?? null,
  }));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Thèmes de l&apos;accueil</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          Par défaut l&apos;accueil choisit seul : le thème du prochain match de KC dès 20 h avant le coup d&apos;envoi, sinon un thème daté,
          sinon le thème maison. Ici tu peux forcer un thème, pour une durée ou jusqu&apos;à nouvel ordre. L&apos;accueil se régénère tout de
          suite.
        </p>
      </header>
      <ThemeControl options={options} forcedId={setting.forceId} until={setting.until} autoId={auto.id} autoLabel={auto.label} />
    </div>
  );
}
