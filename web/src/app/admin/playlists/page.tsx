/**
 * /admin/playlists — manage homepage + scroll BGM playlists.
 *
 * Each playlist is a list of {youtubeId, title, artist, durationSeconds,
 * genre} entries. The wolf floating player picks tracks at random from
 * the matching playlist for the current route.
 *
 * Storage : a single `kc_playlists.json` file at the project root,
 * mirrored to /api/admin/playlists. Future upgrade : Supabase
 * `bgm_playlists` table for multi-operator concurrent edits.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PlaylistsEditor } from "./playlists-editor";

export const metadata = {
  title: "Playlists vibes — Admin",
};

export default async function PlaylistsAdminPage() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get("kc_admin");
  if (!adminCookie?.value) {
    redirect("/admin/login?next=/admin/playlists");
  }

  return (
    <main className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-8">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
          Backoffice · Audio
        </p>
        <h1 className="mt-1 font-display text-3xl text-[var(--gold-bright)]">
          Playlists vibes
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)] max-w-2xl">
          Gère les pistes du lecteur wolf flottant. La playlist{" "}
          <span className="text-[var(--gold)]">homepage</span> joue sur la
          landing (vibe ambient / ramp-up). La playlist{" "}
          <span className="text-[var(--gold)]">scroll</span> joue sous le
          feed TikTok-style (vibe hype / montage). Le lecteur picks au
          hasard et survit aux navigations.
        </p>
      </header>

      <PlaylistsEditor />
    </main>
  );
}
