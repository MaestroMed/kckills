"use client";

/**
 * PlayerDrawer — V31 (Wave 25.1).
 *
 * Bottom-sheet slide-up showing a quick player summary when the user
 * taps a killer name in the feed. Avoids a full route navigation +
 * keeps the active clip context visible behind the dim layer.
 *
 * Renders :
 *   * Avatar + IGN + role + region
 *   * Total kills published, avg score, top champion
 *   * Follow / unfollow button (V34, calls /api/players/[id]/follow)
 *   * "Voir tous les kills" link to /player/[slug]
 *
 * Data is lazy-loaded on first open from a thin
 * `/api/players/[id]/summary` route (TODO — for now we just show
 * the basics passed via props from the parent FeedItem).
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";

interface Props {
  open: boolean;
  onClose: () => void;
  playerId: string;
  playerName: string;
  championIcon?: string | null;
  role?: "TOP" | "JGL" | "MID" | "ADC" | "SUP" | null;
  /** Slug for the /player/[slug] full-page link. */
  playerSlug?: string | null;
}

export function PlayerDrawer({
  open,
  onClose,
  playerId,
  playerName,
  championIcon,
  role,
  playerSlug,
}: Props) {
  const [following, setFollowing] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  // Hydrate following state on open. Anonymous users get null
  // (no auth → server returns 401 → we hide the button cleanly).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`/api/players/${playerId}/follow-status`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((body) => {
        if (cancelled) return;
        setFollowing(body?.followed === true);
      })
      .catch(() => {
        /* silent — keep null */
      });
    return () => {
      cancelled = true;
    };
  }, [open, playerId]);

  const toggleFollow = async () => {
    if (pending) return;
    setPending(true);
    const wasFollowing = following === true;
    setFollowing(!wasFollowing); // optimistic
    try {
      const res = await fetch(`/api/players/${playerId}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        credentials: "same-origin",
      });
      if (!res.ok) setFollowing(wasFollowing);
    } catch {
      setFollowing(wasFollowing);
    }
    setPending(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Profil ${playerName}`}
          className="fixed inset-0 z-[230] flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-black/55"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="relative w-full sm:max-w-md sm:m-4 rounded-t-3xl sm:rounded-3xl bg-[var(--bg-surface)]/97 border-t sm:border border-[var(--border-gold)] backdrop-blur-md p-5 space-y-4"
            style={{
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
            }}
          >
            <div className="mx-auto sm:hidden mt-1 h-1 w-10 rounded-full bg-white/30" />

            <header className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full overflow-hidden border-2 border-[var(--gold)]/40 bg-[var(--bg-elevated)]">
                {championIcon ? (
                  <Image
                    src={championIcon}
                    alt={playerName}
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-2xl text-[var(--text-muted)]">
                    {playerName.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-xl font-black truncate text-[var(--text-primary)]">
                  {playerName}
                </h2>
                {role && (
                  <p className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/80">
                    {role}
                  </p>
                )}
              </div>
            </header>

            <div className="flex items-center gap-2">
              {following != null && (
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={pending}
                  className={
                    "flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-50 " +
                    (following
                      ? "border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10"
                      : "bg-[var(--gold)] text-black hover:bg-[var(--gold-bright)]")
                  }
                >
                  {following ? "Suivi ✓" : "+ Suivre"}
                </button>
              )}
              <Link
                href={`/scroll?player=${playerId}`}
                onClick={onClose}
                className="flex-1 rounded-full border border-[var(--border-gold)] px-4 py-2.5 text-center text-sm text-[var(--text-secondary)] hover:text-[var(--gold)]"
              >
                Voir ses kills
              </Link>
            </div>

            {playerSlug && (
              <Link
                href={`/player/${playerSlug}`}
                onClick={onClose}
                className="block text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--gold)]"
              >
                Profil complet →
              </Link>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
