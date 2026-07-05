"use client";

/**
 * EmojiReactions — V16 (Wave 23.1).
 *
 * Quick-reaction palette in the FeedSidebar : tap an emoji to fire
 * a small floating reaction that animates upward + a count tick on
 * the chip. Mirrors the Twitch-style hype reactions used during
 * matches without needing comment authoring.
 *
 * Storage (V16b, Vague 2 — audit 2026-07-05) : reactions are now
 * PERSISTED server-side (`kill_reactions` table, migration 085, via
 * POST /api/kills/[id]/react). The chip shows the aggregate of ALL
 * users. Taps are optimistic + batched (800 ms) before POSTing so a
 * tap-storm costs one request. localStorage keeps a per-clip seed so
 * the count paints instantly while the GET is in flight; anonymous
 * users persist too (server-side fingerprint, rate-limited).
 *
 * The 6 emojis cover the LoL fan reaction-vocabulary :
 *   🔥 hype          👏 clean play       😂 funny
 *   😱 wow           💀 brutal           🐐 GOAT
 */

import { useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "motion/react";
import { track } from "@/lib/analytics/track";
import { useT } from "@/lib/i18n/use-lang";

const EMOJIS = ["🔥", "👏", "😂", "😱", "💀", "🐐"] as const;
type Reaction = (typeof EMOJIS)[number];

const STORAGE_KEY = "kc_reactions_v1";

interface ClipReactions {
  [clipId: string]: { [emoji: string]: number };
}

function readReactions(): ClipReactions {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ClipReactions) : {};
  } catch {
    return {};
  }
}

function writeReactions(r: ClipReactions) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* quota */
  }
}

interface FloatingBurst {
  id: number;
  emoji: Reaction;
}

interface Props {
  killId: string;
  /** When false (item not active), the palette stays mounted but
   *  hidden so React doesn't unmount/remount its state on every
   *  swipe. */
  visible: boolean;
}

export function EmojiReactions({ killId, visible }: Props) {
  const t = useT();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [bursts, setBursts] = useState<FloatingBurst[]>([]);
  const [open, setOpen] = useState(false);
  const burstSeqRef = useRef(0);
  const pendingRef = useRef<Record<string, number>>({});
  const flushTimerRef = useRef<number | null>(null);
  const fetchedForRef = useRef<string | null>(null);

  // Hydrate: localStorage seed (instant paint) then server aggregate.
  useEffect(() => {
    setCounts(readReactions()[killId] ?? {});
  }, [killId]);

  useEffect(() => {
    if (!visible || fetchedForRef.current === killId) return;
    fetchedForRef.current = killId;
    let cancelled = false;
    void fetch(`/api/kills/${killId}/react`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { counts?: Record<string, number> } | null) => {
        if (cancelled || !body?.counts) return;
        setCounts((prev) => {
          // Server totals win; keep any taps fired while fetching.
          const merged = { ...body.counts } as Record<string, number>;
          for (const [e, n] of Object.entries(pendingRef.current)) {
            merged[e] = (merged[e] ?? 0) + n;
          }
          const all = readReactions();
          all[killId] = merged;
          writeReactions(all);
          return merged;
        });
      })
      .catch(() => {
        /* offline — localStorage seed stays */
      });
    return () => {
      cancelled = true;
    };
  }, [killId, visible]);

  // Batch pending taps into one POST per emoji burst (800 ms).
  const flushPending = () => {
    const pending = pendingRef.current;
    pendingRef.current = {};
    flushTimerRef.current = null;
    for (const [emoji, delta] of Object.entries(pending)) {
      void fetch(`/api/kills/${killId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji, delta }),
        credentials: "same-origin",
      }).catch(() => {
        /* best-effort — optimistic count already painted */
      });
    }
  };

  const fire = (emoji: Reaction) => {
    // Floating animation
    const id = burstSeqRef.current++;
    setBursts((prev) => [...prev, { id, emoji }]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 1400);

    // Optimistic count + localStorage cache + batched server write.
    pendingRef.current[emoji] = (pendingRef.current[emoji] ?? 0) + 1;
    if (flushTimerRef.current == null) {
      flushTimerRef.current = window.setTimeout(flushPending, 800);
    }
    setCounts((prev) => {
      const next = { ...prev, [emoji]: (prev[emoji] ?? 0) + 1 };
      const all = readReactions();
      all[killId] = next;
      writeReactions(all);
      return next;
    });

    // Haptic
    try {
      navigator.vibrate?.(8);
    } catch {
      /* unsupported */
    }

    // Analytics
    try {
      track("clip.liked", {
        entityType: "kill",
        entityId: killId,
        metadata: { source: "emoji_reaction", emoji },
      });
    } catch {
      /* silent */
    }
  };

  if (!visible) return null;

  return (
    <div className="relative">
      {/* Trigger button : show top emoji + total count */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("p_scroll.act_reactions_emoji")}
        className="flex flex-col items-center gap-1 group"
      >
        <span
          className={
            "flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-md border transition-all " +
            (open
              ? "bg-[var(--gold)]/30 border-[var(--gold)]/60 scale-110"
              : "bg-black/55 border-white/15 group-hover:bg-black/75")
          }
        >
          <span className="text-lg" aria-hidden>
            🔥
          </span>
        </span>
        <span className="font-data text-[10px] text-white/65 leading-none">
          {Object.values(counts).reduce((s, n) => s + n, 0) || ""}
        </span>
      </button>

      {/* Palette */}
      <AnimatePresence>
        {open && (
          <m.div
            role="menu"
            aria-label={t("p_scroll.act_choose_reaction")}
            initial={{ opacity: 0, scale: 0.85, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 10 }}
            transition={{ type: "spring", stiffness: 480, damping: 30 }}
            className="absolute right-12 top-0 flex items-center gap-1 rounded-full bg-black/80 backdrop-blur-md border border-white/15 px-2 py-1.5 shadow-xl"
          >
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  fire(e);
                  setOpen(false);
                }}
                className="text-xl px-1 py-0.5 hover:scale-125 active:scale-90 transition-transform"
                aria-label={t("p_scroll.act_react_with", { emoji: e })}
              >
                {e}
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>

      {/* Floating bursts — drift up + fade */}
      <AnimatePresence>
        {bursts.map((b) => (
          <m.span
            key={b.id}
            className="pointer-events-none absolute right-3 bottom-12 text-2xl"
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: -120,
              scale: [0.6, 1.3, 1.0, 0.9],
              x: [0, 6 - Math.random() * 12, 12 - Math.random() * 24],
            }}
            transition={{ duration: 1.4, ease: "easeOut", times: [0, 0.15, 0.6, 1] }}
            aria-hidden
          >
            {b.emoji}
          </m.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
