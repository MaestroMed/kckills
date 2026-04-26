/**
 * /admin/hero-videos — curate the homepage hero rotation.
 *
 * Mehdi uploads custom MP4 montages (intros, edits, behind-the-scenes)
 * to Cloudflare R2 and they take priority over the YouTube fallback in
 * the homepage hero rotation. Each video has a title, optional context
 * subtitle, duration, audio volume, tag, and order.
 *
 * Data path :
 *   • Metadata list  → web/.cache/hero-videos.json (mirrors playlists)
 *   • Video bytes    → R2 at hero/{uuid}/{slug}.mp4 (immutable, edge-cached)
 *
 * Auth : same `kc_admin` cookie gate as the rest of the backoffice +
 * audit log on every mutation (`hero.videos.upload`, `hero.videos.update`,
 * `hero.videos.delete`).
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { HeroVideosEditor } from "./hero-editor";

export const metadata = {
  title: "Hero videos — Admin",
};

export default async function HeroVideosAdminPage() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get("kc_admin");
  if (!adminCookie?.value) {
    redirect("/admin/login?next=/admin/hero-videos");
  }

  return (
    <main className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <header className="mb-8">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
          Backoffice · Hero homepage
        </p>
        <h1 className="mt-1 font-display text-3xl text-[var(--gold-bright)]">
          Hero videos
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)] max-w-2xl">
          Tes propres montages MP4 jouent en boucle sur le hero de la
          homepage avec leur audio (si l&apos;utilisateur a activ&eacute; le
          son via le wolf player). Ils passent <strong>avant</strong> les
          embeds YouTube (qui restent en fallback). Limite{" "}
          <span className="text-[var(--gold)]">60 MB par fichier</span> en
          upload direct ; au-del&agrave;, utilise l&apos;URL sign&eacute;e
          (option avanc&eacute;e dans l&apos;&eacute;diteur).
        </p>
      </header>

      <HeroVideosEditor />
    </main>
  );
}
