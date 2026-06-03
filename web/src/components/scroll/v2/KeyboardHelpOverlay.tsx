"use client";

/**
 * KeyboardHelpOverlay — modal showing the full keyboard cheatsheet.
 * Toggled via ? on desktop. Click backdrop or press Esc to dismiss.
 *
 * Designed mobile-aware: on small viewports (< 640px) the overlay
 * adapts to bottom sheet style instead of modal-center, but on mobile
 * we don't show keyboard shortcuts anyway — the trigger only works
 * with a physical keyboard.
 *
 * Wave 36: built on the shared <Modal> primitive (FocusTrapModal) so it
 * gains a real focus trap, focus-on-open, Escape-to-close, focus-restore
 * on close, and an inert background — the hand-rolled scrim/close/role
 * markup that lacked all of that is now delegated to the primitive.
 */

import { useId } from "react";
import { Modal } from "@/components/ui/FocusTrapModal";
import { useT } from "@/lib/i18n/use-lang";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function KeyboardHelpOverlay({ open, onClose }: Props) {
  const t = useT();
  const titleId = useId();
  const SHORTCUTS: { keys: string[]; label: string }[] = [
    { keys: ["↓", "J"], label: t("p_scroll.ov_kbd_next") },
    { keys: ["↑", "K"], label: t("p_scroll.ov_kbd_prev") },
    { keys: ["Espace"], label: t("p_scroll.ov_kbd_play_pause") },
    { keys: ["M"], label: t("p_scroll.ov_kbd_mute") },
    { keys: ["1 – 5"], label: t("p_scroll.ov_kbd_rate") },
    { keys: ["L"], label: t("p_scroll.ov_kbd_like") },
    { keys: ["C"], label: t("p_scroll.ov_kbd_comments") },
    { keys: ["B"], label: t("p_scroll.ov_kbd_favorite") },
    { keys: ["S"], label: t("p_scroll.ov_kbd_share") },
    { keys: ["F"], label: t("p_scroll.ov_kbd_cinema") },
    { keys: ["Esc"], label: t("p_scroll.ov_kbd_close_panel") },
    { keys: ["?"], label: t("p_scroll.ov_kbd_show_help") },
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      closeLabel={t("p_scroll.ov_close")}
      zIndexClassName="z-[200]"
      scrimClassName="bg-black/70 backdrop-blur-md"
      panelClassName="w-full max-w-md rounded-3xl border border-[var(--gold)]/30 bg-[var(--bg-surface)] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
    >
      <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/65 mb-2">
        {t("p_scroll.ov_kbd_eyebrow")}
      </p>
      <h2 id={titleId} className="font-display text-2xl font-black text-white mb-5">
        {t("p_scroll.ov_kbd_title")}
      </h2>

      <ul className="space-y-2.5">
        {SHORTCUTS.map((s) => (
          <li
            key={s.label}
            className="flex items-center justify-between gap-4 rounded-xl bg-[var(--bg-elevated)]/50 px-3 py-2"
          >
            <span className="text-sm text-white/80">{s.label}</span>
            <span className="flex items-center gap-1">
              {s.keys.map((k, i) => (
                <kbd
                  key={i}
                  className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-white/15 bg-black/40 px-1.5 font-data text-[10px] font-bold text-white/85"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-[11px] text-white/45 text-center">
        {t("p_scroll.ov_kbd_tip_before")}{" "}
        <kbd className="px-1 rounded bg-white/10 text-[10px]">Tab</kbd>{" "}
        {t("p_scroll.ov_kbd_tip_after")}
      </p>
    </Modal>
  );
}
