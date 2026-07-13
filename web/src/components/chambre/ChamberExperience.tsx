"use client";

/**
 * La Chambre des Souffrances — the immersive descent (client).
 *
 * A 10-circle plunge through Karmine Corp's worst deaths, each circle worse
 * than the last. As the viewer scrolls deeper, a stress gauge climbs and the
 * whole scene curdles — desaturating, tinting red, the vignette closing in,
 * a heartbeat quickening. Orochimaru's-lab dread, not gore.
 *
 * Accessibility : everything animated is gated behind `prefers-reduced-motion`
 * — under it the descent still darkens by circle but nothing pulses or shakes.
 * A persistent REMONTER control always escapes back to the surface (/).
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { ChamberCircle, ChamberClip } from "@/lib/supabase/chamber";

const MULTI_LABEL: Record<string, string> = {
  penta: "PENTAKILL SUBI",
  quadra: "QUADRA SUBI",
  triple: "TRIPLE SUBI",
  double: "DOUBLE SUBI",
};

export function ChamberExperience({ circles }: { circles: ChamberCircle[] }) {
  const reduce = useReducedMotion() ?? false;
  const [entered, setEntered] = useState(false);
  // Current circle depth in the viewport centre (1 shallow → 10 deepest).
  const [depth, setDepth] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const maxDepth = circles.length ? Math.max(...circles.map((c) => c.depth)) : 10;
  const stress = Math.min(1, depth / 10);

  const totalClips = circles.reduce((n, c) => n + c.clips.length, 0);

  if (circles.length === 0) {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-[#03060c] px-6 text-center">
        <div className="max-w-md">
          <p className="font-display text-2xl text-[var(--red)]">La Chambre est scellée</p>
          <p className="mt-3 text-sm text-white/60">
            Aucune souffrance n&apos;a encore été archivée. Reviens quand les
            clips auront été moissonnés.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full border border-white/20 px-5 py-2 text-sm text-white/80 hover:border-[var(--gold)] hover:text-[var(--gold)]"
          >
            Remonter
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden bg-[#03060c]"
      style={{ scrollBehavior: reduce ? "auto" : "smooth" }}
    >
      {/* ── Grade overlays (fixed, pointer-events-none) ─────────────── */}
      <GradeOverlay stress={stress} reduce={reduce} />

      {/* ── Persistent HUD : stress gauge + escape ──────────────────── */}
      <StressGauge stress={stress} depth={depth} maxDepth={maxDepth} reduce={reduce} />
      <Link
        href="/"
        aria-label="Remonter à la surface"
        className="fixed left-4 top-4 z-[95] flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-4 py-2 font-data text-[11px] uppercase tracking-[0.25em] text-white/70 backdrop-blur-sm transition-colors hover:border-[var(--gold)] hover:text-[var(--gold)]"
      >
        ↑ Remonter
      </Link>

      {!entered ? (
        <EntryGate totalClips={totalClips} onEnter={() => setEntered(true)} />
      ) : (
        <>
          {circles.map((circle) => (
            <CircleSection
              key={circle.depth}
              circle={circle}
              onActive={setDepth}
              reduce={reduce}
            />
          ))}
          <ExitCard />
          <RiotDisclaimer />
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// EntryGate — the warning + stress preview + "Descendre" CTA.
// ════════════════════════════════════════════════════════════════════

function EntryGate({
  totalClips,
  onEnter,
}: {
  totalClips: number;
  onEnter: () => void;
}) {
  return (
    <section className="relative grid min-h-[100dvh] place-items-center px-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, rgba(232,64,87,0.12), transparent 60%)",
        }}
      />
      <div className="relative z-10 max-w-lg">
        <p className="font-data text-[11px] uppercase tracking-[0.5em] text-[var(--red)]">
          Avertissement
        </p>
        <h1 className="mt-4 font-display text-4xl font-black leading-tight text-[var(--gold-bright)] sm:text-5xl">
          La Chambre
          <br />
          des Souffrances
        </h1>
        <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-white/70">
          Dix cercles. {totalClips} morts de la Karmine Corp, du simple faux-pas
          au pentakill encaissé. Chaque cercle est pire que le précédent.
          La pression monte à mesure que tu descends. Tu peux remonter à tout
          moment.
        </p>
        <button
          type="button"
          onClick={onEnter}
          className="group mt-9 inline-flex items-center gap-3 rounded-full border-2 border-[var(--red)]/60 bg-[var(--red)]/10 px-8 py-3.5 font-display text-lg font-bold uppercase tracking-[0.15em] text-[var(--red)] transition-all hover:border-[var(--red)] hover:bg-[var(--red)]/20 hover:shadow-[0_0_40px_rgba(232,64,87,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--red)] focus-visible:outline-offset-2"
        >
          Descendre
          <span aria-hidden className="transition-transform group-hover:translate-y-0.5">
            ↓
          </span>
        </button>
        <p className="mt-6 font-data text-[10px] uppercase tracking-[0.3em] text-white/30">
          Sons, désaturation, vignette — respecte prefers-reduced-motion
        </p>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// CircleSection — one circle : header + a grid of its deaths.
// ════════════════════════════════════════════════════════════════════

function CircleSection({
  circle,
  onActive,
  reduce,
}: {
  circle: ChamberCircle;
  onActive: (depth: number) => void;
  reduce: boolean;
}) {
  const ref = useRef<HTMLElement>(null);

  // When this circle occupies the viewport centre, it becomes the "current"
  // depth driving the grade. A thin centre band avoids two circles fighting.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) onActive(circle.depth);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [circle.depth, onActive]);

  return (
    <section
      ref={ref}
      aria-label={`Cercle ${circle.depth} — ${circle.name}`}
      className="relative border-t border-white/5 px-4 py-14 sm:px-8"
    >
      {/* Circle header */}
      <div className="mx-auto mb-8 max-w-6xl">
        <div className="flex items-baseline gap-3">
          <span
            className="font-data text-[11px] uppercase tracking-[0.4em]"
            style={{ color: `rgba(232,64,87,${0.4 + circle.depth * 0.06})` }}
          >
            Cercle {circle.depth} / 10
          </span>
          <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-[var(--red)]/40 to-transparent" />
        </div>
        <h2
          className="mt-2 font-display font-black leading-none"
          style={{
            fontSize: `clamp(1.75rem, ${2 + circle.depth * 0.35}vw, ${2.4 + circle.depth * 0.25}rem)`,
            color: circle.depth >= 9 ? "var(--red)" : "var(--gold-bright)",
            textShadow:
              circle.depth >= 8 && !reduce
                ? `0 0 ${circle.depth * 3}px rgba(232,64,87,0.5)`
                : "none",
          }}
        >
          {circle.name}
        </h2>
        <p className="mt-1.5 text-sm italic text-white/45">{circle.tagline}</p>
      </div>

      {/* Deaths grid */}
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {circle.clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} intense={circle.depth >= 8} reduce={reduce} />
        ))}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// ClipCard — a single death. Video plays only while in view.
// ════════════════════════════════════════════════════════════════════

function ClipCard({
  clip,
  intense,
  reduce,
}: {
  clip: ChamberClip;
  intense: boolean;
  reduce: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setPlay(e.isIntersecting);
        if (e.isIntersecting) {
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const src = clip.clipUrlLow ?? clip.clipUrl ?? undefined;
  const badge = clip.multiKill ? MULTI_LABEL[clip.multiKill] : clip.isFirstBlood ? "FIRST BLOOD SUBI" : null;

  return (
    <figure
      className="group relative aspect-[9/16] overflow-hidden rounded-lg border border-white/8 bg-black"
      style={{
        boxShadow: intense && !reduce ? "0 0 24px rgba(232,64,87,0.18)" : "none",
      }}
    >
      <video
        ref={ref}
        src={src}
        poster={clip.thumbnailUrl ?? undefined}
        muted
        loop
        playsInline
        preload="none"
        className="h-full w-full object-cover"
        style={{ opacity: play ? 1 : 0.85 }}
      />
      {/* bottom scrim + caption */}
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5">
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
      </figcaption>
    </figure>
  );
}

// ════════════════════════════════════════════════════════════════════
// GradeOverlay — the escalating dread : vignette + red wash + desaturation,
// all scaling with `stress` (0→1). Fixed, non-interactive.
// ════════════════════════════════════════════════════════════════════

function GradeOverlay({ stress, reduce }: { stress: number; reduce: boolean }) {
  // Desaturate + close the vignette as we descend. Under reduced motion we
  // keep the static darkening but drop the heartbeat pulse.
  return (
    <>
      {/* Desaturation via backdrop-filter — grades the content behind it. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[88]"
        style={{
          backdropFilter: `saturate(${1 - stress * 0.7}) contrast(${1 + stress * 0.12}) brightness(${1 - stress * 0.18})`,
          WebkitBackdropFilter: `saturate(${1 - stress * 0.7}) contrast(${1 + stress * 0.12}) brightness(${1 - stress * 0.18})`,
        }}
      />
      {/* Red wash + vignette. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[90]"
        style={{
          background: `radial-gradient(ellipse at 50% 45%, transparent ${55 - stress * 30}%, rgba(120,0,10,${stress * 0.32}) 88%, rgba(0,0,0,${0.35 + stress * 0.5}) 100%)`,
          transition: reduce ? "none" : "background 0.6s ease-out",
        }}
      />
      {/* Heartbeat — a faint red breath that quickens with stress. */}
      {!reduce && stress > 0.15 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[89]"
          style={{
            background:
              "radial-gradient(ellipse at 50% 55%, rgba(232,64,87,0.10), transparent 70%)",
            animation: `chamberPulse ${Math.max(0.5, 1.5 - stress)}s ease-in-out infinite`,
            opacity: stress,
          }}
        />
      )}
      <style>{`@keyframes chamberPulse{0%,100%{opacity:${stress * 0.4}}50%{opacity:${stress}}}`}</style>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// StressGauge — a vertical fear meter pinned to the right edge.
// ════════════════════════════════════════════════════════════════════

function StressGauge({
  stress,
  depth,
  maxDepth,
  reduce,
}: {
  stress: number;
  depth: number;
  maxDepth: number;
  reduce: boolean;
}) {
  const pct = Math.round(stress * 100);
  return (
    <div className="fixed right-3 top-1/2 z-[95] flex -translate-y-1/2 flex-col items-center gap-2">
      <span className="font-data text-[9px] uppercase tracking-[0.2em] text-white/50">
        Stress
      </span>
      <div className="relative h-40 w-2.5 overflow-hidden rounded-full border border-white/15 bg-black/50">
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            height: `${pct}%`,
            background:
              "linear-gradient(to top, var(--red), #ff9a3c 55%, var(--gold))",
            transition: reduce ? "none" : "height 0.5s ease-out",
            boxShadow: !reduce && stress > 0.6 ? "0 0 12px rgba(232,64,87,0.7)" : "none",
          }}
        />
      </div>
      <span
        className="font-data text-[11px] font-bold tabular-nums"
        style={{ color: stress > 0.6 ? "var(--red)" : "var(--gold)" }}
      >
        {pct}%
      </span>
      <span className="font-data text-[9px] uppercase tracking-[0.15em] text-white/40">
        {depth}/{maxDepth}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ExitCard + Riot disclaimer — the floor of the Chambre.
// ════════════════════════════════════════════════════════════════════

function ExitCard() {
  return (
    <section className="relative grid min-h-[70dvh] place-items-center px-6 text-center">
      <div className="max-w-md">
        <p className="font-data text-[11px] uppercase tracking-[0.4em] text-[var(--red)]">
          Tu as tout vu
        </p>
        <h2 className="mt-3 font-display text-3xl font-black text-[var(--gold-bright)]">
          On remonte ?
        </h2>
        <p className="mt-3 text-sm text-white/60">
          La Karmine Corp s&apos;est relevée de chacune de ces morts. Va voir
          ses meilleurs kills pour t&apos;en remettre.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/scroll"
            style={{ background: "var(--gold-gradient)" }}
            className="rounded-full px-6 py-3 font-display text-sm font-bold uppercase tracking-[0.1em] text-[#1a1206] transition-transform hover:scale-105"
          >
            Voir les kills
          </Link>
          <Link
            href="/"
            className="rounded-full border border-white/20 px-6 py-3 text-sm text-white/80 hover:border-[var(--gold)] hover:text-[var(--gold)]"
          >
            Accueil
          </Link>
        </div>
      </div>
    </section>
  );
}

function RiotDisclaimer() {
  return (
    <p className="px-6 pb-10 text-center text-[9px] leading-relaxed text-white/25">
      KCKILLS was created under Riot Games&apos; &ldquo;Legal Jibber Jabber&rdquo;
      policy using assets owned by Riot Games. Riot Games does not endorse or
      sponsor this project.
    </p>
  );
}
