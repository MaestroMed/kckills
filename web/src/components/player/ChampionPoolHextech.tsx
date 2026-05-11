import Image from "next/image";
import { championIconUrl, championLoadingUrl } from "@/lib/constants";

export interface ChampionPoolEntry {
  name: string;
  games: number;
  kills: number;
  deaths: number;
  assists: number;
}

/**
 * ChampionPoolHextech — Hextech-cut hexagonal/rhombus cards for each
 * champion in a player's pool. Top 8 are featured big, rest collapsed
 * under a details disclosure (consistent with the previous behaviour).
 *
 * Each card uses a CSS clip-path to evoke a Hextech corner-cut,
 * shows the champion icon, name, games, KDA, WR, and a splash hover.
 */
export function ChampionPoolHextech({
  champions,
  accent = "var(--gold)",
}: {
  champions: ChampionPoolEntry[];
  accent?: string;
}) {
  if (champions.length === 0) return null;

  const top = champions.slice(0, 8);
  const rest = champions.slice(8);

  return (
    <div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
        {top.map((c) => {
          const kda = c.deaths > 0 ? ((c.kills + c.assists) / c.deaths).toFixed(1) : "Perfect";
          const total = c.kills + c.deaths + c.assists;
          // Approximate WR proxy : a kill-heavy game is more likely a win.
          // Real winrate requires per-game data ; this is a quick visual cue.
          const wrHint = total > 0 ? Math.round(((c.kills + c.assists) / total) * 100) : 0;
          return (
            <a
              key={c.name}
              href={`/scroll?killerChampion=${encodeURIComponent(c.name)}`}
              aria-label={`Voir les kills sur ${c.name} dans le scroll`}
              className="hex-card group relative aspect-[4/5] overflow-hidden bg-[var(--bg-surface)] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
              style={{
                clipPath:
                  "polygon(12% 0, 100% 0, 100% 88%, 88% 100%, 0 100%, 0 12%)",
                border: `1px solid ${accent}30`,
              }}
            >
              {/* Splash background — appears on hover only to keep idle calm */}
              <Image
                src={championLoadingUrl(c.name)}
                alt=""
                fill
                sizes="(max-width: 768px) 50vw, 25vw"
                className="object-cover opacity-0 group-hover:opacity-60 transition-opacity duration-500"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40" />

              {/* Idle hero : centred icon */}
              <div className="absolute inset-0 flex flex-col items-center justify-center p-3 z-10">
                <div
                  className="relative h-14 w-14 md:h-16 md:w-16 rounded-full overflow-hidden border-2"
                  style={{ borderColor: `${accent}80` }}
                >
                  <Image
                    src={championIconUrl(c.name)}
                    alt={c.name}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
                <p className="mt-3 font-display text-sm md:text-base font-black text-white text-center leading-tight">
                  {c.name}
                </p>
                <p className="font-data text-[10px] uppercase tracking-widest text-white/50 mt-0.5">
                  {c.games} {c.games > 1 ? "games" : "game"}
                </p>
              </div>

              {/* Bottom : KDA + WR pill */}
              <div className="absolute bottom-0 left-0 right-0 z-10 px-3 py-2 flex items-center justify-between text-[10px] font-data uppercase">
                <span className="text-white/60">
                  <span className="text-[var(--green)]">{c.kills}</span>
                  <span className="text-white/30 mx-0.5">/</span>
                  <span className="text-[var(--red)]">{c.deaths}</span>
                  <span className="text-white/30 mx-0.5">/</span>
                  <span className="text-white">{c.assists}</span>
                </span>
                <span
                  className="font-black px-2 py-0.5 rounded"
                  style={{
                    color: accent,
                    background: `${accent}1A`,
                    border: `1px solid ${accent}40`,
                  }}
                  aria-label={`KDA ${kda}`}
                  data-wr-hint={wrHint}
                >
                  {kda}
                </span>
              </div>

              {/* Top-left rhombus ornament */}
              <span
                className="absolute top-2 left-3 text-xs leading-none z-10 select-none"
                style={{ color: accent }}
                aria-hidden
              >
                ◆
              </span>
            </a>
          );
        })}
      </div>

      {rest.length > 0 && (
        <details className="mt-6 group">
          <summary
            className="cursor-pointer list-none flex items-center justify-center gap-3 text-center text-xs font-display uppercase tracking-[0.22em] text-[var(--text-muted)] hover:text-[var(--gold)] py-3 transition-colors"
          >
            <span className="h-px w-12 bg-[var(--gold)]/30 group-hover:bg-[var(--gold)] transition-colors" />
            Voir les {rest.length} autres champions
            <span className="h-px w-12 bg-[var(--gold)]/30 group-hover:bg-[var(--gold)] transition-colors" />
          </summary>
          <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {rest.map((c) => {
              const kda =
                c.deaths > 0 ? ((c.kills + c.assists) / c.deaths).toFixed(1) : "Perfect";
              return (
                <div
                  key={c.name}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3"
                >
                  <Image
                    src={championIconUrl(c.name)}
                    alt={c.name}
                    width={36}
                    height={36}
                    className="rounded-full border border-[var(--border-gold)]"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{c.games} games</p>
                  </div>
                  <span className="font-data text-sm font-bold text-[var(--gold)]">{kda}</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
