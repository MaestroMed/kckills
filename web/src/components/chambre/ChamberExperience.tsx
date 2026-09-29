"use client";

/**
 * La Chambre des Souffrances — la descente (refonte du 29/09/2026).
 *
 * Un puits sans fond en 3D (abyss-gl) que la caméra descend au rythme du
 * scroll : un anneau de lumière à chaque cercle, la pierre qui rougit, la
 * lueur de l'Enfer qui grandit au fond, des cendres puis des braises qui
 * montent, un cœur qui s'emballe (62 → 177 battements par minute, audible
 * et visible). Dix cercles de douze morts de la Karmine Corp, de la mort
 * isolée au pentakill encaissé (lib/supabase/chamber) : un chiffre romain
 * monumental, les Moments Maudits du cercle, le coup de grâce en grand,
 * puis les autres morts en rail. Au fond, on remonte vers la lumière.
 *
 * Accessibilité : reduced-motion → puits figé (une image par cercle), ni
 * tremblement ni glitch ni pulsation ; « Surface » ramène à l'accueil à tout
 * moment ; tout le contenu reste du HTML (lecteurs d'écran, clavier).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { ChamberCircle } from "@/lib/supabase/chamber";
import { loreForDepth } from "@/lib/chamber-lore";
import { ABYSS_RING, mountAbyss, type AbyssHandle } from "./abyss-gl";
import { ChamberAudio } from "./ChamberAudio";
import { DeathRail, HeroDeath, LoreMomentCard, useSessionRespects } from "./cards";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const METERS_PER_CIRCLE = 100;
/** Position continue x (0 = premier cercle, 10 = le fond) → battements par minute. */
const bpmAt = (x: number) => Math.round(62 + Math.min(10, Math.max(0, x)) * 11.5);
const GATE_DEPTH = -0.8 * ABYSS_RING;
/** Titres en serif : la règle globale h1-h4 (Oswald, majuscules) est hors layer et bat les utilitaires Tailwind. */
const SERIF = { fontFamily: "var(--font-cormorant), 'Cormorant Garamond', Georgia, serif", textTransform: "none", letterSpacing: "0" } as const;

function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

export function ChamberExperience({ circles }: { circles: ChamberCircle[] }) {
  const reduce = useReducedMotion() ?? false;
  const router = useRouter();
  const [entered, setEntered] = useState(false);
  const [ascending, setAscending] = useState(false);
  // cercle courant (1-10) et position continue x (cercles parcourus)
  const [pos, setPos] = useState({ depth: 1, x: 0 });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const abyssRef = useRef<AbyssHandle | null>(null);

  const totalClips = circles.reduce((n, c) => n + c.clips.length, 0);
  const bpm = entered ? bpmAt(pos.x) : 0;

  // Scroll → profondeur de la caméra (continue) et cercle courant.
  useEffect(() => {
    if (!entered) return;
    const sc = scrollerRef.current;
    const content = contentRef.current;
    if (!sc || !content) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const center = sc.scrollTop + sc.clientHeight / 2;
      let depth = 1;
      let x = 0;
      for (const s of content.querySelectorAll<HTMLElement>("[data-depth]")) {
        if (center < s.offsetTop) break;
        depth = Number(s.dataset.depth);
        x = depth - 1 + Math.min(1, (center - s.offsetTop) / Math.max(1, s.offsetHeight));
      }
      abyssRef.current?.setDepth(x * ABYSS_RING, Math.min(1, x / 9.5));
      setPos((p) => (p.depth === depth && Math.abs(p.x - x) < 0.02 ? p : { depth, x }));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      sc.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [entered]);

  // Le cœur du puits bat avec celui de la bande-son ; éclat à chaque anneau franchi.
  useEffect(() => {
    abyssRef.current?.setBpm(reduce ? 0 : bpm);
  }, [bpm, reduce]);
  const lastDepth = useRef(1);
  useEffect(() => {
    if (!entered || pos.depth === lastDepth.current) return;
    lastDepth.current = pos.depth;
    if (!reduce) abyssRef.current?.flash(0.45 + pos.depth * 0.05);
  }, [pos.depth, entered, reduce]);

  const enter = () => {
    setEntered(true);
    scrollerRef.current?.scrollTo({ top: 0 });
    abyssRef.current?.setDepth(0, 0);
    if (!reduce) abyssRef.current?.flash(1);
  };

  const ascend = () => {
    if (ascending) return;
    setAscending(true);
    abyssRef.current?.ascend();
    abyssRef.current?.setDepth(GATE_DEPTH, 0);
    window.setTimeout(() => router.push("/scroll"), reduce ? 150 : 1500);
  };

  if (circles.length === 0) {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-[#03060c] px-6 text-center">
        <div className="max-w-md">
          <p className="font-[family-name:var(--font-cormorant)] text-3xl text-[var(--red)]">La Chambre est scellée</p>
          <p className="mt-3 text-sm text-white/60">
            Aucune souffrance n&apos;a encore été archivée. Reviens quand les clips auront été moissonnés.
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

  const stress = entered ? Math.min(1, pos.x / 10) : 0;

  return (
    // animation:none : la règle globale `main > * > *` (fadeInUp, fill both) laissait un
    // transform sur ce conteneur, qui devenait le repère des éléments fixed (puits, voile,
    // HUD) : ils défilaient avec le contenu.
    <div
      ref={scrollerRef}
      className="fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden bg-[#03060c]"
      style={{ animation: "none" }}
    >
      <Abyss
        reduce={reduce}
        onHandle={(h) => {
          abyssRef.current = h;
          h?.setDepth(GATE_DEPTH, 0);
        }}
      />
      <Veil stress={stress} bpm={bpm} reduce={reduce} />

      <Link
        href="/"
        aria-label="Remonter à la surface (accueil)"
        className="fixed left-4 top-4 z-[95] flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-4 py-2 font-data text-[11px] uppercase tracking-[0.25em] text-white/70 backdrop-blur-sm transition-colors hover:border-[var(--gold)] hover:text-[var(--gold)]"
      >
        ↑ Surface
      </Link>
      {entered && <DepthHud x={pos.x} depth={pos.depth} bpm={bpm} reduce={reduce} />}
      <GlitchFlash depth={pos.depth} reduce={reduce || !entered} />
      <ChamberAudio depth={pos.depth} bpm={bpm} active={entered} />

      <div ref={contentRef} className="relative z-10">
        {!entered ? (
          <EntryGate totalClips={totalClips} onEnter={enter} />
        ) : (
          <>
            {circles.map((circle) => (
              <CircleSection key={circle.depth} circle={circle} reduce={reduce} />
            ))}
            <ExitCard onAscend={ascend} ascending={ascending} />
            <RiotDisclaimer />
          </>
        )}
      </div>

      {ascending && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[99] bg-[#fff4dc]"
          style={{ animation: reduce ? undefined : "chamberAscend 1.5s ease-in forwards" }}
        />
      )}
      <style>{`
        @keyframes chamberGlitch{0%{opacity:1;transform:translateX(0)}18%{opacity:.9;transform:translateX(-5px)}36%{opacity:.65;transform:translateX(6px)}54%{opacity:.85;transform:translateX(-3px)}72%{opacity:.4;transform:translateX(2px)}100%{opacity:0;transform:translateX(0)}}
        @keyframes chamberShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-1.5px,1px)}40%{transform:translate(1.5px,-1px)}60%{transform:translate(-1px,-1.5px)}80%{transform:translate(1px,1.5px)}}
        @keyframes chamberRespect{0%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-34px) scale(1.6)}}
        @keyframes chamberBeat{0%{transform:scale(1)}8%{transform:scale(1.28)}20%{transform:scale(1)}30%{transform:scale(1.14)}45%,100%{transform:scale(1)}}
        @keyframes chamberBreath{0%{opacity:0}8%{opacity:1}28%{opacity:.25}34%{opacity:.7}60%,100%{opacity:0}}
        @keyframes chamberAscend{0%{opacity:0}55%{opacity:.35}100%{opacity:1}}
      `}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Le puits (canvas plein écran derrière le contenu)
// ════════════════════════════════════════════════════════════════════

function Abyss({ reduce, onHandle }: { reduce: boolean; onHandle: (h: AbyssHandle | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ok, setOk] = useState(false);
  const onHandleRef = useRef(onHandle);
  useEffect(() => {
    onHandleRef.current = onHandle;
  }, [onHandle]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let h: AbyssHandle | null = null;
    try {
      const mobile = window.innerWidth < 768;
      h = mountAbyss(canvas, { scale: mobile ? 0.5 : 0.6, fps: mobile ? 30 : 60, still: reduce });
    } catch (err) {
      console.warn("[Chambre] puits indisponible :", err);
    }
    if (!h) return;
    const handle = h;
    onHandleRef.current(handle);
    setOk(true);
    const onVis = () => handle.setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      onHandleRef.current(null);
      handle.dispose();
    };
  }, [reduce]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full transition-opacity duration-1000"
      style={{ opacity: ok ? 1 : 0 }}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// Voile : la vignette se referme et le cœur colore les bords.
// ════════════════════════════════════════════════════════════════════

function Veil({ stress, bpm, reduce }: { stress: number; bpm: number; reduce: boolean }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[80]"
        style={{
          background: `radial-gradient(ellipse at 50% 45%, transparent ${64 - stress * 24}%, rgba(40,0,6,${stress * 0.28}) 84%, rgba(0,0,0,${0.18 + stress * 0.34}) 100%)`,
          transition: reduce ? "none" : "background 0.8s ease-out",
        }}
      />
      {!reduce && bpm > 0 && stress > 0.12 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[81]"
          style={{
            background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(232,64,87,0.16) 100%)",
            animation: `chamberBreath ${(60 / bpm).toFixed(3)}s ease-out infinite`,
            opacity: stress,
          }}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Profondeur et cœur (à droite ; puce compacte sur mobile)
// ════════════════════════════════════════════════════════════════════

function Heart({ bpm, reduce }: { bpm: number; reduce: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-3.5 w-3.5 fill-current"
      style={{ animation: reduce || bpm <= 0 ? undefined : `chamberBeat ${(60 / bpm).toFixed(3)}s ease-out infinite` }}
    >
      <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2 0 3.4 1.1 4.1 2.2h.6c.7-1.1 2.1-2.2 4.1-2.2 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function DepthHud({ x, depth, bpm, reduce }: { x: number; depth: number; bpm: number; reduce: boolean }) {
  const meters = Math.round(Math.max(0, x) * METERS_PER_CIRCLE);
  const t = Math.min(1, x / 10);
  return (
    <>
      <div
        className="pointer-events-none fixed right-4 top-1/2 z-[95] hidden -translate-y-1/2 flex-col items-center gap-3 sm:flex"
        aria-label={`Profondeur ${meters} mètres, cercle ${depth} sur 10, ${bpm} battements par minute`}
        role="status"
      >
        <span className="font-data text-[10px] tabular-nums tracking-[0.15em] text-white/60">−{meters} m</span>
        <div className="relative h-60 w-px bg-gradient-to-b from-white/25 via-white/15 to-[var(--red)]/50">
          {ROMAN.map((r, i) => (
            <span
              key={r}
              className="absolute right-3 -translate-y-1/2 font-[family-name:var(--font-cormorant)] text-[12px] font-semibold"
              style={{ top: `${(i / 9) * 100}%`, color: i + 1 <= depth ? "var(--red)" : "rgba(255,255,255,0.3)" }}
            >
              {r}
            </span>
          ))}
          <span
            className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[var(--red)]"
            style={{
              top: `${t * 100}%`,
              boxShadow: "0 0 12px rgba(232,64,87,0.8)",
              transition: reduce ? "none" : "top 0.3s ease-out",
            }}
          />
        </div>
        <span className="flex items-center gap-1.5 font-data text-[11px] font-bold tabular-nums text-[var(--red)]">
          <Heart bpm={bpm} reduce={reduce} />
          {bpm}
        </span>
      </div>
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[95] flex items-center gap-2 rounded-full border border-white/12 bg-black/55 px-3 py-1.5 font-data text-[10px] tabular-nums text-white/70 backdrop-blur-sm sm:hidden"
        aria-hidden
      >
        <span className="font-[family-name:var(--font-cormorant)] text-[12px] font-semibold text-[var(--red)]">{ROMAN[depth - 1]}</span>
        <span>−{meters} m</span>
        <span className="flex items-center gap-1 text-[var(--red)]">
          <Heart bpm={bpm} reduce={reduce} />
          {bpm}
        </span>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// La porte
// ════════════════════════════════════════════════════════════════════

function EntryGate({ totalClips, onEnter }: { totalClips: number; onEnter: () => void }) {
  return (
    <section className="relative grid min-h-[100dvh] place-items-center px-6 text-center">
      <div className="relative max-w-2xl">
        <p className="font-data text-[11px] uppercase tracking-[0.55em] text-[var(--red)]/80">Avertissement</p>
        <h1 className="mt-6 text-6xl leading-[0.88] text-[var(--gold-bright)] sm:text-8xl" style={{ ...SERIF, fontWeight: 300 }}>
          La Chambre
          <br />
          <em className="font-normal italic text-[var(--gold)]">des Souffrances</em>
        </h1>
        <p className="mx-auto mt-7 max-w-lg font-[family-name:var(--font-cormorant)] text-xl italic leading-relaxed text-white/70 sm:text-2xl">
          Dix cercles, {totalClips} morts de la Karmine Corp. Du faux pas isolé au pentakill encaissé, chaque cercle est pire
          que le précédent, et le cœur s&apos;emballe à mesure qu&apos;on descend.
        </p>
        <button
          type="button"
          onClick={onEnter}
          className="group mt-10 inline-flex items-center gap-3 rounded-full border border-[var(--red)]/60 bg-[var(--red)]/10 px-9 py-4 font-display text-lg font-bold uppercase tracking-[0.25em] text-[var(--red)] backdrop-blur-sm transition-all hover:border-[var(--red)] hover:bg-[var(--red)]/20 hover:shadow-[0_0_48px_rgba(232,64,87,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--red)]"
        >
          Descendre
          <span aria-hidden className="transition-transform group-hover:translate-y-0.5">
            ↓
          </span>
        </button>
        <p className="mt-6 font-data text-[10px] uppercase tracking-[0.3em] text-white/35">
          Son recommandé · on peut remonter à tout moment
        </p>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Un cercle
// ════════════════════════════════════════════════════════════════════

function CircleSection({ circle, reduce }: { circle: ChamberCircle; reduce: boolean }) {
  const [hero, ...rest] = circle.clips;
  const lore = loreForDepth(circle.depth);
  const g = (circle.depth - 1) / 9;
  const numeralTop = mixHex("#F0E6D2", "#FF5a4a", g);
  const numeralBottom = mixHex("#C8AA6E", "#7a0a14", g);
  return (
    <section
      data-depth={circle.depth}
      aria-label={`Cercle ${circle.depth} — ${circle.name}`}
      className="relative px-4 pb-32 pt-[24vh] sm:px-8"
    >
      {/* halo sombre : l'en-tête se pose souvent sur la lueur du fond du puits */}
      <header
        className="mx-auto max-w-4xl px-6 py-10 text-center"
        style={{ background: "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(0,0,0,0.55), transparent 72%)" }}
      >
        <p className="font-data text-[11px] uppercase tracking-[0.5em]" style={{ color: `rgba(232,64,87,${0.5 + g * 0.45})` }}>
          Cercle {circle.depth} · −{circle.depth * METERS_PER_CIRCLE} m
        </p>
        <p
          aria-hidden
          className="select-none font-[family-name:var(--font-cormorant)] font-light leading-[0.85]"
          style={{
            fontSize: "clamp(7rem, 22vw, 15rem)",
            backgroundImage: `linear-gradient(180deg, ${numeralTop}, ${numeralBottom})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            filter: `drop-shadow(0 0 ${14 + g * 34}px rgba(232,64,87,${0.18 + g * 0.5}))`,
          }}
        >
          {ROMAN[circle.depth - 1]}
        </p>
        <h2
          className="mt-1 font-display text-3xl font-black uppercase tracking-[0.18em] sm:text-5xl"
          style={{
            color: circle.depth >= 9 ? "var(--red)" : "var(--gold-bright)",
            animation: circle.depth >= 9 && !reduce ? "chamberShake 0.5s ease-in-out infinite" : undefined,
          }}
        >
          {circle.name}
        </h2>
        <p className="mt-3 font-[family-name:var(--font-cormorant)] text-xl italic text-white/60 sm:text-2xl">{circle.tagline}</p>
        <p className="mt-5 inline-block rounded-full border border-white/12 bg-black/45 px-3.5 py-1 font-data text-[10px] uppercase tracking-[0.3em] text-white/60 backdrop-blur-sm">
          {circle.kind} · {circle.clips.length}
        </p>
      </header>

      {/* Moments Maudits (lib/chamber-lore.ts) : le récit d'abord, le sang ensuite. */}
      {lore.length > 0 && (
        <div className={`mx-auto mt-14 grid gap-5 ${lore.length > 1 ? "max-w-5xl lg:grid-cols-2" : "max-w-2xl"}`}>
          {lore.map((m) => (
            <LoreMomentCard key={m.youtubeId} moment={m} depth={circle.depth} reduce={reduce} />
          ))}
        </div>
      )}

      {hero && <HeroDeath clip={hero} depth={circle.depth} reduce={reduce} />}
      <DeathRail clips={rest} depth={circle.depth} reduce={reduce} />
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Déchirure RVB au passage d'un cercle (sans flash blanc : le puits éclaire)
// ════════════════════════════════════════════════════════════════════

function GlitchFlash({ depth, reduce }: { depth: number; reduce: boolean }) {
  const [burst, setBurst] = useState(0);
  const prev = useRef(depth);
  useEffect(() => {
    if (depth !== prev.current) {
      prev.current = depth;
      setBurst((b) => b + 1);
    }
  }, [depth]);
  if (reduce || burst === 0) return null;
  const intensity = Math.min(1, depth / 10);
  return (
    <div key={burst} aria-hidden className="pointer-events-none fixed inset-0 z-[92]">
      <div
        className="absolute inset-x-0"
        style={{
          top: `${18 + ((depth * 7) % 52)}%`,
          height: `${6 + intensity * 12}px`,
          background: "var(--red)",
          boxShadow: "0 0 22px var(--red)",
          animation: "chamberGlitch 0.4s steps(2,end) forwards",
        }}
      />
      <div
        className="absolute inset-x-0"
        style={{
          top: `${44 + ((depth * 11) % 40)}%`,
          height: `${3 + intensity * 7}px`,
          background: "var(--cyan)",
          animation: "chamberGlitch 0.32s steps(2,end) forwards",
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Le fond : on remonte vers la lumière
// ════════════════════════════════════════════════════════════════════

function ExitCard({ onAscend, ascending }: { onAscend: () => void; ascending: boolean }) {
  const respects = useSessionRespects();
  return (
    <section data-exit className="relative grid min-h-[92dvh] place-items-center px-6 text-center">
      <div
        className="max-w-xl px-8 py-12"
        style={{ background: "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(0,0,0,0.6), transparent 72%)" }}
      >
        <p className="font-data text-[11px] uppercase tracking-[0.45em] text-[var(--red)]">Le fond de la Chambre</p>
        <h2 className="mt-5 text-5xl leading-tight text-[var(--gold-bright)] sm:text-7xl" style={{ ...SERIF, fontWeight: 300 }}>
          Tu as tout vu.
        </h2>
        {respects > 0 && (
          <p className="mt-4 font-data text-[11px] uppercase tracking-[0.2em] text-white/50">
            Tu as rendu <span className="font-black text-[var(--red)]">{respects}</span> hommage{respects > 1 ? "s" : ""}. Les morts
            s&apos;en souviendront.
          </p>
        )}
        <p className="mx-auto mt-5 max-w-md font-[family-name:var(--font-cormorant)] text-xl italic leading-relaxed text-white/70 sm:text-2xl">
          La Karmine Corp s&apos;est relevée de chacune de ces morts. À ton tour.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onAscend}
            disabled={ascending}
            style={{ background: "var(--gold-gradient)" }}
            className="rounded-full px-8 py-3.5 font-display text-sm font-bold uppercase tracking-[0.2em] text-[#1a1206] shadow-[0_0_40px_rgba(200,170,110,0.35)] transition-transform hover:scale-105 disabled:opacity-80"
          >
            Remonter à la lumière ↑
          </button>
          <Link
            href="/"
            className="rounded-full border border-white/20 px-6 py-3.5 text-sm text-white/80 hover:border-[var(--gold)] hover:text-[var(--gold)]"
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
      KCKILLS was created under Riot Games&apos; &ldquo;Legal Jibber Jabber&rdquo; policy using assets owned by Riot Games. Riot
      Games does not endorse or sponsor this project.
    </p>
  );
}
