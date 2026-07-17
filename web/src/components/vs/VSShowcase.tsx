"use client";

/**
 * VSShowcase — la présentation séquentielle des deux combattants (Wave 45).
 *
 * Mehdi : « un écran type VS Game avec les cards des joueurs à gauche et à
 * droite en mode rouge et bleu, et il faut qu'on voit bien les deux clips,
 * un par un ». Après le MatchupIntro, chaque clip passe PLEIN CADRE à tour
 * de rôle : le CHALLENGER BLEU d'abord, le CHALLENGER ROUGE ensuite, puis
 * l'écran de vote. Fin de vidéo → enchaînement auto ; CTA pour presser.
 *
 * Transitions : slam latéral + flash de couleur (entrée du côté du
 * combattant), 60 fps (transform/opacity uniquement), easing signature
 * [0.16,1,0.3,1]. `reduce` → fondu simple sans slam ni flash.
 *
 * Réactions : 🔥 💀 👑 par clip via /api/kills/[id]/react (fire-and-forget,
 * keepalive) — on réagit aux DEUX, puis on vote pour le meilleur.
 */

import { useEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { championLoadingUrl } from "@/lib/constants";
import type { VSKill } from "@/lib/vs-roulette";

const EASE = [0.16, 1, 0.3, 1] as const;
const REACTIONS = ["🔥", "💀", "👑"] as const;

export interface ShowcaseSide {
  /** bleu = challenger A (gauche), rouge = challenger B (droite). */
  color: "blue" | "red";
  label: string;
}

export function VSShowcase({
  kill,
  side,
  stepLabel,
  ctaLabel,
  onNext,
  reduce,
}: {
  kill: VSKill;
  side: "blue" | "red";
  /** « CLIP 1 / 2 » etc. */
  stepLabel: string;
  /** « DÉCOUVRIR LE ROUGE → » / « PASSER AU VOTE → ». */
  ctaLabel: string;
  onNext: () => void;
  reduce: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [reacted, setReacted] = useState<Set<string>>(() => new Set());
  const isBlue = side === "blue";
  const accent = isBlue ? "var(--blue-kc)" : "var(--red)";
  const accentRgb = isBlue ? "0,87,255" : "232,64,87";

  const videoUrl =
    kill.clip_url_horizontal ??
    kill.clip_url_vertical ??
    kill.clip_url_vertical_low ??
    null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoUrl) return;
    el.muted = true;
    el.playsInline = true;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, [videoUrl]);

  const react = (emoji: string) => {
    if (reacted.has(emoji)) return;
    setReacted((s) => new Set(s).add(emoji));
    fetch(`/api/kills/${kill.id}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji, delta: 1 }),
      keepalive: true,
    }).catch(() => {});
  };

  return (
    <m.div
      key={kill.id}
      initial={
        reduce
          ? { opacity: 0 }
          : { opacity: 0, x: isBlue ? -80 : 80, scale: 0.96 }
      }
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={
        reduce
          ? { opacity: 0 }
          : { opacity: 0, x: isBlue ? 80 : -80, scale: 0.97 }
      }
      transition={{ duration: reduce ? 0.15 : 0.45, ease: EASE }}
      className="relative"
    >
      {/* Flash d'entrée couleur du camp — un seul frame fort, puis s'efface. */}
      {!reduce && (
        <m.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 rounded-2xl"
          style={{ background: `rgba(${accentRgb},0.35)` }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      )}

      <div
        className="relative overflow-hidden rounded-2xl border-2 bg-black"
        style={{
          borderColor: accent,
          boxShadow: `0 0 42px rgba(${accentRgb},0.35), inset 0 0 80px rgba(${accentRgb},0.08)`,
        }}
      >
        {/* Bandeau camp */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ background: `linear-gradient(90deg, rgba(${accentRgb},0.25), transparent 60%)` }}
        >
          <span
            className="font-data text-[11px] font-black uppercase tracking-[0.3em]"
            style={{ color: accent }}
          >
            {isBlue ? "◤ Challenger bleu" : "Challenger rouge ◢"}
          </span>
          <span className="font-data text-[10px] uppercase tracking-[0.25em] text-white/50">
            {stepLabel}
          </span>
        </div>

        <div className="relative">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              poster={kill.thumbnail_url ?? undefined}
              muted={muted}
              playsInline
              autoPlay
              preload="auto"
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration > 0) setProgress(v.currentTime / v.duration);
              }}
              onEnded={() => setTimeout(onNext, reduce ? 0 : 450)}
              className="mx-auto max-h-[62vh] w-full bg-black object-contain"
            />
          ) : (
            <div className="grid h-[40vh] place-items-center text-white/50">
              Clip indisponible — les stats parlent pour lui.
            </div>
          )}

          {/* Carte combattant — côté du camp, façon écran de sélection. */}
          <div
            className={`pointer-events-none absolute bottom-3 ${isBlue ? "left-3" : "right-3"} flex items-center gap-3 rounded-xl border bg-black/70 p-2.5 backdrop-blur-md`}
            style={{ borderColor: `rgba(${accentRgb},0.55)` }}
          >
            {kill.killer_champion && (
              // eslint-disable-next-line @next/next/no-img-element -- DDragon, pas d'optim nécessaire
              <img
                src={championLoadingUrl(kill.killer_champion)}
                alt=""
                className="h-16 w-12 rounded-md object-cover object-top"
                loading="eager"
              />
            )}
            <div className={isBlue ? "" : "text-right"}>
              <p className="font-display text-base font-black leading-tight text-white">
                {kill.killer_name ?? kill.killer_champion ?? "?"}
              </p>
              <p className="font-data text-[10px] uppercase tracking-[0.2em] text-white/55">
                {kill.killer_champion}
                {kill.victim_champion ? ` ⚔ ${kill.victim_champion}` : ""}
              </p>
              {kill.multi_kill && (
                <span
                  className="mt-0.5 inline-block rounded-sm px-1.5 py-0.5 font-data text-[9px] font-black uppercase tracking-widest text-white"
                  style={{ background: accent }}
                >
                  {kill.multi_kill}
                </span>
              )}
            </div>
          </div>

          {/* Son */}
          <button
            type="button"
            onClick={() => setMuted((v) => !v)}
            aria-label={muted ? "Activer le son du clip" : "Couper le son du clip"}
            className={`absolute top-3 ${isBlue ? "right-3" : "left-3"} z-10 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-sm backdrop-blur-sm transition-colors hover:border-white/50`}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>

        {/* Progression du clip */}
        <div className="h-1 w-full bg-white/10">
          <div
            className="h-full transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.round(progress * 100)}%`, background: accent }}
          />
        </div>

        {/* Réactions + CTA */}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            {REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => react(e)}
                aria-label={`Réagir ${e}`}
                className={`rounded-full border px-3 py-1.5 text-lg transition-all active:scale-90 ${
                  reacted.has(e)
                    ? "scale-110 border-white/60 bg-white/15"
                    : "border-white/15 bg-black/40 hover:border-white/40"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onNext}
            className="rounded-full border-2 px-5 py-2 font-data text-[12px] font-black uppercase tracking-[0.2em] text-white transition-transform hover:scale-105 active:scale-95"
            style={{ borderColor: accent, background: `rgba(${accentRgb},0.2)` }}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </m.div>
  );
}
