"use client";

/**
 * MatchupIntro — the fighting-game VS screen (Wave 36).
 *
 * Fired the instant the roulette locks a pair, before the clips reveal :
 * two champion vignettes SLAM in from the sides across a skewed divider,
 * each stamps a champ-select LOCK-IN (contracting gold ring + VERROUILLÉ
 * seal), then the VS totem slams the center with a flash + shake — pure
 * Street-Fighter-select energy, hextech skin.
 *
 * Self-contained overlay : CSS keyframes only (no motion dep), Data
 * Dragon loading art (tall format, already CSP-allowed), skippable on
 * click/key, and under prefers-reduced-motion it renders a 400 ms static
 * card before resolving. Total runtime ~2.5 s.
 *
 * Timeline (ms) :
 *    0 → panels slide in (left, then right +90)
 *  620 → impact flash + shake
 *  900 → left LOCK-IN (ring + stamp + sfx)
 * 1200 → right LOCK-IN
 * 1550 → VS slam
 * 2450 → onDone
 */

import { useEffect, useRef, useState } from "react";
import { championLoadingUrl, championSplashUrl } from "@/lib/constants";
import { playLockInSfx } from "@/lib/vs-roulette";

export interface MatchupFighter {
  /** Big plate : the player's name (falls back to the champion). */
  name: string;
  /** Champion whose art fills the vignette. */
  champion: string | null;
  /** Small line under the name (victim, era…). */
  subtitle?: string | null;
}

const DONE_AT_MS = 2450;
const REDUCED_DONE_AT_MS = 400;

export function MatchupIntro({
  left,
  right,
  reduce,
  onDone,
}: {
  left: MatchupFighter;
  right: MatchupFighter;
  reduce: boolean;
  onDone: () => void;
}) {
  const doneRef = useRef(false);
  const [skipped, setSkipped] = useState(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // Auto-resolve + lock-in SFX beats.
  useEffect(() => {
    if (skipped) {
      finish();
      return;
    }
    const doneAt = reduce ? REDUCED_DONE_AT_MS : DONE_AT_MS;
    const timers = [window.setTimeout(finish, doneAt)];
    if (!reduce) {
      timers.push(window.setTimeout(() => playLockInSfx(), 900));
      timers.push(window.setTimeout(() => playLockInSfx(), 1200));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipped, reduce]);

  useEffect(() => {
    const onKey = () => setSkipped(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-[80] cursor-pointer overflow-hidden bg-[#010A13]"
      onClick={() => setSkipped(true)}
      role="presentation"
      aria-label="Présentation du duel — cliquer pour passer"
      style={{
        animation: reduce ? "none" : "vsIntroShake 0.3s linear 0.62s 1",
      }}
    >
      {/* ── The two fighters ──────────────────────────────────────── */}
      <FighterPanel fighter={left} side="left" reduce={reduce} />
      <FighterPanel fighter={right} side="right" reduce={reduce} />

      {/* ── Skewed divider bolt ───────────────────────────────────── */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 z-[3] w-[3px] -translate-x-1/2"
        style={{
          background:
            "linear-gradient(180deg, transparent, var(--gold) 20%, #fff 50%, var(--gold) 80%, transparent)",
          transform: "translateX(-50%) skewX(-8deg)",
          boxShadow: "0 0 34px rgba(200,170,110,0.9)",
          opacity: reduce ? 1 : 0,
          animation: reduce ? "none" : "vsIntroDivider 0.25s ease-out 0.6s forwards",
        }}
      />

      {/* ── Impact flash ──────────────────────────────────────────── */}
      {!reduce && (
        <div
          aria-hidden
          className="absolute inset-0 z-[4] bg-white opacity-0"
          style={{ animation: "vsIntroFlash 0.35s ease-out 0.62s 1" }}
        />
      )}

      {/* ── VS totem slam ─────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center">
        <p
          className="font-display font-black italic leading-none"
          style={{
            fontSize: "clamp(5rem, 16vw, 12rem)",
            color: "var(--gold-bright)",
            WebkitTextStroke: "2px rgba(120,90,40,0.9)",
            textShadow:
              "0 0 60px rgba(200,170,110,0.85), 0 10px 40px rgba(0,0,0,0.9)",
            opacity: reduce ? 1 : 0,
            transform: reduce ? "none" : "scale(3)",
            animation: reduce
              ? "none"
              : "vsIntroSlam 0.4s cubic-bezier(0.16,1,0.3,1) 1.55s forwards",
          }}
        >
          VS
        </p>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-5 z-[6] text-center font-data text-[10px] uppercase tracking-[0.3em] text-white/35">
        Cliquer pour passer
      </p>

      <style>{`
        @keyframes vsIntroPanelL{0%{transform:translateX(-105%)}70%{transform:translateX(1.5%)}100%{transform:translateX(0)}}
        @keyframes vsIntroPanelR{0%{transform:translateX(105%)}70%{transform:translateX(-1.5%)}100%{transform:translateX(0)}}
        @keyframes vsIntroFlash{0%{opacity:0}15%{opacity:0.85}100%{opacity:0}}
        @keyframes vsIntroShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-6px,3px)}40%{transform:translate(5px,-4px)}60%{transform:translate(-4px,-2px)}80%{transform:translate(3px,2px)}}
        @keyframes vsIntroDivider{0%{opacity:0}100%{opacity:1}}
        @keyframes vsIntroSlam{0%{opacity:0;transform:scale(3)}60%{opacity:1;transform:scale(0.92)}100%{opacity:1;transform:scale(1)}}
        @keyframes vsIntroRing{0%{opacity:0;transform:scale(2.2);border-width:2px}55%{opacity:1}100%{opacity:1;transform:scale(1);border-width:4px}}
        @keyframes vsIntroStamp{0%{opacity:0;transform:rotate(-14deg) scale(2.4)}65%{opacity:1;transform:rotate(-8deg) scale(0.94)}100%{opacity:1;transform:rotate(-8deg) scale(1)}}
        @keyframes vsIntroNamePlate{0%{opacity:0;transform:translateY(24px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes vsIntroArtPan{0%{transform:scale(1.18) translateX(0)}100%{transform:scale(1.08) translateX(-2%)}}
      `}</style>
    </div>
  );
}

// ─── One side ─────────────────────────────────────────────────────────

function FighterPanel({
  fighter,
  side,
  reduce,
}: {
  fighter: MatchupFighter;
  side: "left" | "right";
  reduce: boolean;
}) {
  const isLeft = side === "left";
  const accent = isLeft ? "var(--cyan)" : "var(--gold)";
  const champ = fighter.champion;
  const lockDelay = isLeft ? 0.9 : 1.2;

  return (
    <div
      className="absolute inset-y-0 z-[2] overflow-hidden"
      style={{
        left: isLeft ? 0 : "50%",
        right: isLeft ? "50%" : 0,
        clipPath: isLeft
          ? "polygon(0 0, 100% 0, calc(100% - 3vw) 100%, 0 100%)"
          : "polygon(3vw 0, 100% 0, 100% 100%, 0 100%)",
        transform: reduce ? "none" : undefined,
        animation: reduce
          ? "none"
          : `${isLeft ? "vsIntroPanelL" : "vsIntroPanelR"} 0.6s cubic-bezier(0.16,1,0.3,1) ${isLeft ? "0s" : "0.09s"} both`,
      }}
    >
      {/* Splash backdrop, drained then re-lit by the lock */}
      {champ && (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${championSplashUrl(champ)})`,
            backgroundSize: "cover",
            backgroundPosition: isLeft ? "70% 20%" : "30% 20%",
            filter: "saturate(0.75) brightness(0.55)",
            animation: reduce ? "none" : "vsIntroArtPan 2.5s ease-out both",
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: isLeft
            ? `linear-gradient(105deg, rgba(1,10,19,0.9) 0%, transparent 45%, rgba(1,10,19,0.65) 100%)`
            : `linear-gradient(255deg, rgba(1,10,19,0.9) 0%, transparent 45%, rgba(1,10,19,0.65) 100%)`,
        }}
      />

      {/* Loading-art vignette + lock ring */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 ${isLeft ? "left-[8%]" : "right-[8%]"}`}
      >
        <div className="relative">
          {champ && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={championLoadingUrl(champ)}
              alt={champ}
              width={200}
              height={364}
              className="h-[38vh] max-h-[364px] w-auto rounded-md border object-cover"
              style={{
                borderColor: accent,
                boxShadow: `0 0 44px ${isLeft ? "rgba(10,200,185,0.35)" : "rgba(200,170,110,0.4)"}, 0 18px 50px rgba(0,0,0,0.8)`,
              }}
            />
          )}
          {/* Contracting lock ring */}
          <div
            aria-hidden
            className="absolute inset-[-10px] rounded-lg border-4 opacity-0"
            style={{
              borderColor: accent,
              animation: reduce
                ? "none"
                : `vsIntroRing 0.35s cubic-bezier(0.16,1,0.3,1) ${lockDelay}s forwards`,
            }}
          />
          {/* VERROUILLÉ stamp */}
          <div
            aria-hidden
            className="absolute inset-0 grid place-items-center opacity-0"
            style={{
              animation: reduce
                ? "none"
                : `vsIntroStamp 0.3s cubic-bezier(0.16,1,0.3,1) ${lockDelay + 0.08}s forwards`,
            }}
          >
            <span
              className="border-2 px-3 py-1 font-display text-lg font-black uppercase tracking-[0.25em]"
              style={{
                color: accent,
                borderColor: accent,
                background: "rgba(1,10,19,0.72)",
                textShadow: `0 0 18px ${isLeft ? "rgba(10,200,185,0.8)" : "rgba(200,170,110,0.8)"}`,
              }}
            >
              Verrouillé
            </span>
          </div>
        </div>
      </div>

      {/* Name plate */}
      <div
        className={`absolute bottom-[12%] ${isLeft ? "left-[8%] text-left" : "right-[8%] text-right"} opacity-0`}
        style={{
          animation: reduce
            ? "vsIntroNamePlate 0.01s linear forwards"
            : `vsIntroNamePlate 0.4s cubic-bezier(0.16,1,0.3,1) ${lockDelay + 0.15}s forwards`,
        }}
      >
        <p
          className="font-display font-black uppercase leading-none"
          style={{
            fontSize: "clamp(1.8rem, 4.5vw, 3.6rem)",
            color: "white",
            textShadow: `0 0 30px ${isLeft ? "rgba(10,200,185,0.5)" : "rgba(200,170,110,0.5)"}, 0 4px 20px rgba(0,0,0,0.9)`,
          }}
        >
          {fighter.name}
        </p>
        {champ && (
          <p
            className="mt-1 font-data text-sm uppercase tracking-[0.3em]"
            style={{ color: accent }}
          >
            {champ}
          </p>
        )}
        {fighter.subtitle && (
          <p className="mt-1 font-data text-[11px] uppercase tracking-[0.15em] text-white/50">
            {fighter.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
