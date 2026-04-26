/**
 * /admin/bgm — DEPRECATED legacy BGM editor (PR-loltok EE).
 *
 * Replaced by /admin/playlists (the wolf floating player surface).
 * Kept as read-only so historical data isn't immediately inaccessible —
 * the editor below the banner reads the same JSON the new lecteur
 * consumes, but admins should migrate workflows to /admin/playlists.
 *
 * The 5-second auto-redirect lives client-side inside <BgmEditor /> via
 * a meta refresh ; this page just renders the AdminPage shell + banner +
 * legacy editor in read-only mode.
 */

import { BgmEditor } from "./bgm-editor";
import { DEFAULT_PLAYLIST } from "@/lib/scroll/bgm-playlist";
import { AdminPage } from "@/components/admin/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "BGM Playlist (déprécié) — Admin",
  robots: { index: false, follow: false },
};

export default async function BgmPage() {
  // Read current playlist via the existing /api/bgm route (or fall back
  // to default). Soft-fail — the page must render even if the API is
  // down (the user is here to be redirected anyway).
  let initial = DEFAULT_PLAYLIST;
  try {
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/bgm`,
      { cache: "no-store" },
    );
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) initial = data;
    }
  } catch {
    // fall through to default
  }

  return (
    <AdminPage
      title="BGM Playlist (déprécié)"
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "BGM (déprécié)" },
      ]}
      subtitle="Cet écran est en lecture seule. Bascule sur /admin/playlists."
    >
      {/* Big yellow deprecation banner */}
      <div
        role="alert"
        className="mb-6 rounded-2xl border-2 border-[var(--orange)]/60 bg-[var(--orange)]/10 p-5 space-y-2"
      >
        <p className="font-display text-lg font-black text-[var(--orange)] uppercase tracking-wide flex items-center gap-2">
          <span aria-hidden="true">⚠</span> Page dépréciée
        </p>
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">
          Cette page est <strong>obsolète</strong>. Utilise{" "}
          <Link
            href="/admin/playlists"
            className="text-[var(--gold)] underline hover:text-[var(--gold-bright)]"
          >
            /admin/playlists
          </Link>{" "}
          pour le nouveau lecteur wolf flottant (homepage + scroll).
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          Redirection automatique dans 5 secondes…
        </p>
      </div>

      {/* Legacy editor — read-only */}
      <BgmEditor initial={initial} readOnly />
    </AdminPage>
  );
}
