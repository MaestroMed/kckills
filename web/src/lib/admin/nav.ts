/**
 * Navigation de l'admin — SOURCE UNIQUE.
 *
 * Lue par la barre latérale (et son tiroir mobile), la palette ⌘K et les
 * fils d'Ariane. Avant, chacun avait sa propre liste et elles avaient
 * divergé (pages absentes de la barre, BGM supprimé encore listé…).
 * Une page admin ajoutée ici apparaît partout.
 */

export interface AdminNavItem {
  href: string;
  label: string;
  icon: string;
  /** Mots-clés de la palette ⌘K, en plus du libellé. */
  keywords: string;
  /** Pastille optionnelle à droite du libellé (compteur, « new »). */
  badge?: string;
}

export interface AdminNavGroup {
  id: string;
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: "overview",
    label: "Vue d'ensemble",
    items: [
      { href: "/admin", label: "Tableau de bord", icon: "▣", keywords: "dashboard live ops accueil kpi" },
      { href: "/admin/search", label: "Recherche", icon: "⌕", keywords: "search recherche global kill match job" },
    ],
  },
  {
    id: "content",
    label: "Contenu",
    items: [
      { href: "/admin/clips", label: "Clips", icon: "▶", keywords: "clips library bibliotheque kills" },
      { href: "/admin/editorial", label: "Éditorial", icon: "✦", keywords: "editorial curation masquer discord" },
      { href: "/admin/featured", label: "Clip du jour", icon: "★", keywords: "featured spotlight jour une" },
      { href: "/admin/playlists", label: "Playlists", icon: "♬", keywords: "playlists musique lecteur audio wolf" },
      { href: "/admin/hero-videos", label: "Vidéos du hero", icon: "◫", keywords: "hero videos accueil" },
      { href: "/admin/push", label: "Notifications push", icon: "✉", keywords: "push notifications broadcast envoyer" },
    ],
  },
  {
    id: "moderation",
    label: "Modération",
    items: [
      { href: "/admin/moderation", label: "Commentaires", icon: "✎", keywords: "moderation comments commentaires haiku" },
      { href: "/admin/moderation/reports", label: "Signalements", icon: "⚠", keywords: "reports signalements" },
    ],
  },
  {
    id: "community",
    label: "Communauté",
    items: [
      { href: "/admin/community", label: "Vue communauté", icon: "◇", keywords: "community hub communaute" },
      { href: "/admin/community/bracket", label: "Bracket", icon: "▦", keywords: "bracket tournoi" },
      { href: "/admin/community/face-off", label: "Face-off", icon: "⚔", keywords: "face off duel vs" },
      { href: "/admin/community/compilations", label: "Compilations", icon: "▸", keywords: "compilations montage" },
      { href: "/admin/community/quotes", label: "Citations", icon: "❝", keywords: "quotes citations" },
      { href: "/admin/community/achievements", label: "Succès", icon: "◆", keywords: "achievements succes badges" },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    items: [
      { href: "/admin/pipeline", label: "État du worker", icon: "◉", keywords: "pipeline daemon worker status heartbeat" },
      { href: "/admin/pipeline/jobs", label: "Jobs", icon: "⚙", keywords: "jobs queue file attente worker_jobs" },
      { href: "/admin/pipeline/dlq", label: "Échecs (DLQ)", icon: "☠", keywords: "dlq dead letter echec failed" },
      { href: "/admin/pipeline/rate", label: "Débit", icon: "≋", keywords: "rate debit throughput vitesse" },
      { href: "/admin/pipeline/trigger", label: "Lancer un job", icon: "⚡", keywords: "trigger lancer job" },
      { href: "/admin/pipeline/run", label: "Scripts", icon: "▷", keywords: "run scripts backfill manual" },
      { href: "/admin/ledger", label: "Registre des clips", icon: "▤", keywords: "ledger registre clips" },
    ],
  },
  {
    id: "data",
    label: "Données",
    items: [
      { href: "/admin/roster", label: "Roster", icon: "●", keywords: "roster joueurs players" },
      { href: "/admin/analytics", label: "Analytics", icon: "▲", keywords: "analytics stats metriques" },
      { href: "/admin/audit", label: "Journal admin", icon: "◎", keywords: "audit log journal actions historique" },
      { href: "/admin/perf", label: "Web Vitals", icon: "♡", keywords: "perf performance web vitals lcp inp cls" },
    ],
  },
  {
    id: "lab",
    label: "Labo",
    items: [{ href: "/admin/lab", label: "Expériences", icon: "⚗", keywords: "lab experiments evaluations" }],
  },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

const SEGMENT_FALLBACK: Record<string, string> = {
  admin: "Admin",
  clips: "Clips",
  jobs: "Jobs",
  community: "Communauté",
  pipeline: "Pipeline",
  moderation: "Modération",
};

/** Fil d'Ariane d'un chemin admin : libellés de la navigation, identifiants raccourcis. */
export function adminCrumbs(pathname: string): { label: string; href: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  const out: { label: string; href: string }[] = [];
  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    const item = ADMIN_NAV_ITEMS.find((i) => i.href === acc);
    const label =
      acc === "/admin" ? "Admin"
      : item?.label
      ?? SEGMENT_FALLBACK[p]
      ?? (/^[0-9a-f-]{8,}$/i.test(p) ? `${p.slice(0, 8)}…` : decodeURIComponent(p));
    out.push({ label, href: acc });
  }
  return out;
}
