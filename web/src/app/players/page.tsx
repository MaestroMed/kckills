import Link from "next/link";
import Image from "next/image";
import { loadRealData, getKCRoster, displayRole, roleIcon } from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";

export const revalidate = 300;
export const metadata = { title: "Joueurs KC \u2014 KCKILLS" };

export default function PlayersPage() {
  const data = loadRealData();

  const data2026 = { ...data, matches: data.matches.filter((m) => m.date >= "2026-01-01") };
  const data2025 = { ...data, matches: data.matches.filter((m) => m.date >= "2025-01-01" && m.date < "2026-01-01") };
  const roster2026 = getKCRoster(data2026);
  const roster2025 = getKCRoster(data2025);
  const current2026Names = new Set(roster2026.map((p) => p.name));
  const alumni = roster2025.filter((p) => !current2026Names.has(p.name));

  return (
    <div className="space-y-10">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">\u25C6</span>
        <span>Joueurs</span>
      </nav>

      <h1 className="font-display text-3xl font-bold">
        Joueurs <span className="text-gold-gradient">Karmine Corp</span>
      </h1>

      {/* Current Roster — big cards with photos */}
      {roster2026.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Roster <span className="text-gold-gradient">2026</span></h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roster2026.map((player) => {
              const photo = PLAYER_PHOTOS[player.name];
              const kda = player.totalDeaths > 0 ? ((player.totalKills + player.totalAssists) / player.totalDeaths).toFixed(1) : "Perfect";
              return (
                <Link
                  key={player.name}
                  href={`/player/${encodeURIComponent(player.name)}`}
                  className="group relative overflow-hidden rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all duration-500 hover:border-[var(--gold)]/50 hover:shadow-2xl hover:shadow-[var(--gold)]/10 hover:scale-[1.02]"
                >
                  {/* Photo background */}
                  <div className="relative h-48 overflow-hidden">
                    {photo ? (
                      <Image src={photo} alt={player.name} fill className="object-cover object-top transition-transform duration-500 group-hover:scale-110" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[var(--bg-elevated)] text-5xl font-black text-[var(--gold)]/20">
                        {player.name[0]}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-surface)] via-transparent to-transparent" />
                    {/* Role badge */}
                    <div className="absolute top-3 right-3 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--gold)]">
                      {roleIcon(player.role)} {displayRole(player.role)}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-5 -mt-8 relative z-10">
                    <h3 className="font-display text-xl font-bold group-hover:text-[var(--gold)] transition-colors">{player.name}</h3>

                    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="font-data text-lg font-bold text-[var(--green)]">{player.totalKills}</p>
                        <p className="text-[9px] text-[var(--text-muted)]">KILLS</p>
                      </div>
                      <div>
                        <p className="font-data text-lg font-bold text-[var(--red)]">{player.totalDeaths}</p>
                        <p className="text-[9px] text-[var(--text-muted)]">DEATHS</p>
                      </div>
                      <div>
                        <p className="font-data text-lg font-bold">{player.totalAssists}</p>
                        <p className="text-[9px] text-[var(--text-muted)]">ASSISTS</p>
                      </div>
                      <div>
                        <p className="font-data text-lg font-bold text-[var(--gold)]">{kda}</p>
                        <p className="text-[9px] text-[var(--text-muted)]">KDA</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex gap-1">
                        {player.champions.slice(0, 5).map((c) => (
                          <Image key={c} src={championIconUrl(c)} alt={c} width={24} height={24}
                            className="rounded-full border border-[var(--border-gold)]" data-tooltip={c} />
                        ))}
                      </div>
                      <span className="font-data text-[10px] text-[var(--text-muted)] ml-auto">{player.gamesPlayed} games</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Alumni — greyscale */}
      {alumni.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-muted)]">Anciens joueurs</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {alumni.map((player) => {
              const kda = player.totalDeaths > 0 ? ((player.totalKills + player.totalAssists) / player.totalDeaths).toFixed(1) : "Perfect";
              return (
                <Link
                  key={player.name}
                  href={`/player/${encodeURIComponent(player.name)}`}
                  className="flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 grayscale opacity-70 transition-all hover:grayscale-0 hover:opacity-100"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-elevated)] font-bold text-[var(--text-muted)]">
                    {player.name[0]}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{player.name}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{displayRole(player.role)} &middot; {player.gamesPlayed}G</p>
                  </div>
                  <p className="font-data text-sm">
                    <span className="text-[var(--green)]">{player.totalKills}</span>/
                    <span className="text-[var(--red)]">{player.totalDeaths}</span>/
                    <span>{player.totalAssists}</span>
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
