/**
 * L'affiche d'un joueur (direction A de la refonte, 29/09/2026).
 *
 * Un poster de match : le nom en or sur toute la largeur, deux échos en
 * contour derrière, la photo détourée devant, le splash de son champion le
 * plus joué en fond (désaturé, teinté du bleu KC). En bas, quatre chiffres
 * tirés de la base et son kill signature en un tap. Tout en CSS côté
 * serveur : l'image du splash est le LCP, aucune dépendance JS.
 *
 * Les photos wikia des anciens ne sont pas détourées (et refusées par
 * l'optimiseur) : sans photo lolesports, l'affiche repose sur le splash.
 */

import Image from "next/image";
import Link from "next/link";
import { championSplashUrl } from "@/lib/constants";
import type { PlayerDna } from "@/lib/supabase/player-dna";

const MULTI: [keyof PlayerDna["counts"], string, string][] = [
  ["penta", "penta", "pentas"],
  ["quadra", "quadra", "quadras"],
  ["triple", "triple", "triples"],
  ["double", "double", "doubles"],
];

function plural(n: number, one: string, many: string) {
  return n > 1 ? many : one;
}

export function PlayerPoster({
  name,
  roleLabel,
  photo,
  dna,
  fallbackChampion,
}: {
  name: string;
  roleLabel: string | null;
  photo: string | null;
  dna: PlayerDna | null;
  fallbackChampion: string;
}) {
  const champion = dna?.topChampion?.name ?? fallbackChampion;
  const cutout = photo && photo.includes("static.lolesports.com") ? photo : null;
  const years = dna?.first && dna.last ? [dna.first.slice(0, 4), dna.last.slice(0, 4)] : null;
  const len = Math.max(4, name.length);
  const nameSize = `min(calc((100vw - 28px) / ${(len * 0.56).toFixed(2)}), 15rem)`;

  // Les deux paliers de multi-kill les plus hauts présents, du moins rare au plus rare.
  const tiers = MULTI.filter(([k]) => (dna?.counts[k] ?? 0) > 0).slice(0, 2).reverse();
  const stats: { value: number; label: string }[] = [];
  if (dna) {
    stats.push({ value: dna.total, label: plural(dna.total, "kill", "kills") });
    for (const [k, one, many] of tiers) stats.push({ value: dna.counts[k], label: plural(dna.counts[k], one, many) });
    if (dna.topChampion) stats.push({ value: dna.topChampion.kills, label: `sur ${dna.topChampion.name}` });
  }

  const sig = dna?.signature;
  const sigMeta = sig
    ? [
        sig.multiKill ?? (sig.firstBlood ? "premier sang" : null),
        sig.opponent ? `vs ${sig.opponent}` : null,
        sig.playedAt
          ? new Date(sig.playedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <section
      aria-label={`${name}, l'affiche`}
      className="poster relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#010A13] md:min-h-[94vh]"
    >
      {/* fond : le splash du champion fétiche, désaturé et teinté */}
      <div aria-hidden className="poster-splash absolute inset-0 -z-10">
        <Image
          src={championSplashUrl(champion)}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ objectPosition: "58% center", filter: "grayscale(1) contrast(1.15) brightness(.55)" }}
        />
      </div>
      <div
        aria-hidden
        className="absolute inset-0 -z-10 mix-blend-multiply"
        style={{ background: "linear-gradient(180deg, rgba(0,87,255,.8) 0%, rgba(10,20,40,.8) 45%, #010a13 88%)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ background: "radial-gradient(60% 40% at 50% 38%, rgba(200,170,110,.25), transparent 70%)" }}
      />
      <div aria-hidden className="poster-grain pointer-events-none absolute inset-0 z-[5]" />

      <div className="relative z-10 pt-24 text-center md:pt-28">
        <p className="font-data text-[11px] uppercase tracking-[0.42em] text-[var(--gold)]">
          {[roleLabel, "Karmine Corp"].filter(Boolean).join(" · ")}
        </p>
        {years && (
          <p className="mt-1.5 font-data text-[11px] uppercase tracking-[0.42em] text-[var(--gold)]/80">
            {years[0] === years[1] ? years[0] : `${years[0]} → ${years[1]}`}
          </p>
        )}
      </div>

      {/* le nom, et ses deux échos en contour dessous */}
      <div className="relative z-10 mt-3 text-center" style={{ fontSize: nameSize }}>
        {[1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="poster-echo absolute inset-x-0 select-none font-display font-bold uppercase leading-[0.86] text-transparent"
            style={{
              top: `${i * 0.95}em`,
              WebkitTextStroke: "1.5px rgba(200,170,110,.45)",
              opacity: i === 1 ? 0.8 : 0.35,
              letterSpacing: "-0.02em",
            }}
          >
            {name}
          </span>
        ))}
        <h1
          className="poster-name relative font-display font-bold uppercase leading-[0.86]"
          style={{
            fontSize: "1em",
            letterSpacing: "-0.02em",
            backgroundImage: "linear-gradient(180deg, #F0E6D2, #C8AA6E 55%, #785A28)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            filter: "drop-shadow(0 6px 24px rgba(0,0,0,.55))",
          }}
        >
          {name}
        </h1>
      </div>

      {/* la photo détourée, devant le nom */}
      {cutout && (
        <div className="poster-photo pointer-events-none relative z-20 mx-auto -mt-[14vh] w-[min(560px,118vw)] flex-1 md:-mt-[14vh] md:w-[min(500px,38vw)]">
          <Image
            src={cutout}
            alt={`${name}, joueur de la Karmine Corp`}
            width={800}
            height={800}
            priority
            sizes="(max-width: 768px) 118vw, 500px"
            className="absolute bottom-0 left-0 h-auto w-full"
            style={{ filter: "drop-shadow(0 20px 40px #000) drop-shadow(0 0 30px rgba(0,87,255,.4))" }}
          />
        </div>
      )}
      {!cutout && <div className="flex-1" />}

      {/* les chiffres et le kill signature */}
      <div className="relative z-30 mx-auto w-full max-w-5xl px-5 pb-7 md:pb-10">
        <div aria-hidden className="absolute inset-x-0 -top-24 bottom-0 -z-10 bg-gradient-to-t from-[#010A13] via-[#010A13]/85 to-transparent" />
        {stats.length > 0 && (
          <dl className="grid grid-cols-4 border-y border-[var(--gold)]/40 py-3">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 px-1 first:pl-0">
                <dt className="sr-only">{s.label}</dt>
                <dd className="font-display text-[clamp(1.6rem,7vw,3.2rem)] font-bold leading-none text-[#F0E6D2]">
                  {s.value.toLocaleString("fr-FR")}
                </dd>
                <dd aria-hidden className="mt-1.5 truncate font-data text-[9px] uppercase tracking-[0.22em] text-[#A09B8C] md:text-[10px]">
                  {s.label}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {sig && (
          <Link href={`/kill/${sig.id}`} className="group mt-4 flex items-center gap-4" aria-label={`Le kill signature de ${name} : ${sigMeta}`}>
            <span className="relative h-[100px] w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--gold)]/55 bg-black">
              {sig.thumbnail && <Image src={sig.thumbnail} alt="" fill sizes="64px" className="object-cover transition-transform duration-500 group-hover:scale-110" />}
            </span>
            <span className="min-w-0">
              <span className="block font-display text-[22px] font-bold uppercase leading-tight text-white group-hover:text-[var(--gold)]">
                Le kill signature ▶
              </span>
              <span className="mt-1.5 block truncate font-data text-[11px] uppercase tracking-[0.18em] text-[var(--gold)]">
                {[sig.champion && sig.victim ? `${sig.champion} → ${sig.victim}` : null, sigMeta].filter(Boolean).join(" · ")}
              </span>
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}
