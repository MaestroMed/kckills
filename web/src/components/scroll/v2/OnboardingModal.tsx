"use client";

/**
 * OnboardingModal — V27 (Wave 24.1).
 *
 * Shown on the very first /scroll visit (when the user has zero
 * affinity entries AND `kc_onboarded_v1` is unset). Asks the user
 * to pick 2-3 favorite players from the active roster ; their
 * picks seed the affinity store so the recommendation cosine
 * starts personalised right away.
 *
 * Skippable via "Plus tard" — if the user dismisses, we set the
 * flag so the modal doesn't bug them again. They can still
 * configure later via /settings (TBD).
 *
 * Storage : `localStorage.kc_onboarded_v1` = "true" | "skipped".
 */

import { useState, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { useAffinityStore } from "./hooks/useAffinityStore";
import { track } from "@/lib/analytics/track";

const FLAG_KEY = "kc_onboarded_v1";

interface RosterPick {
  id: string;
  ign: string;
  role: "TOP" | "JGL" | "MID" | "ADC" | "SUP";
  championIcon?: string | null;
}

interface Props {
  roster: RosterPick[];
}

function shouldShow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !window.localStorage.getItem(FLAG_KEY);
  } catch {
    return false;
  }
}

function markDone(value: "true" | "skipped") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FLAG_KEY, value);
  } catch {
    /* storage disabled */
  }
}

export function OnboardingModal({ roster }: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { seedFromOnboarding } = useAffinityStore();

  useEffect(() => {
    // Wait one frame so the SSR feed paints first — onboarding shows
    // as a layered modal, not as a blocker on first paint.
    const t = window.setTimeout(() => {
      if (shouldShow()) setOpen(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, []);

  if (!open) return null;

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    if (picked.size === 0) {
      // Nothing picked = same as skip.
      skip();
      return;
    }
    seedFromOnboarding(Array.from(picked));
    markDone("true");
    try {
      track("page.viewed", {
        entityType: "kill",
        entityId: "onboarding",
        metadata: {
          step: "completed",
          picks: Array.from(picked).length,
        },
      });
    } catch {
      /* silent */
    }
    setOpen(false);
  };

  const skip = () => {
    markDone("skipped");
    try {
      track("page.viewed", {
        entityType: "kill",
        entityId: "onboarding",
        metadata: { step: "skipped" },
      });
    } catch {
      /* silent */
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Choisis tes joueurs favoris"
          className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={skip}
          />
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="relative w-full sm:max-w-md sm:m-4 rounded-t-3xl sm:rounded-3xl bg-[var(--bg-surface)] border-t sm:border border-[var(--gold)]/40 backdrop-blur-md px-5 py-6 space-y-5"
            style={{
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
            }}
          >
            <header className="space-y-1">
              <h2 className="font-display text-xl font-black text-[var(--gold)] tracking-tight">
                Bienvenue sur KCKILLS
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Choisis tes 2-3 joueurs favoris pour personnaliser ton feed.
                Tu pourras toujours changer plus tard.
              </p>
            </header>

            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {roster.map((p) => {
                const active = picked.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => togglePick(p.id)}
                      aria-pressed={active}
                      className={
                        "w-full flex flex-col items-center gap-2 rounded-2xl border p-3 transition-all " +
                        (active
                          ? "bg-[var(--gold)]/15 border-[var(--gold)]/60 shadow-lg shadow-[var(--gold)]/20"
                          : "bg-[var(--bg-elevated)]/50 border-[var(--border-gold)] hover:border-[var(--gold)]/40")
                      }
                    >
                      <div
                        className={
                          "h-12 w-12 rounded-full overflow-hidden border-2 transition-colors " +
                          (active
                            ? "border-[var(--gold)]"
                            : "border-white/15")
                        }
                      >
                        {p.championIcon ? (
                          <Image
                            src={p.championIcon}
                            alt={p.ign}
                            width={48}
                            height={48}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center bg-[var(--bg-primary)] text-xs text-[var(--text-muted)]">
                            {p.ign.slice(0, 2)}
                          </div>
                        )}
                      </div>
                      <span
                        className={
                          "font-display text-sm font-bold " +
                          (active ? "text-[var(--gold)]" : "text-white")
                        }
                      >
                        {p.ign}
                      </span>
                      <span className="font-data text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                        {p.role}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={skip}
                className="flex-1 rounded-full border border-[var(--border-gold)] px-4 py-3 text-sm text-[var(--text-muted)] hover:text-[var(--gold)]"
              >
                Plus tard
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={picked.size === 0}
                className="flex-[2] rounded-full bg-[var(--gold)] px-4 py-3 text-sm font-bold text-black disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--gold-bright)]"
              >
                {picked.size === 0
                  ? "Choisis au moins 1 joueur"
                  : `Valider (${picked.size})`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
