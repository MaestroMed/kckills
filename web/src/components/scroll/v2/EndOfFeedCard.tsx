"use client";

/**
 * EndOfFeedCard — replaces the abrupt "you've seen the last clip"
 * silence with a curated recommendation panel.
 *
 * Inserted as a virtual item at index N (where N = visibleItems.length).
 * Same height as a regular feed item, same gesture model. The user
 * arrives here naturally by swiping past the last clip — no special
 * scroll behaviour needed.
 *
 * Three CTAs picked because they're the obvious next moves on KCKILLS
 * after exhausting the main feed:
 *   1. Re-shuffle the same feed with a new random seed
 *   2. Best clips (curated highlights, different ranking)
 *   3. Multi-kills (rare-event showcase)
 *
 * The re-shuffle CTA is wired via a callback so the parent owns the
 * actual reshuffle logic (it has access to the items array + URL state).
 */

import Link from "next/link";

interface Props {
  itemHeight: number;
  /** Triggered when user taps "Mélanger à nouveau" — parent re-shuffles
   *  the items array with a new seed and resets activeIndex to 0. */
  onReshuffle: () => void;
  /** Total clips seen — for the friendly count message. */
  totalSeen: number;
}

export function EndOfFeedCard({ itemHeight, onReshuffle, totalSeen }: Props) {
  return (
    <div
      data-feed-end
      style={{ height: `${itemHeight}px` }}
      className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[var(--bg-primary)] via-[#0a1428] to-[var(--bg-primary)] px-6"
    >
      {/* Hextech ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(200,170,110,0.15), transparent 60%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md text-center">
        <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/60 mb-4">
          Fin du feed
        </p>
        <h1 className="font-display text-3xl md:text-4xl font-black text-white mb-3">
          Tu as vu les{" "}
          <span className="text-[var(--gold)]">{totalSeen}</span> clips
        </h1>
        <p className="text-sm text-[var(--text-muted)] mb-8 leading-relaxed">
          La suite du KCKILLS, à toi de choisir le rythme. Ré-explore le même
          feed dans un autre ordre, ou plonge dans une sélection plus serrée.
        </p>

        <div className="space-y-3">
          <button
            onClick={onReshuffle}
            className="w-full rounded-2xl bg-[var(--gold)] py-4 px-6 font-display text-sm font-black uppercase tracking-widest text-[var(--bg-primary)] transition-all hover:bg-[var(--gold-bright)] hover:shadow-2xl hover:shadow-[var(--gold)]/30 active:scale-95"
          >
            Mélanger à nouveau
          </button>

          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/best"
              className="rounded-2xl border border-[var(--gold)]/40 bg-black/40 backdrop-blur-md py-3 px-4 font-display text-xs font-bold uppercase tracking-widest text-[var(--gold)] transition-all hover:bg-[var(--gold)]/10 active:scale-95"
            >
              ★ Meilleurs
            </Link>
            <Link
              href="/multikills"
              className="rounded-2xl border border-[var(--orange)]/40 bg-black/40 backdrop-blur-md py-3 px-4 font-display text-xs font-bold uppercase tracking-widest text-[var(--orange)] transition-all hover:bg-[var(--orange)]/10 active:scale-95"
            >
              ✦ Multi-kills
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2">
            <Link
              href="/first-bloods"
              className="rounded-xl border border-white/10 bg-black/30 py-2 text-[10px] font-data uppercase tracking-widest text-white/60 transition-colors hover:text-white"
            >
              FB
            </Link>
            <Link
              href="/matchups"
              className="rounded-xl border border-white/10 bg-black/30 py-2 text-[10px] font-data uppercase tracking-widest text-white/60 transition-colors hover:text-white"
            >
              Matchups
            </Link>
            <Link
              href="/recent"
              className="rounded-xl border border-white/10 bg-black/30 py-2 text-[10px] font-data uppercase tracking-widest text-white/60 transition-colors hover:text-white"
            >
              Recent
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
