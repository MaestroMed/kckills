"use client";

/**
 * L'ADN d'un joueur (direction C de la refonte, 29/09/2026).
 *
 * Sa carrière en autant de points que de kills. L'angle donne la minute de
 * jeu (horloge de 45 minutes, 0' en haut) ; la distance au centre donne la
 * date (le centre, ses débuts ; le bord, aujourd'hui). Or : multi-kills ;
 * cyan : premiers sangs ; rouge : pentakill. Chaque joueur a donc une
 * empreinte unique. On survole pour lire un point, on le touche pour revoir
 * le clip (la cible la plus proche est choisie, les points sont petits).
 *
 * SVG (quelques centaines de cercles), apparition en cernes de croissance à
 * l'entrée dans l'écran ; reduced-motion : tout est là d'emblée.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import type { DnaKill } from "@/lib/supabase/player-dna";

const SIZE = 1000;
const C = SIZE / 2;
const R0 = 175;
const R1 = 470;
const CLOCK_MIN = 45;

interface Dot {
  k: DnaKill;
  x: number;
  y: number;
  r: number;
  fill: string;
  delay: number;
}

/** Arrondi au centième : Math.cos/sin diffèrent au dernier chiffre entre Node et le navigateur (hydratation). */
const r2 = (v: number) => Math.round(v * 100) / 100;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function style(k: DnaKill): { r: number; fill: string } {
  if (k.mk === "penta") return { r: 9, fill: "#E84057" };
  if (k.mk === "quadra") return { r: 6, fill: "#F0E6D2" };
  if (k.mk === "triple") return { r: 5, fill: "#C8AA6E" };
  if (k.mk === "double") return { r: 4, fill: "rgba(200,170,110,0.85)" };
  if (k.fb) return { r: 4.5, fill: "#0AC8B9" };
  return { r: 3.2, fill: "rgba(190,184,170,0.5)" };
}

export function PlayerDNA({
  name,
  kills,
  first,
  last,
}: {
  name: string;
  kills: DnaKill[];
  first: string | null;
  last: string | null;
}) {
  const reduce = useReducedMotion() ?? false;
  const svgRef = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState(false);
  const [hover, setHover] = useState<Dot | null>(null);
  const [open, setOpen] = useState<DnaKill | null>(null);

  const t0 = first ? Date.parse(first) : NaN;
  const t1 = last ? Date.parse(last) : NaN;
  const span = Math.max(1, t1 - t0);

  const dots = useMemo<Dot[]>(() => {
    if (!Number.isFinite(t0)) return [];
    const out: Dot[] = [];
    for (const k of kills) {
      if (k.d === null || k.t === null) continue;
      const frac = (k.d - t0) / span;
      const minute = Math.min(CLOCK_MIN - 0.01, Math.max(0, k.t / 60));
      const theta = -Math.PI / 2 + (minute / CLOCK_MIN) * Math.PI * 2;
      const rad = R0 + frac * (R1 - R0) + (hash(k.id) - 0.5) * 16;
      const s = style(k);
      out.push({ k, x: r2(C + Math.cos(theta) * rad), y: r2(C + Math.sin(theta) * rad), r: s.r, fill: s.fill, delay: frac * 1.8 });
    }
    // les points marquants par-dessus
    return out.sort((a, b) => a.r - b.r);
  }, [kills, t0, span]);

  // cernes : un anneau par 1er janvier traversé
  const years = useMemo(() => {
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return [];
    const out: { y: number; r: number }[] = [];
    for (let y = new Date(t0).getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) {
      const at = Date.UTC(y, 0, 1);
      out.push({ y, r: r2(R0 + ((at - t0) / span) * (R1 - R0)) });
    }
    return out;
  }, [t0, t1, span]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || reduce) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setLive(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  // point le plus proche du pointeur (les points sont trop petits pour être visés)
  const nearest = useCallback(
    (e: React.PointerEvent | React.MouseEvent, radius: number): Dot | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const box = svg.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * SIZE;
      const y = ((e.clientY - box.top) / box.height) * SIZE;
      let best: Dot | null = null;
      let bestD = radius * radius;
      for (const d of dots) {
        const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = d;
        }
      }
      return best;
    },
    [dots],
  );

  const minuteLabel = (m: number) => {
    const theta = -Math.PI / 2 + (m / CLOCK_MIN) * Math.PI * 2;
    return { x: r2(C + Math.cos(theta) * (R1 + 22)), y: r2(C + Math.sin(theta) * (R1 + 22)) };
  };

  const count = kills.length;
  const yearsLabel = first && last ? `${first.slice(0, 4)} → ${last.slice(0, 4)}` : "";

  return (
    <section aria-labelledby="dna-title" className="relative mx-auto max-w-5xl px-4 py-16 md:py-24">
      <header className="text-center">
        <p className="font-data text-[11px] uppercase tracking-[0.42em] text-[var(--gold)]">L&apos;ADN</p>
        <h2 id="dna-title" className="mt-2 font-display text-3xl font-bold text-[var(--gold-bright)] md:text-4xl">
          Sa carrière en {count.toLocaleString("fr-FR")} points
        </h2>
      </header>

      <div className="relative mx-auto mt-8 aspect-square w-full max-w-[720px]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Les ${count} kills de ${name} de ${yearsLabel}, placés par minute de jeu et par date.`}
          className={`h-full w-full cursor-crosshair touch-manipulation ${reduce ? "" : live ? "dna-live" : "dna-wait"}`}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse") setHover(nearest(e, 22));
          }}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const d = nearest(e, 40);
            if (d) setOpen(d.k);
          }}
        >
          <defs>
            <radialGradient id="dna-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,87,255,0.22)" />
              <stop offset="60%" stopColor="rgba(10,20,40,0.35)" />
              <stop offset="100%" stopColor="rgba(1,10,19,0)" />
            </radialGradient>
            <filter id="dna-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          <circle cx={C} cy={C} r={R1 + 10} fill="url(#dna-bg)" />
          {/* repères : l'horloge (0', 15', 30') et les cernes des années */}
          {[0, 15, 30].map((m) => {
            const p = minuteLabel(m);
            const inner = minuteLabel(m);
            return (
              <g key={m}>
                <line
                  x1={C}
                  y1={C}
                  x2={inner.x}
                  y2={inner.y}
                  stroke="rgba(200,170,110,0.12)"
                  strokeWidth={1.5}
                  strokeDasharray="2 6"
                />
                <text x={p.x} y={p.y} fill="rgba(200,170,110,0.6)" fontSize={22} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-jetbrains-mono), monospace">
                  {m}&apos;
                </text>
              </g>
            );
          })}
          {years.map((y) => (
            <g key={y.y}>
              <circle cx={C} cy={C} r={y.r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} />
              <text x={C + 6} y={C - y.r - 6} fill="rgba(255,255,255,0.28)" fontSize={16} fontFamily="var(--font-jetbrains-mono), monospace">
                {y.y}
              </text>
            </g>
          ))}
          {/* les kills */}
          <g>
            {dots.map((d) => (
              <circle
                key={d.k.id}
                className="dna-dot"
                cx={d.x}
                cy={d.y}
                r={d.r}
                fill={d.fill}
                style={reduce ? undefined : { animationDelay: `${d.delay.toFixed(2)}s` }}
              />
            ))}
          </g>
          {/* halo des pentas */}
          {dots
            .filter((d) => d.k.mk === "penta")
            .map((d) => (
              <circle key={`g-${d.k.id}`} cx={d.x} cy={d.y} r={20} fill="#E84057" opacity={0.45} filter="url(#dna-glow)" />
            ))}
          {hover && <circle cx={hover.x} cy={hover.y} r={hover.r + 8} fill="none" stroke="#F0E6D2" strokeWidth={2} />}
          {/* le centre */}
          <text x={C} y={C - 8} textAnchor="middle" fill="#C8AA6E" fontSize={62} letterSpacing={14} fontFamily="var(--font-oswald), sans-serif" fontWeight={300}>
            {name.toUpperCase()}
          </text>
          <text x={C} y={C + 36} textAnchor="middle" fill="rgba(240,230,210,0.7)" fontSize={20} letterSpacing={6} fontFamily="var(--font-jetbrains-mono), monospace">
            {count.toLocaleString("fr-FR")} KILLS
          </text>
          <text x={C} y={C + 64} textAnchor="middle" fill="rgba(240,230,210,0.5)" fontSize={18} letterSpacing={6} fontFamily="var(--font-jetbrains-mono), monospace">
            {yearsLabel}
          </text>
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--gold)]/40 bg-black/85 px-3 py-2 text-center backdrop-blur"
            style={{ left: `${(hover.x / SIZE) * 100}%`, top: `calc(${(hover.y / SIZE) * 100}% - 14px)` }}
          >
            <p className="whitespace-nowrap font-display text-sm font-bold uppercase text-white">
              {hover.k.champ ?? "?"}
              {hover.k.mk ? <span className="ml-1.5 text-[var(--gold)]">{hover.k.mk}</span> : null}
              {hover.k.fb ? <span className="ml-1.5 text-[var(--cyan)]">premier sang</span> : null}
            </p>
            <p className="font-data text-[10px] text-white/60">
              {hover.k.t !== null ? `${Math.floor(hover.k.t / 60)}'${String(Math.floor(hover.k.t % 60)).padStart(2, "0")}` : ""}
              {hover.k.d !== null
                ? ` · ${new Date(hover.k.d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" })}`
                : ""}
            </p>
          </div>
        )}
      </div>

      <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-data text-[10px] uppercase tracking-[0.25em] text-white/60">
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--gold)]" aria-hidden /> Multi-kill
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--cyan)]" aria-hidden /> Premier sang
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--red)]" aria-hidden /> Pentakill
        </li>
      </ul>
      <p className="mx-auto mt-4 max-w-md text-center text-sm text-white/65">
        <strong className="text-[var(--gold)]">Chaque point est un kill.</strong> L&apos;angle, la minute de jeu ; la distance, le
        temps qui passe. Touche un point pour revoir le clip.
      </p>

      {open && <DnaClip kill={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Le clip d'un point
// ════════════════════════════════════════════════════════════════════

interface ClipData {
  clip_url_vertical: string | null;
  clip_url_vertical_low: string | null;
  thumbnail_url: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  ai_description: string | null;
  ai_description_fr: string | null;
}

function DnaClip({ kill, onClose }: { kill: DnaKill; onClose: () => void }) {
  const [data, setData] = useState<ClipData | null | "missing">(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void createClient()
      .from("kills")
      .select("clip_url_vertical, clip_url_vertical_low, thumbnail_url, killer_champion, victim_champion, ai_description, ai_description_fr")
      .eq("id", kill.id)
      .maybeSingle()
      .then(({ data: row }) => {
        if (alive) setData((row as ClipData | null) ?? "missing");
      });
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [kill.id, onClose]);

  const src = data && data !== "missing" ? (data.clip_url_vertical_low ?? data.clip_url_vertical) : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Clip : ${kill.champ ?? "kill"}`}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[380px] overflow-hidden rounded-2xl border border-[var(--gold)]/40 bg-black"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white/80 hover:text-white"
        >
          ✕
        </button>
        <div className="relative aspect-[9/16] w-full bg-black">
          {src ? (
            <video
              src={src}
              poster={data && data !== "missing" ? (data.thumbnail_url ?? undefined) : undefined}
              autoPlay
              muted
              loop
              playsInline
              controls
              className="h-full w-full object-cover"
            />
          ) : (
            <p className="grid h-full place-items-center px-6 text-center font-data text-xs uppercase tracking-[0.2em] text-white/50">
              {data === "missing" ? "Clip indisponible" : "Chargement…"}
            </p>
          )}
        </div>
        {data && data !== "missing" && (
          <div className="space-y-1.5 p-4">
            <p className="font-display text-lg font-bold uppercase text-white">
              {data.killer_champion ?? "?"} <span className="text-white/40">→</span> {data.victim_champion ?? "?"}
            </p>
            {(data.ai_description_fr ?? data.ai_description) && (
              <p className="text-sm text-white/70">{data.ai_description_fr ?? data.ai_description}</p>
            )}
            <Link href={`/kill/${kill.id}`} className="inline-block pt-1 font-data text-[11px] uppercase tracking-[0.2em] text-[var(--gold)] hover:underline">
              Voir la page du kill →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
