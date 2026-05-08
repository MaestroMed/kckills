"use client";

/**
 * ShareSheet — V8 (Wave 22.1).
 *
 * Custom share sheet shown when `navigator.share` is unavailable
 * (most desktops) or when the user explicitly opens "more options".
 * Surfaces platform-specific deep links so the user doesn't fall
 * back to "copy link" for everything.
 *
 * Channels :
 *   * Discord (copy link with @here template)
 *   * X / Twitter (deep link with text + url)
 *   * Reddit
 *   * WhatsApp
 *   * Telegram
 *   * Email
 *   * Copy link (fallback)
 *
 * Each click fires `clip.shared` with `metadata: { channel }` so
 * the analytics dashboard sees per-platform conversion.
 *
 * Animation : fade in + slide up. Closes on backdrop click / Esc.
 */

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

interface Props {
  open: boolean;
  onClose: () => void;
  killId: string;
  shareTitle: string;
  shareText?: string;
  shareUrl: string;
}

interface Channel {
  id: string;
  label: string;
  href: (url: string, title: string, text?: string) => string;
  /** Glyph or short label, single-character so the chip stays compact. */
  icon: string;
  bg: string;
  fg: string;
}

const CHANNELS: Channel[] = [
  {
    id: "x",
    label: "X / Twitter",
    href: (url, title, text) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        text ? `${title}\n${text}` : title,
      )}&url=${encodeURIComponent(url)}`,
    icon: "𝕏",
    bg: "bg-black",
    fg: "text-white",
  },
  {
    id: "reddit",
    label: "Reddit",
    href: (url, title) =>
      `https://reddit.com/submit?url=${encodeURIComponent(
        url,
      )}&title=${encodeURIComponent(title)}`,
    icon: "↑",
    bg: "bg-[#FF4500]",
    fg: "text-white",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    href: (url, title) =>
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
    icon: "✆",
    bg: "bg-[#25D366]",
    fg: "text-white",
  },
  {
    id: "telegram",
    label: "Telegram",
    href: (url, title) =>
      `https://t.me/share/url?url=${encodeURIComponent(
        url,
      )}&text=${encodeURIComponent(title)}`,
    icon: "✈",
    bg: "bg-[#0088CC]",
    fg: "text-white",
  },
  {
    id: "email",
    label: "Email",
    href: (url, title, text) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(
        `${text ? text + "\n\n" : ""}${url}`,
      )}`,
    icon: "✉",
    bg: "bg-[var(--bg-elevated)]",
    fg: "text-[var(--gold)]",
  },
];

export function ShareSheet({
  open,
  onClose,
  killId,
  shareTitle,
  shareText,
  shareUrl,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fireShare = (channel: string) => {
    try {
      track("clip.shared", {
        entityType: "kill",
        entityId: killId,
        metadata: { channel, source: "sheet" },
      });
    } catch {
      /* silent */
    }
  };

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      fireShare("clipboard");
    } catch {
      /* clipboard denied — silent */
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Partager le clip"
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center"
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-full sm:max-w-md sm:m-4 rounded-t-2xl sm:rounded-2xl bg-[var(--bg-surface)]/97 border-t sm:border border-[var(--border-gold)] backdrop-blur-md p-4 space-y-3"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}
      >
        <div className="mx-auto sm:hidden mt-1 h-1 w-10 rounded-full bg-white/30" />
        <header className="flex items-center justify-between">
          <h2 className="font-display text-xs font-bold uppercase tracking-widest text-[var(--gold)]">
            Partager
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20"
          >
            ×
          </button>
        </header>

        <div className="grid grid-cols-3 gap-2">
          {CHANNELS.map((c) => (
            <a
              key={c.id}
              href={c.href(shareUrl, shareTitle, shareText)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                fireShare(c.id);
                // Don't auto-close — user might want to preview the dialog
                // before send. Closing on the backdrop is sufficient.
              }}
              className={
                "flex flex-col items-center gap-2 rounded-xl py-3 transition-transform hover:-translate-y-0.5 " +
                c.bg
              }
            >
              <span
                className={`text-2xl font-bold ${c.fg}`}
                aria-hidden
              >
                {c.icon}
              </span>
              <span
                className={`text-[10px] font-data uppercase tracking-widest ${c.fg}`}
              >
                {c.label}
              </span>
            </a>
          ))}
          <button
            type="button"
            onClick={onCopyLink}
            className="flex flex-col items-center gap-2 rounded-xl py-3 bg-[var(--gold)]/15 border border-[var(--gold)]/35 transition-transform hover:-translate-y-0.5"
          >
            <span className="text-2xl font-bold text-[var(--gold)]" aria-hidden>
              ⧉
            </span>
            <span className="text-[10px] font-data uppercase tracking-widest text-[var(--gold)]">
              Copier
            </span>
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-muted)] text-center">
          Le lien pointe vers <code className="font-mono">{shareUrl}</code>
        </p>
      </div>
    </div>
  );
}
