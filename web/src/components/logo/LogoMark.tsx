import { useId } from "react";
import type { LogoConcept, Tone } from "./logo-marks";

/**
 * Rendu SVG d'une piste de logo. `mono` : une seule couleur (currentColor),
 * pour les favicons monochromes, les tampons et les fonds clairs.
 */
export function LogoMark({
  concept,
  size = 64,
  mono = false,
  className,
  title,
}: {
  concept: LogoConcept;
  size?: number;
  mono?: boolean;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const fill = (tone: Tone) => (mono ? "currentColor" : `url(#${uid}-${tone})`);
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
          <linearGradient id={`${uid}-goldLight`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#F6E3AE" />
            <stop offset="0.55" stopColor="#D6B574" />
            <stop offset="1" stopColor="#B38D48" />
          </linearGradient>
          <linearGradient id={`${uid}-goldDark`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#B8914B" />
            <stop offset="1" stopColor="#6B4C1C" />
          </linearGradient>
          <linearGradient id={`${uid}-gem`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5AD8FF" />
            <stop offset="0.5" stopColor="#0057FF" />
            <stop offset="1" stopColor="#0A2A8C" />
          </linearGradient>
          <linearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0B2A7A" />
            <stop offset="1" stopColor="#050F33" />
          </linearGradient>
        </defs>
      )}
      {concept.parts.map((p, i) => (
        <path key={i} d={p.d} fill={mono && p.tone === "plate" ? "none" : fill(p.tone)} />
      ))}
    </svg>
  );
}
