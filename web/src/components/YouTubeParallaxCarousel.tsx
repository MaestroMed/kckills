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
 * Cover-Flow inspired 3D parallax carousel for the homepage YouTube
 * showcase. Cards live on a horizontal track with deep CSS perspective:
 * the centre card sits flat and full-size, neighbours rotate away on
 * the Y axis and scale down — Apple Music's "Featured" rail in spirit.
 *
 * Interaction model:
 *  - Mouse / touch drag scrubs the active index.
 *  - Wheel: horizontal trackpad swipes nudge by ±1.
 *  - Keyboard: ←/→ arrows and Home/End once the carousel has focus.
 *  - Tap a side card to jump to it; tap the centre card to play.
 *
 * Playback opens YouTube's privacy-friendly nocookie embed in a
 * full-screen lightbox so users never leave the site. Esc / overlay
 * tap closes.
 *
 * Honors `prefers-reduced-motion` by collapsing the 3D transforms to a
 * flat snap-rail.
 */
export function YouTubeParallaxCarousel({ videos }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [playing, setPlaying] = useState<ScoredVideo | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startActive: number;
    cardWidth: number;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const h = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Clamp & wrap helpers — we don't loop but we do clamp so swiping past
  // the edge feels rubbery rather than dead.
  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(videos.length - 1, i));
      setActive(clamped);
    },
    [videos.length],
  );

  // ── Pointer drag (mouse + touch share PointerEvent) ────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cardW = trackRef.current.clientWidth / 4; // approx — see render math
    dragStateRef.current = {
      startX: e.clientX,
      startActive: active,
      cardWidth: cardW,
    };
    setDragOffset(0);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    setDragOffset(dx);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const dx = e.clientX - s.startX;
    const stepThreshold = Math.max(40, s.cardWidth * 0.25);
    const steps = Math.round(-dx / stepThreshold);
    if (steps !== 0) goTo(s.startActive + steps);
    dragStateRef.current = null;
    setDragOffset(0);
  };

  // ── Wheel (trackpad horizontal scroll) ──────────────────────────────
  const wheelAccum = useRef({ x: 0, t: 0 });
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      // Only respond to dominant horizontal scrolls so the carousel
      // doesn't hijack page scrolling.
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAccum.current.t > 200) wheelAccum.current.x = 0;
      wheelAccum.current.t = now;
      wheelAccum.current.x += e.deltaX;
      if (Math.abs(wheelAccum.current.x) > 60) {
        goTo(active + (wheelAccum.current.x > 0 ? 1 : -1));
        wheelAccum.current.x = 0;
      }
    },
    [active, goTo],
  );

  // ── Keyboard ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const h = (e: KeyboardEvent) => {
      if (!el.contains(document.activeElement) && document.activeElement !== el) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(active + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(active - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(videos.length - 1);
      } else if ((e.key === "Enter" || e.key === " ") && videos[active]) {
        e.preventDefault();
        setPlaying(videos[active]);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, goTo, videos]);

  // ── Card geometry ────────────────────────────────────────────────────
  const cards = useMemo(
    () =>
      videos.map((v, i) => {
        const offset = i - active;
        return { v, i, offset };
      }),
    [videos, active],
  );

  if (videos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border-gold)] p-12 text-center text-sm text-[var(--text-muted)]">
        Aucune vidéo disponible pour l&apos;instant.
      </div>
    );
  }

  // We pre-compute the px offset of the "drag glide" so the centre slug
  // tracks the finger 1:1 even before the snap commits.
  const dragPx = dragOffset;

  return (
    <>
      <div
        ref={trackRef}
        tabIndex={0}
        role="listbox"
        aria-label="Vidéos YouTube Karmine Corp"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="parallax-carousel relative h-[420px] md:h-[480px] w-full select-none overflow-visible focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--gold)] focus-visible:rounded-2xl"
        style={{
          perspective: reducedMotion ? "none" : "1400px",
          perspectiveOrigin: "50% 55%",
          touchAction: "pan-y",
          cursor: dragStateRef.current ? "grabbing" : "grab",
        }}
      >
        {cards.map(({ v, i, offset }) => {
          const abs = Math.abs(offset);
          const visible = abs <= 4; // render up to 4 cards each side
          if (!visible) return null;

          // Translate by index offset, plus the live drag delta on the
          // active card so the gesture feels glued to the finger.
          const translateX = reducedMotion
            ? offset * 280
            : offset * 220 + (offset === 0 ? dragPx : dragPx * 0.4);

          // Cards farther from center push back in Z and rotate away.
          const rotateY = reducedMotion ? 0 : Math.max(-55, Math.min(55, -offset * 22));
          const translateZ = reducedMotion ? 0 : -abs * 110;
          const scale = reducedMotion ? (offset === 0 ? 1 : 0.92) : Math.max(0.55, 1 - abs * 0.12);
          const opacity = abs <= 1 ? 1 : Math.max(0.2, 1 - abs * 0.22);
          const zIndex = 100 - abs;

          return (
            <button
              key={v.videoId}
              type="button"
              role="option"
              aria-selected={offset === 0}
              aria-label={`${v.title} — chaîne ${v.channel.name}`}
              tabIndex={offset === 0 ? 0 : -1}
              onClick={() => {
                if (offset === 0) {
                  setPlaying(v);
                } else {
                  goTo(i);
                }
              }}
              className="parallax-card absolute left-1/2 top-1/2 origin-center will-change-transform"
              style={{
                width: "min(72vw, 640px)",
                height: "min(40.5vw, 360px)", // 16:9 of width
                transform: `translate3d(calc(-50% + ${translateX}px), -50%, ${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                opacity,
                zIndex,
                transition: dragStateRef.current
                  ? "none"
                  : "transform 700ms cubic-bezier(0.16, 1, 0.3, 1), opacity 500ms ease",
                pointerEvents: abs <= 2 ? "auto" : "none",
                filter: offset === 0 ? "none" : `saturate(${Math.max(0.5, 1 - abs * 0.18)}) brightness(${Math.max(0.6, 1 - abs * 0.12)})`,
              }}
            >
              <article
                className="relative h-full w-full overflow-hidden rounded-3xl border bg-black shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
                style={{
                  borderColor: offset === 0 ? `${v.channel.color ?? "#C8AA6E"}80` : "rgba(255,255,255,0.08)",
                  boxShadow:
                    offset === 0
                      ? `0 30px 90px ${v.channel.color ?? "#C8AA6E"}30, 0 0 0 1px ${v.channel.color ?? "#C8AA6E"}55`
                      : undefined,
                }}
              >
                <Image
                  src={v.thumbnailUrl}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 72vw, 640px"
                  priority={abs <= 1}
                  className="object-cover"
                />
                {/* Cinematic gradient stack — keeps the title legible while
                    letting the YouTube thumb breathe through. */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent" />
                <div
                  className="absolute inset-0 mix-blend-overlay opacity-30"
                  style={{
                    background: `radial-gradient(circle at 50% 35%, ${v.channel.color ?? "#C8AA6E"}40 0%, transparent 70%)`,
                  }}
                />

                {/* Top-left: channel pill */}
                <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                  <span
                    className="rounded-full border bg-black/55 backdrop-blur-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em]"
                    style={{
                      color: v.channel.color ?? "#C8AA6E",
                      borderColor: `${v.channel.color ?? "#C8AA6E"}55`,
                    }}
                  >
                    {v.channel.name}
                  </span>
                </div>

                {/* Top-right: relative date */}
                <div className="absolute top-4 right-4 z-10">
                  <span className="rounded-full bg-black/50 backdrop-blur-md px-3 py-1.5 text-[10px] font-data tracking-wider text-white/70">
                    {formatRelative(v.publishedAt)}
                  </span>
                </div>

                {/* Centred play affordance — only on the active card */}
                {offset === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span
                      className="flex h-20 w-20 items-center justify-center rounded-full backdrop-blur-md transition-transform duration-300 group-hover:scale-110"
                      style={{
                        backgroundColor: `${v.channel.color ?? "#C8AA6E"}30`,
                        border: `2px solid ${v.channel.color ?? "#C8AA6E"}90`,
                        boxShadow: `0 0 40px ${v.channel.color ?? "#C8AA6E"}60`,
                      }}
                    >
                      <svg
                        className="h-7 w-7 translate-x-0.5 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </div>
                )}

                {/* Bottom: title + meta */}
                <div className="absolute inset-x-0 bottom-0 z-10 p-5 md:p-6">
                  <p
                    className="font-display text-base md:text-lg font-bold leading-tight text-white drop-shadow-lg line-clamp-2"
                    style={{ textShadow: "0 2px 14px rgba(0,0,0,0.85)" }}
                  >
                    {v.title}
                  </p>
                  {(v.views !== null || v.channel.tagline) && (
                    <p className="mt-2 text-[11px] font-data uppercase tracking-[0.18em] text-white/60">
                      {v.views !== null ? formatViews(v.views) : v.channel.tagline}
                    </p>
                  )}
                </div>
              </article>
            </button>
          );
        })}

        {/* Side fade masks so far cards bleed off rather than getting clipped */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-24 md:w-40 z-[200]"
          style={{
            background:
              "linear-gradient(to right, var(--bg-primary) 0%, transparent 100%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-24 md:w-40 z-[200]"
          style={{
            background:
              "linear-gradient(to left, var(--bg-primary) 0%, transparent 100%)",
          }}
        />
      </div>

      {/* Indicator + manual nav under the rail */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          aria-label="Vidéo précédente"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--gold)] transition-all hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-1.5">
          {videos.map((v, i) => (
            <button
              key={v.videoId}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Aller à la vidéo ${i + 1}`}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === active ? 28 : 8,
                backgroundColor:
                  i === active ? v.channel.color ?? "#C8AA6E" : "rgba(255,255,255,0.25)",
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => goTo(active + 1)}
          disabled={active === videos.length - 1}
          aria-label="Vidéo suivante"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--gold)] transition-all hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
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
  if (days < 1) return "Aujourd\u2019hui";
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
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
