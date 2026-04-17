"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import type { ScoredVideo } from "@/lib/youtube-scoring";

interface Props {
  videos: ScoredVideo[];
}

/**
 * Cinematic YouTube ribbon — a slowly-drifting band of oversized cards
 * with deep 3D parallax. Inspired by Apple TV's hero rail and Cover Flow.
 *
 * The track auto-scrolls right-to-left at a hypnotic pace; pointer hover,
 * keyboard focus, or an active drag all pause the drift instantly. Each
 * card's rotation, depth, and saturation update every frame from its
 * live screen-space position so the parallax follows the gesture rather
 * than a snap index.
 *
 * The video list is rendered twice back-to-back so the ribbon loops
 * seamlessly — when the cumulative offset reaches one cycle width we
 * subtract it and the user never sees a jump.
 *
 * Honors `prefers-reduced-motion` by freezing the auto-drift and
 * collapsing the per-card transforms.
 */
export function YouTubeParallaxCarousel({ videos }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);

  // Position is the cumulative px offset of the track. We keep it in a
  // ref to avoid re-rendering at 60Hz — instead we mutate inline styles
  // on the DOM nodes directly inside the rAF loop.
  const positionRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startPos: number;
    moved: boolean;
  } | null>(null);

  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [playing, setPlaying] = useState<ScoredVideo | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const h = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Each card occupies CARD_STEP horizontally — the actual card is a bit
  // wider so adjacent cards visually overlap, which is what gives the
  // ribbon its dense, "band of film" feel.
  const CARD_W_VW = 56;          // viewport-relative width of one card
  const CARD_W_MAX = 740;        // hard cap on large screens (px)
  const STEP_RATIO = 0.66;       // step / card_width — < 1 means overlap
  const SPEED_PX_PER_S = 26;     // hypnotic drift, gentle on the eye
  const COPIES = 2;              // render the list twice → seamless loop

  // Duplicate the list so the loop is invisible. Keys are namespaced
  // with the copy index so React doesn't reuse DOM nodes across copies.
  const ribbon = useMemo(
    () =>
      Array.from({ length: COPIES }, (_, copy) =>
        videos.map((v, i) => ({ v, key: `${copy}-${v.videoId}-${i}`, copy, i })),
      ).flat(),
    [videos],
  );

  // ── Animation loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (videos.length === 0) return;
    let raf = 0;
    let last = performance.now();
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min(64, now - last); // cap dt so a tab-switch doesn't fling the ribbon
      last = now;

      const wrap = wrapRef.current;
      const track = trackRef.current;
      if (!wrap || !track) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const cardWidth = Math.min((wrap.clientWidth * CARD_W_VW) / 100, CARD_W_MAX);
      const step = cardWidth * STEP_RATIO;
      const cycleWidth = step * videos.length;

      const moving = !paused && !dragStateRef.current && !reducedMotion;
      if (moving) {
        positionRef.current += (SPEED_PX_PER_S * dt) / 1000;
      }

      // Wrap the cumulative offset back into [0, cycleWidth) so the
      // second copy of the array cleanly covers what the first copy left.
      if (positionRef.current >= cycleWidth) positionRef.current -= cycleWidth;
      if (positionRef.current < 0) positionRef.current += cycleWidth;

      track.style.transform = `translate3d(${-positionRef.current}px, 0, 0)`;

      // Per-card 3D transform — re-computed every frame so the parallax
      // tracks the ribbon's current position smoothly, not in snap steps.
      const wrapRect = wrap.getBoundingClientRect();
      const wrapCenter = wrapRect.left + wrapRect.width / 2;
      const halfRange = wrapRect.width * 0.55; // distance at which a card is fully tilted

      for (let idx = 0; idx < cardRefs.current.length; idx += 1) {
        const el = cardRefs.current[idx];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cardCenter = r.left + r.width / 2;
        const offsetN = (cardCenter - wrapCenter) / halfRange; // -1 to 1 across the screen
        const clamped = Math.max(-1.6, Math.min(1.6, offsetN));
        const abs = Math.abs(clamped);

        if (reducedMotion) {
          el.style.transform = "none";
          el.style.filter = "none";
          el.style.opacity = abs > 1.4 ? "0" : "1";
          el.style.zIndex = `${100 - Math.round(abs * 10)}`;
          continue;
        }

        const rotateY = -clamped * 24;          // ±24° at the screen edges
        const translateZ = -abs * 160;          // pushes side cards back
        const scale = 1 - abs * 0.1;            // gentle scale-down
        const baseTilt = 4;                     // baseline forward tilt for the whole ribbon
        el.style.transform = `translateZ(${translateZ}px) rotateY(${rotateY}deg) rotateX(${baseTilt - abs * 2}deg) scale(${scale})`;
        el.style.opacity = String(Math.max(0, 1 - abs * 0.42));
        el.style.filter = `saturate(${Math.max(0.55, 1 - abs * 0.28)}) brightness(${Math.max(0.65, 1 - abs * 0.18)})`;
        el.style.zIndex = `${200 - Math.round(abs * 50)}`;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [videos.length, paused, reducedMotion]);

  // ── Drag (pointer) ──────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startPos: positionRef.current,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    if (Math.abs(dx) > 6) s.moved = true;
    positionRef.current = s.startPos - dx;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointerId already released — ignore
    }
    dragStateRef.current = null;
  }, []);

  // Manual nudge buttons jump the position by ~one card. We cancel any
  // ongoing drag so the click feels deterministic.
  const nudge = useCallback(
    (direction: 1 | -1) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const cardWidth = Math.min((wrap.clientWidth * CARD_W_VW) / 100, CARD_W_MAX);
      const step = cardWidth * STEP_RATIO;
      positionRef.current += direction * step;
    },
    [],
  );

  // Open the lightbox unless the click was actually a drag.
  const handleCardClick = (v: ScoredVideo) => {
    const s = dragStateRef.current;
    if (s && s.moved) return; // suppress click after a real drag
    setPlaying(v);
  };

  if (videos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border-gold)] p-12 text-center text-sm text-[var(--text-muted)]">
        Aucune vidéo disponible pour l&apos;instant.
      </div>
    );
  }

  return (
    <>
      <div
        ref={wrapRef}
        className="parallax-carousel relative h-[480px] md:h-[560px] lg:h-[620px] w-full overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--gold)] focus-visible:rounded-2xl"
        style={{
          perspective: reducedMotion ? "none" : "1800px",
          perspectiveOrigin: "50% 60%",
          touchAction: "pan-y",
        }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Track wrapper — the global translateX is applied here on every
            animation frame so React doesn't re-render. */}
        <div
          ref={trackRef}
          className="absolute top-1/2 left-0 -translate-y-1/2"
          style={{
            transformStyle: "preserve-3d",
            willChange: "transform",
            cursor: dragStateRef.current ? "grabbing" : "grab",
          }}
        >
          {ribbon.map(({ v, key, i }, idx) => {
            const cardWidthCss = `min(${CARD_W_VW}vw, ${CARD_W_MAX}px)`;
            const cardHeightCss = `min(${CARD_W_VW * 0.5625}vw, ${CARD_W_MAX * 0.5625}px)`;
            // Each card is positioned along the track via `left = idx * step`.
            // The step is calculated in the same units (vw + px clamp) to
            // stay perfectly aligned with the per-card width.
            const leftCss = `calc((${cardWidthCss}) * ${STEP_RATIO} * ${idx})`;
            return (
              <article
                key={key}
                ref={(el) => {
                  cardRefs.current[idx] = el;
                }}
                className="parallax-card absolute top-1/2 -translate-y-1/2 will-change-transform"
                style={{
                  left: leftCss,
                  width: cardWidthCss,
                  transformStyle: "preserve-3d",
                  transition: dragStateRef.current
                    ? "none"
                    : "transform 60ms linear, filter 220ms ease, opacity 220ms ease",
                }}
                aria-roledescription="slide"
                aria-label={`${v.title} — chaîne ${v.channel.name}`}
              >
                {/* Title perched above the frame — always visible, not just
                    on hover. Subtle but legible. */}
                <header className="mb-3 px-1">
                  <p
                    className="font-data text-[10px] uppercase tracking-[0.25em] mb-1"
                    style={{ color: v.channel.color ?? "#C8AA6E" }}
                  >
                    {v.channel.name} · {formatRelative(v.publishedAt)}
                  </p>
                  <h3
                    className="font-display text-lg md:text-xl font-bold leading-tight text-white drop-shadow line-clamp-2"
                    style={{ textShadow: "0 2px 14px rgba(0,0,0,0.8)" }}
                  >
                    {v.title}
                  </h3>
                </header>

                {/* The frame itself — clickable, glowing accent border. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCardClick(v);
                  }}
                  aria-label={`Lire ${v.title}`}
                  className="group relative block w-full overflow-hidden rounded-3xl border bg-black shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
                  style={{
                    height: cardHeightCss,
                    borderColor: `${v.channel.color ?? "#C8AA6E"}55`,
                    boxShadow: `0 30px 90px rgba(0,0,0,0.55), 0 0 0 1px ${v.channel.color ?? "#C8AA6E"}30, 0 0 60px ${v.channel.color ?? "#C8AA6E"}18`,
                  }}
                >
                  <Image
                    src={v.thumbnailUrl}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 60vw, 740px"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                  {/* Accent gradient for warmth on the channel colour. */}
                  <div
                    className="absolute inset-0 mix-blend-overlay opacity-25"
                    style={{
                      background: `radial-gradient(circle at 50% 30%, ${v.channel.color ?? "#C8AA6E"}55 0%, transparent 70%)`,
                    }}
                  />
                  {/* Bottom darken so the views pill stays legible. */}
                  <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

                  {/* Channel pill — top-left, redundant with the header but
                      reinforces the brand at a glance. */}
                  <span
                    className="absolute top-4 left-4 rounded-full border bg-black/55 backdrop-blur-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"
                    style={{
                      color: v.channel.color ?? "#C8AA6E",
                      borderColor: `${v.channel.color ?? "#C8AA6E"}60`,
                    }}
                  >
                    {v.channel.name}
                  </span>

                  {/* Centred play affordance with a soft ring of accent. */}
                  <span
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    aria-hidden
                  >
                    <span
                      className="flex h-20 w-20 md:h-24 md:w-24 items-center justify-center rounded-full backdrop-blur-md transition-transform duration-300 group-hover:scale-110"
                      style={{
                        backgroundColor: `${v.channel.color ?? "#C8AA6E"}28`,
                        border: `2px solid ${v.channel.color ?? "#C8AA6E"}90`,
                        boxShadow: `0 0 50px ${v.channel.color ?? "#C8AA6E"}55`,
                      }}
                    >
                      <svg
                        className="h-8 w-8 md:h-10 md:w-10 translate-x-0.5 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </span>

                  {/* Bottom row — views & date pills. */}
                  <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-3">
                    <span className="rounded-full bg-black/55 backdrop-blur-md px-3 py-1.5 text-[10px] font-data uppercase tracking-[0.18em] text-white/75">
                      {v.views !== null ? formatViews(v.views) : v.channel.tagline ?? ""}
                    </span>
                    <span className="rounded-full bg-black/55 backdrop-blur-md px-3 py-1.5 text-[10px] font-data tracking-wider text-white/70">
                      {formatRelative(v.publishedAt)}
                    </span>
                  </div>
                </button>
              </article>
            );
          })}
        </div>

        {/* Edge fade masks so cards bleed off rather than getting clipped. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-32 md:w-56 z-[300]"
          style={{
            background: "linear-gradient(to right, var(--bg-primary) 0%, transparent 100%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-32 md:w-56 z-[300]"
          style={{
            background: "linear-gradient(to left, var(--bg-primary) 0%, transparent 100%)",
          }}
        />

        {/* Manual nudge buttons — overlay style, only visible on hover/focus. */}
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="Reculer"
          className="group absolute left-4 md:left-10 top-1/2 -translate-y-1/2 z-[310] flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-md text-white opacity-0 transition-all hover:bg-black/70 hover:scale-110 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
          style={{ animation: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="Avancer"
          className="group absolute right-4 md:right-10 top-1/2 -translate-y-1/2 z-[310] flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-md text-white opacity-0 transition-all hover:bg-black/70 hover:scale-110 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Tiny "drift" indicator + paused state — discreet bottom-right hint. */}
        <div className="absolute bottom-4 right-6 z-[310] flex items-center gap-2 text-[10px] font-data uppercase tracking-[0.25em] text-white/35">
          <span
            className="h-1.5 w-1.5 rounded-full transition-colors duration-300"
            style={{
              backgroundColor: paused ? "var(--gold)" : "rgba(255,255,255,0.3)",
              boxShadow: paused ? "0 0 10px var(--gold)" : "none",
            }}
          />
          {paused ? "En pause" : "Lecture continue"}
        </div>
      </div>

      {playing && (
        <YouTubeLightbox video={playing} onClose={() => setPlaying(null)} />
      )}
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (days < 1) return "Aujourd'hui";
  if (days < 2) return "Hier";
  if (days < 7) return `Il y a ${Math.floor(days)} j`;
  if (days < 30) return `Il y a ${Math.floor(days / 7)} sem`;
  if (days < 365) return `Il y a ${Math.floor(days / 30)} mois`;
  return `Il y a ${Math.floor(days / 365)} an${Math.floor(days / 365) > 1 ? "s" : ""}`;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M vues`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K vues`;
  return `${n} vues`;
}

// ─── Lightbox ───────────────────────────────────────────────────────────

function YouTubeLightbox({
  video,
  onClose,
}: {
  video: ScoredVideo;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", h);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", h);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={video.title}
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-3xl border border-[var(--gold)]/40 shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <iframe
          title={video.title}
          src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&rel=0&modestbranding=1`}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute top-6 right-6 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-black/80"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <a
        href={`https://www.youtube.com/watch?v=${video.videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-6 right-6 flex items-center gap-2 rounded-full bg-red-600/90 backdrop-blur-md border border-red-500/50 px-4 py-2 text-xs font-bold text-white hover:bg-red-600"
      >
        Voir sur YouTube
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}
