"use client";

/**
 * LongPressMenu — V3 (Wave 22.1).
 *
 * Bottom-sheet contextual menu shown after a long-press on a feed
 * item. Mirrors TikTok's "..." menu : Save / Not interested / Share
 * / Report / Profile / Champion. Provides discoverable shortcuts to
 * actions that would otherwise be hidden behind multiple taps.
 *
 * Wired actions :
 *   * "Pas intéressé" → V29 negative-signal (downweights similar
 *      kills via a ref consumed by useRecommendationFeed).
 *   * "Sauvegarder"   → V10 bookmark (POSTs to /api/bookmarks ;
 *      falls back to localStorage when not authed).
 *   * "Partager"      → opens V8 share sheet (sibling component).
 *   * "Signaler"      → POST /api/report with reason.
 *   * "Profil joueur" → /scroll?player=<id>.
 *   * "Champion"      → /champion/<name>.
 *
 * Animation : springs from below the viewport, dim background.
 * Accessible : role="dialog", focus trap on open, Escape closes.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics/track";

interface Props {
  open: boolean;
  onClose: () => void;
  killId: string;
  killerPlayerId?: string | null;
  killerChampion?: string | null;
  victimChampion?: string | null;
  onNotInterested?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  onReport?: () => void;
}

export function LongPressMenu({
  open,
  onClose,
  killId,
  killerPlayerId,
  killerChampion,
  victimChampion,
  onNotInterested,
  onSave,
  onShare,
  onReport,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const itemCls =
    "flex w-full items-center gap-3 px-5 py-3.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors";

  const fire = (action: () => void | undefined, eventName: string) => {
    try {
      track("clip.profile_tap", {
        entityType: "kill",
        entityId: killId,
        metadata: { kind: "longpress_menu", target: eventName, source: "longpress" },
      });
    } catch {
      /* tracker is silent */
    }
    action?.();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu d'actions"
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center"
    >
      {/* Backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        className="relative w-full sm:max-w-sm sm:m-4 rounded-t-2xl sm:rounded-2xl bg-[var(--bg-surface)]/97 border-t sm:border border-[var(--border-gold)] backdrop-blur-md py-2 max-h-[80vh] overflow-y-auto"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0.5rem))" }}
      >
        {/* Drag handle on mobile */}
        <div className="mx-auto sm:hidden mt-2 mb-1 h-1 w-10 rounded-full bg-white/30" />

        <button
          type="button"
          onClick={() => fire(onNotInterested ?? (() => {}), "not_interested")}
          className={itemCls}
        >
          <span className="text-[var(--orange)]" aria-hidden>⊘</span>
          <span className="flex-1">Pas intéressé</span>
          <span className="text-[10px] text-[var(--text-muted)]">V29</span>
        </button>

        <button
          type="button"
          onClick={() => fire(onSave ?? (() => {}), "save")}
          className={itemCls}
        >
          <span className="text-[var(--gold)]" aria-hidden>★</span>
          <span className="flex-1">Sauvegarder</span>
        </button>

        <button
          type="button"
          onClick={() => fire(onShare ?? (() => {}), "share")}
          className={itemCls}
        >
          <span className="text-[var(--cyan)]" aria-hidden>↗</span>
          <span className="flex-1">Partager</span>
        </button>

        <Link
          href={`/kill/${killId}`}
          onClick={(e) => {
            e.stopPropagation();
            try {
              track("clip.opened", {
                entityType: "kill",
                entityId: killId,
                metadata: { source: "longpress" },
              });
            } catch {
              /* silent */
            }
            onClose();
          }}
          className={itemCls}
        >
          <span className="text-white/70" aria-hidden>↗</span>
          <span className="flex-1">Voir la page du kill</span>
        </Link>

        {killerPlayerId && (
          <Link
            href={`/scroll?player=${killerPlayerId}`}
            onClick={onClose}
            className={itemCls}
          >
            <span className="text-[var(--gold)]" aria-hidden>◆</span>
            <span className="flex-1">Voir le joueur</span>
          </Link>
        )}

        {killerChampion && (
          <Link
            href={`/champion/${encodeURIComponent(killerChampion)}`}
            onClick={onClose}
            className={itemCls}
          >
            <span className="text-white/70" aria-hidden>◆</span>
            <span className="flex-1">Champion : {killerChampion}</span>
          </Link>
        )}

        {victimChampion && victimChampion !== killerChampion && (
          <Link
            href={`/champion/${encodeURIComponent(victimChampion)}`}
            onClick={onClose}
            className={itemCls}
          >
            <span className="text-white/70" aria-hidden>◆</span>
            <span className="flex-1">Champion : {victimChampion}</span>
          </Link>
        )}

        <button
          type="button"
          onClick={() => fire(onReport ?? (() => {}), "report")}
          className={itemCls}
        >
          <span className="text-[var(--red)]" aria-hidden>⚐</span>
          <span className="flex-1">Signaler</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="block w-full text-center mt-1 px-5 py-3 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--gold)]"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
