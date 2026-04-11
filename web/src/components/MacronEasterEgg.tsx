"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { KC_LOGO } from "@/lib/kc-assets";

/**
 * Hidden easter egg: click the KC logo 5 times within 3 seconds to unlock
 * Emmanuel Macron's legendary 2021 tweet congratulating the club for
 * winning EU Masters Spring. Yes, this actually happened. Yes, the French
 * president of the republic tweeted at a LoL esport team. Yes, the KC
 * Army will lose their minds when they find it.
 *
 * Based on recommendation #2 from the Opus 4.6 audit.
 */
export function MacronEasterEgg() {
  const [clicks, setClicks] = useState(0);
  const [show, setShow] = useState(false);
  const [lastClick, setLastClick] = useState(0);

  const handleClick = useCallback(() => {
    const now = Date.now();
    // Reset counter if more than 3s since last click
    if (now - lastClick > 3000) {
      setClicks(1);
    } else {
      setClicks((prev) => prev + 1);
    }
    setLastClick(now);
  }, [lastClick]);

  useEffect(() => {
    if (clicks >= 5) {
      setShow(true);
      setClicks(0);
      const t = window.setTimeout(() => setShow(false), 12000);
      return () => window.clearTimeout(t);
    }
  }, [clicks]);

  return (
    <>
      <button
        onClick={handleClick}
        className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
        aria-label="Karmine Corp"
      >
        <Image
          src={KC_LOGO}
          alt="Karmine Corp"
          width={48}
          height={48}
          className="rounded-xl"
        />
      </button>

      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="fixed top-20 right-4 left-4 md:left-auto md:max-w-md z-[300]"
            role="status"
            aria-live="polite"
          >
            <button
              onClick={() => setShow(false)}
              className="w-full text-left rounded-2xl border-2 border-[#1DA1F2]/40 bg-gradient-to-br from-[#0A1428] via-[#0F1D36] to-[#1A2542] backdrop-blur-xl shadow-2xl overflow-hidden"
              style={{
                boxShadow:
                  "0 30px 80px rgba(29,161,242,0.25), 0 0 60px rgba(200,170,110,0.15), inset 0 0 0 1px rgba(29,161,242,0.2)",
              }}
            >
              {/* Header — fake Twitter/X card */}
              <div className="flex items-center gap-3 p-4 border-b border-white/10">
                <div className="h-11 w-11 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center font-display font-black text-white text-lg">
                  EM
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-display text-sm font-bold text-white truncate">
                      Emmanuel Macron
                    </span>
                    <svg
                      className="h-3.5 w-3.5 text-blue-400 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
                    </svg>
                  </div>
                  <p className="text-[11px] text-white/50">
                    @EmmanuelMacron &middot; 2 mai 2021
                  </p>
                </div>
                <div className="rounded-full bg-[var(--gold)]/20 border border-[var(--gold)]/40 px-2 py-0.5">
                  <span className="text-[9px] font-black text-[var(--gold)] uppercase tracking-widest">
                    Easter Egg
                  </span>
                </div>
              </div>

              {/* Tweet body */}
              <div className="p-4 space-y-2">
                <p className="text-sm text-white leading-relaxed">
                  F&eacute;licitations &agrave; la @KarmineCorp pour cette victoire
                  historique au <strong>EU Masters</strong> ! Une belle
                  r&eacute;ussite fran&ccedil;aise. Bravo &agrave; toute l&apos;&eacute;quipe.
                  &#127467;&#127479;
                </p>
                <p className="text-xs text-[var(--gold)]/70 font-data uppercase tracking-widest pt-2 border-t border-white/5">
                  Oui, le pr&eacute;sident de la R&eacute;publique a vraiment f&eacute;licit&eacute;
                  KC pour les EU Masters.
                </p>
              </div>

              {/* Tap hint */}
              <div className="px-4 py-2 bg-black/40 text-center">
                <p className="text-[10px] text-white/40 uppercase tracking-widest">
                  Tap pour fermer
                </p>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
