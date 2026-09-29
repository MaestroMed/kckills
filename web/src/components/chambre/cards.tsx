"use client";

/**
 * Les cartes de la Chambre : le coup de grâce (la pire mort d'un cercle, en
 * grand), les autres morts en rail, les Moments Maudits (récits YouTube) et
 * le rituel du F.
 *
 * Les vidéos ne naissent qu'à l'approche de l'écran (poster compris : 120
 * vignettes chargées d'un coup pesaient plusieurs Mo) et ne jouent que
 * visibles. Plus on descend, plus l'image se vide de sa couleur et rougit
 * (filtre sur la vidéo elle-même : rien d'autre n'atteint un calque vidéo).
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ChamberClip } from "@/lib/supabase/chamber";
import type { ChamberLoreMoment } from "@/lib/chamber-lore";

/** Titres en serif (la règle globale h1-h4 impose Oswald en majuscules, hors layer). */
const SERIF = { fontFamily: "var(--font-cormorant), 'Cormorant Garamond', Georgia, serif", textTransform: "none", letterSpacing: "0" } as const;

export const MULTI_LABEL: Record<string, string> = {
  penta: "Pentakill subi",
  quadra: "Quadra subi",
  triple: "Triple subi",
  double: "Double subi",
};

export function badgeOf(clip: ChamberClip): string | null {
  if (clip.multiKill) return MULTI_LABEL[clip.multiKill] ?? null;
  return clip.isFirstBlood ? "Premier sang encaissé" : null;
}

/** « vs G2 · Playoffs · 7 juin 2026 · Game 5 » */
export function contextOf(clip: ChamberClip): string | null {
  const parts: string[] = [];
  if (clip.opponent) parts.push(`vs ${clip.opponent}`);
  if (clip.stage) parts.push(clip.stage);
  if (clip.playedAt) {
    const d = new Date(clip.playedAt);
    if (!Number.isNaN(d.getTime()))
      parts.push(d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }));
  }
  if (clip.gameNumber) parts.push(`Game ${clip.gameNumber}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Plus profond = plus vidé de sa couleur, plus rouge. */
export function gradeFilter(depth: number): string {
  const g = depth / 10;
  return `grayscale(${(g * 0.82).toFixed(2)}) sepia(${(g * 0.38).toFixed(2)}) hue-rotate(${Math.round(-g * 22)}deg) contrast(${(1 + g * 0.16).toFixed(2)}) brightness(${(1 - g * 0.14).toFixed(2)})`;
}

/** Vrai dès que l'élément approche de l'écran (et le reste). */
function useNear(ref: RefObject<HTMLElement | null>, margin = "900px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

/** Lit la vidéo seulement quand elle est à moitié visible. */
function useAutoplay(ref: RefObject<HTMLVideoElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled]);
}

// ── Le rituel du F ─────────────────────────────────────────────────────
// Chaque F envoie un 💀 par /api/kills/[id]/react (limité côté serveur,
// regroupé ici par carte) et nourrit le compteur de la session, que la
// sortie de la Chambre salue.

let sessionRespects = 0;
const respectListeners = new Set<(n: number) => void>();

export function useSessionRespects(): number {
  const [n, setN] = useState(sessionRespects);
  useEffect(() => {
    respectListeners.add(setN);
    return () => {
      respectListeners.delete(setN);
    };
  }, []);
  return n;
}

export function RespectButton({ killId, reduce, large = false }: { killId: string; reduce: boolean; large?: boolean }) {
  const [mine, setMine] = useState(0);
  const [floats, setFloats] = useState<number[]>([]);
  const pendingRef = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const delta = pendingRef.current;
    pendingRef.current = 0;
    if (delta <= 0) return;
    fetch(`/api/kills/${killId}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji: "💀", delta }),
      // le flush de fermeture d'onglet aboutit quand même
      keepalive: true,
    }).catch(() => {});
  }, [killId]);

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flush();
    };
  }, [flush]);

  const pay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMine((n) => n + 1);
    sessionRespects += 1;
    respectListeners.forEach((fn) => fn(sessionRespects));
    pendingRef.current += 1;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 800);
    if (!reduce) {
      const id = Date.now() + Math.random();
      setFloats((f) => [...f.slice(-4), id]);
      setTimeout(() => setFloats((f) => f.filter((x) => x !== id)), 900);
    }
    try {
      navigator.vibrate?.(12);
    } catch {
      /* pas de vibreur */
    }
  };

  return (
    <button
      type="button"
      onClick={pay}
      aria-label="Rendre hommage (F)"
      className={`relative z-10 flex items-center justify-center gap-1 rounded-md border border-white/15 bg-black/60 font-data font-black text-white/80 backdrop-blur-sm transition-all hover:border-[var(--red)] hover:text-[var(--red)] active:scale-90 ${
        large ? "h-12 min-w-12 px-4 text-lg" : "h-8 min-w-8 px-1.5 text-[12px]"
      }`}
    >
      F
      {large && <span className="ml-1 font-[family-name:var(--font-inter-tight)] text-[11px] font-semibold uppercase tracking-[0.2em]">Rendre hommage</span>}
      {mine > 0 && <span className={`font-bold tabular-nums text-[var(--red)] ${large ? "text-sm" : "text-[9px]"}`}>×{mine}</span>}
      {floats.map((id) => (
        <span
          key={id}
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 font-data text-[14px] font-black text-[var(--red)]"
          style={{ animation: "chamberRespect 0.9s ease-out forwards" }}
        >
          F
        </span>
      ))}
    </button>
  );
}

// ── Le coup de grâce ───────────────────────────────────────────────────

export function HeroDeath({ clip, depth, reduce }: { clip: ChamberClip; depth: number; reduce: boolean }) {
  const boxRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const near = useNear(boxRef);
  useAutoplay(videoRef, near);
  const badge = badgeOf(clip);
  const context = contextOf(clip);
  const g = depth / 10;
  return (
    <article
      ref={boxRef}
      className="mx-auto mt-12 grid max-w-5xl items-center gap-8 md:grid-cols-[minmax(0,340px)_1fr]"
      aria-label={`Le coup de grâce du cercle ${depth}`}
    >
      <figure
        className="relative aspect-[9/16] w-full max-w-[340px] justify-self-center overflow-hidden rounded-2xl border bg-black"
        style={{
          borderColor: `rgba(232,64,87,${0.25 + g * 0.45})`,
          boxShadow: reduce ? "none" : `0 0 ${40 + g * 50}px rgba(232,64,87,${0.14 + g * 0.3})`,
        }}
      >
        {near ? (
          <video
            ref={videoRef}
            src={clip.clipUrl ?? undefined}
            poster={clip.thumbnailUrl ?? undefined}
            muted
            loop
            playsInline
            preload="none"
            className="h-full w-full object-cover"
            style={{ filter: gradeFilter(depth) }}
          />
        ) : (
          <div className="h-full w-full bg-white/[0.03]" />
        )}
        <Link
          href={`/kill/${clip.id}`}
          aria-label={`Revoir la mort : ${clip.victimChampion ?? "?"} face à ${clip.killerChampion ?? "?"}`}
          className="absolute inset-0 z-[5]"
        />
      </figure>
      <div className="text-center md:text-left">
        <p className="font-data text-[10px] uppercase tracking-[0.45em] text-[var(--red)]">Le coup de grâce</p>
        {badge && (
          <span className="mt-3 inline-block rounded-sm bg-[var(--red)]/85 px-2 py-0.5 font-data text-[10px] font-bold uppercase tracking-[0.18em] text-white">
            {badge}
          </span>
        )}
        <h3 className="mt-3 font-display text-3xl font-black uppercase leading-[0.95] text-[var(--gold-bright)] sm:text-5xl">
          {clip.victimChampion ?? "?"}
          <span className="mx-2 font-[family-name:var(--font-cormorant)] text-2xl font-medium normal-case italic text-white/45 sm:text-3xl">
            tombe face à
          </span>
          {clip.killerChampion ?? "?"}
        </h3>
        {context && <p className="mt-3 font-data text-[11px] uppercase tracking-[0.2em] text-white/50">{context}</p>}
        {clip.description && (
          <blockquote className="mt-5 border-l-2 border-[var(--red)]/50 pl-4 text-left font-[family-name:var(--font-cormorant)] text-xl italic leading-snug text-white/75 sm:text-2xl">
            {clip.description}
          </blockquote>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3 md:justify-start">
          <RespectButton killId={clip.id} reduce={reduce} large />
          <Link
            href={`/kill/${clip.id}`}
            className="rounded-md border border-white/15 px-4 py-3 font-data text-[11px] uppercase tracking-[0.2em] text-white/70 transition-colors hover:border-[var(--gold)] hover:text-[var(--gold)]"
          >
            Revoir la mort →
          </Link>
        </div>
      </div>
    </article>
  );
}

// ── Les autres morts du cercle ─────────────────────────────────────────

function RailCard({ clip, depth, reduce }: { clip: ChamberClip; depth: number; reduce: boolean }) {
  const boxRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const near = useNear(boxRef);
  useAutoplay(videoRef, near);
  const badge = badgeOf(clip);
  return (
    <figure
      ref={boxRef}
      className="group relative aspect-[9/16] w-[46vw] max-w-[200px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-black sm:w-[190px]"
    >
      <div className="absolute right-1.5 top-1.5 z-10">
        <RespectButton killId={clip.id} reduce={reduce} />
      </div>
      {near ? (
        <video
          ref={videoRef}
          src={clip.clipUrlLow ?? clip.clipUrl ?? undefined}
          poster={clip.thumbnailUrl ?? undefined}
          muted
          loop
          playsInline
          preload="none"
          className="h-full w-full object-cover"
          style={{ filter: gradeFilter(depth) }}
        />
      ) : (
        <div className="h-full w-full bg-white/[0.03]" />
      )}
      <Link
        href={`/kill/${clip.id}`}
        aria-label={`Voir la mort : ${clip.victimChampion ?? "?"} face à ${clip.killerChampion ?? "?"}`}
        className="absolute inset-0 z-[5]"
      />
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-2.5">
        {badge && (
          <span className="mb-1 inline-block rounded-sm bg-[var(--red)]/85 px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-[0.12em] text-white">
            {badge}
          </span>
        )}
        <p className="truncate font-data text-[11px] text-white/85">
          {clip.victimChampion ?? "?"}
          <span className="text-white/40"> tombe face à </span>
          {clip.killerChampion ?? "?"}
        </p>
        {clip.opponent && <p className="font-data text-[9px] uppercase tracking-[0.18em] text-white/45">vs {clip.opponent}</p>}
      </figcaption>
    </figure>
  );
}

export function DeathRail({ clips, depth, reduce }: { clips: ChamberClip[]; depth: number; reduce: boolean }) {
  if (clips.length === 0) return null;
  return (
    <div className="mx-auto mt-12 max-w-6xl">
      <p className="mb-3 px-1 font-data text-[10px] uppercase tracking-[0.35em] text-white/40">
        Les autres morts du cercle · {clips.length}
      </p>
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 [scrollbar-width:thin]"
        role="list"
        aria-label="Autres morts du cercle"
      >
        {clips.map((clip) => (
          <div role="listitem" key={clip.id} className="contents">
            <RailCard clip={clip} depth={depth} reduce={reduce} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Moments Maudits ────────────────────────────────────────────────────

export function LoreMomentCard({ moment, depth, reduce }: { moment: ChamberLoreMoment; depth: number; reduce: boolean }) {
  const [playing, setPlaying] = useState(false);
  const g = depth / 10;
  return (
    <figure
      className="relative overflow-hidden rounded-2xl border bg-black/55 backdrop-blur-md"
      style={{
        borderColor: `rgba(232,64,87,${0.15 + g * 0.35})`,
        boxShadow: depth >= 8 && !reduce ? "0 0 32px rgba(232,64,87,0.22)" : "none",
      }}
    >
      <div className="relative aspect-video w-full bg-black">
        {playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${moment.youtubeId}?autoplay=1&rel=0`}
            title={moment.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Regarder : ${moment.title}`} className="group absolute inset-0 h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- vignette YouTube externe */}
            <img
              src={`https://img.youtube.com/vi/${moment.youtubeId}/hqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              style={{ filter: `grayscale(${(g * 0.7).toFixed(2)}) sepia(${(g * 0.3).toFixed(2)}) brightness(${(0.95 - g * 0.2).toFixed(2)})` }}
              loading="lazy"
            />
            <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/15">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--red)]/70 bg-black/70 text-xl text-[var(--red)] backdrop-blur-sm transition-transform group-hover:scale-110">
                ▶
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="space-y-1.5 p-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--red)]/40 bg-[var(--red)]/10 px-2 py-0.5 font-data text-[9px] uppercase tracking-[0.25em] text-[var(--red)]">
            Moment maudit
          </span>
          <span className="font-data text-[10px] uppercase tracking-[0.2em] text-white/40">{moment.era}</span>
        </div>
        <h3 className="text-2xl leading-tight text-[var(--gold-bright)]" style={{ ...SERIF, fontWeight: 600 }}>{moment.title}</h3>
        <p className="font-[family-name:var(--font-cormorant)] text-[17px] italic leading-relaxed text-white/65">{moment.story}</p>
      </figcaption>
    </figure>
  );
}
