/**
 * /u/[username] — V32 (Wave 25.1).
 *
 * Public user profile page. Surfaces what a Discord-OAuth-authed
 * KCKILLS user has built up : avatar, total ratings, total comments,
 * badges, and (via V33) their saved-clip list when their bookmarks
 * are public.
 *
 * Privacy : zero PII. Discord username + avatar URL are the only
 * surface ; Discord ID hash + Riot PUUID hash never leave the DB.
 *
 * RLS : `profiles` is public-read per migration 001. The bookmark
 * list is private by default ; users opt in via a `public_bookmarks`
 * column on profiles (added in migration 058 — TODO).
 */

import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { Breadcrumb } from "@/components/Breadcrumb";

export const revalidate = 600;

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata(
  { params }: Props,
): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `${username} — KCKILLS`,
    description: `Profil public de ${username} sur kckills.com — ratings, commentaires, clips sauvegardés.`,
    alternates: { canonical: `/u/${encodeURIComponent(username)}` },
    robots: { index: false, follow: true },
  };
}

interface ProfileData {
  id: string;
  discord_username: string | null;
  discord_avatar_url: string | null;
  total_ratings: number;
  total_comments: number;
  created_at: string;
  badges: unknown;
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  if (!username || username.length > 64) notFound();

  const sb = await createServerSupabase();
  const { data: profile } = (await sb
    .from("profiles")
    .select(
      "id, discord_username, discord_avatar_url, total_ratings, total_comments, created_at, badges",
    )
    .eq("discord_username", username)
    .maybeSingle()) as { data: ProfileData | null };

  if (!profile) notFound();

  // V33 — most-recent bookmarks (only when public ; the
  // `public_bookmarks` column lands in a follow-up migration. For
  // now we always hide the list to respect privacy by default).
  const showBookmarks = false;

  return (
    <article className="space-y-8">
      <Breadcrumb
        items={[
          { label: "Accueil", href: "/" },
          { label: profile.discord_username ?? username },
        ]}
      />

      <header className="flex items-center gap-5">
        <div className="h-20 w-20 rounded-full overflow-hidden border-2 border-[var(--gold)]/40 bg-[var(--bg-elevated)]">
          {profile.discord_avatar_url ? (
            <Image
              src={profile.discord_avatar_url}
              alt={profile.discord_username ?? username}
              width={80}
              height={80}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-3xl text-[var(--text-muted)]">
              {(profile.discord_username ?? username).slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="space-y-1 flex-1 min-w-0">
          <h1 className="font-display text-3xl font-black text-[var(--text-primary)] truncate">
            {profile.discord_username ?? username}
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            Membre depuis le{" "}
            {new Date(profile.created_at).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/50 p-4">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Ratings
          </p>
          <p className="font-data text-3xl font-bold text-[var(--gold)]">
            {profile.total_ratings ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/50 p-4">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Commentaires
          </p>
          <p className="font-data text-3xl font-bold text-[var(--text-primary)]">
            {profile.total_comments ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/50 p-4 col-span-2 sm:col-span-1">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Badges
          </p>
          <p className="font-data text-sm text-[var(--text-primary)]">
            {Array.isArray(profile.badges) && profile.badges.length > 0
              ? profile.badges.length
              : "—"}
          </p>
        </div>
      </section>

      {showBookmarks && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">Clips sauvegardés</h2>
          <p className="text-sm text-[var(--text-muted)]">
            (V33 — bookmark list rendering, gated on profile.public_bookmarks
            opt-in. Migration 058 wires the column.)
          </p>
        </section>
      )}

      <section>
        <Link
          href="/scroll"
          className="inline-flex items-center gap-2 text-sm text-[var(--gold)] hover:text-[var(--gold-bright)]"
        >
          ← Retour au feed
        </Link>
      </section>
    </article>
  );
}
