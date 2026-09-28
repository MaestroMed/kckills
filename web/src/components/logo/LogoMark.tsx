import { useId, useMemo } from "react";
import { crestParts, type CrestSpec, type Tone } from "./logo-marks";

const STOPS: Record<Tone, [string, string]> = {
  // or : quatre facettes, de la plus éclairée à la plus sombre
  g1: ["#FFF1C9", "#E9C987"],
  g2: ["#E3BF78", "#C49D55"],
  g3: ["#B98D46", "#8F682B"],
  g4: ["#7A5621", "#4A3110"],
  // cristal Hextech
  j1: ["#D8F8FF", "#7CC8FF"],
  j2: ["#55A6FF", "#1F5CFF"],
  j3: ["#1A4FE0", "#0A2FA8"],
  j4: ["#0A2A8C", "#041A5C"],
};

/**
 * Logo « L'Écrin » en SVG. `mono` : une seule couleur (currentColor) pour les
 * déclinaisons monochromes ; sinon facettes or + cristal et son halo.
 */
export function LogoMark({
  spec,
  size = 64,
  mono = false,
  glow = true,
  className,
  title,
}: {
  spec: CrestSpec;
  size?: number;
  mono?: boolean;
  /** Halo bleu autour du cristal (version couleur). */
  glow?: boolean;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const parts = useMemo(() => crestParts(spec), [spec]);
  const g = spec.gem;
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {!mono && (
        <defs>
          {(Object.keys(STOPS) as Tone[]).map((t) => (
            <linearGradient key={t} id={`${uid}-${t}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={STOPS[t][0]} />
              <stop offset="1" stopColor={STOPS[t][1]} />
            </linearGradient>
          ))}
          <radialGradient id={`${uid}-halo`}>
            <stop offset="0" stopColor="#7FE0FF" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#1F6BFF" stopOpacity="0.22" />
            <stop offset="1" stopColor="#0057FF" stopOpacity="0" />
          </radialGradient>
        </defs>
      )}
      {!mono && glow && <ellipse cx={g.c[0]} cy={g.c[1]} rx={g.rx * 2.4} ry={g.ry * 2} fill={`url(#${uid}-halo)`} />}
      {parts.map((p, i) => (
        <path key={i} d={p.d} fill={mono ? "currentColor" : `url(#${uid}-${p.tone})`} />
      ))}
    </svg>
  );
}
