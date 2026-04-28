import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { loadRealData, getKCRoster, displayRole, roleIcon } from "@/lib/real-data";
import { championIconUrl, championLoadingUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { ALUMNI } from "@/lib/alumni";
import { Breadcrumb } from "@/components/Breadcrumb";

export const revalidate = 1800; // Wave 13d : DB pressure (roster stable)
export const metadata: Metadata = {
  title: "Joueurs KC — KCKILLS",
  description:
    "Roster actuel Karmine Corp LEC 2026 : Canna, Yike, Kyeahoo, Caliste, Busio. Stats, KDA, top champions + anciens joueurs (Rekkles, Targamas, Cabochard, etc.)",
  alternates: { canonical: "/players" },
  openGraph: {
    title: "Joueurs KC — KCKILLS",
    description:
      "Roster LEC 2026 + alumni. Stats, KDA, top champions, historique.",
    type: "website",
    siteName: "KCKILLS",
  },
};

export default function PlayersPage() {
  const data = loadRealData();

  const data2026 = { ...data, matches: data.matches.filter((m) => m.date >= "2026-01-01") };
  const data2025 = { ...data, matches: data.matches.filter((m) => m.date >= "2025-01-01" && m.date < "2026-01-01") };
  const roster2026 = getKCRoster(data2026);
  const roster2025 = getKCRoster(data2025);
  const current2026Names = new Set(roster2026.map((p) => p.name));
  const recentAlumni = roster2025.filter((p) => !current2026Names.has(p.name));

  // Signature champion for hero background (first top-kill player)
  const headlinePlayer = [...roster2026].sort(
    (a, b) => b.totalKills - a.totalKills,
  )[0];
  const heroChamp = headlinePlayer?.champions[0] ?? "Jhin";

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <section className="relative py-16 px-6 md:py-24 overflow-hidden bg-[var(--bg-primary)]">
        {/* Signature splash backdrop, heavily dimmed */}
        <Image
          src={championLoadingUrl(heroChamp)}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ filter: "brightness(0.22) saturate(1.1)" }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% 40%, rgba(200,170,110,0.18) 0%, transparent 65%)",
          }}
        />
        {/* Scanlines */}
        <div
          className="absolute inset-0 opacity-15 mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.09) 3px, transparent 4px)",
          }}
        />

        <div className="relative max-w-7xl mx-auto">
          <Breadcrumb
            items={[
              { label: "Accueil", href: "/" },
              { label: "Joueurs" },
            ]}
          />

          <div className="mt-10 text-center">
            <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70 mb-4">
              {roster2026.length} actifs · {ALUMNI.length} alumni
            </p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black leading-none">
              <span className="text-shimmer">JOUEURS</span>
            </h1>
            <p className="mt-6 max-w-2xl mx-auto text-base md:text-lg text-white/70 leading-relaxed">
              Roster Karmine Corp actuel + anciens. Stats, KDA,
              champion pool, historique. Clique une carte pour plonger dans
              les clips et la forme du joueur.
            </p>
          </div>
        </div>
      </section>

      {/* ─── ROSTER 2026 ──────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 py-12">
        <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
          <div>
            <p className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)] mb-1.5">
              ◆ Actifs
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-black text-white">
              Roster <span className="text-gold-gradient">2026</span>
            </h2>
          </div>
          <Link
            href="/alumni"
            className="group rounded-full border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:border-[var(--gold)]/60 hover:text-[var(--gold)] transition-all inline-flex items-center gap-2"
          >
            <span>Voir les alumni</span>
            <svg
              className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>

        {roster2026.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roster2026.map((player) => {
              const photo = PLAYER_PHOTOS[player.name];
              const kda =
                player.totalDeaths > 0
                  ? (
                      (player.totalKills + player.totalAssists) /
                      player.totalDeaths
                    ).toFixed(1)
                  : "Perfect";
              return (
                <Link
                  key={player.name}
                  href={`/player/${encodeURIComponent(player.name)}`}
                  className="group relative overflow-hidden rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all duration-500 hover:border-[var(--gold)]/50 hover:shadow-2xl hover:shadow-[var(--gold)]/10 hover:scale-[1.02]"
                >
                  {/* Photo background */}
                  <div className="relative h-48 overflow-hidden">
                    {photo ? (
                      <Image
                        src={photo}
                        alt={player.name}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover object-top transition-transform duration-500 group-hover:scale-110"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[var(--bg-elevated)] text-5xl font-black text-[var(--gold)]/20">
                        {player.name[0]}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-surface)] via-transparent to-transparent" />
                    <div className="absolute top-3 right-3 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--gold)]">
                      {roleIcon(player.role)} {displayRole(player.role)}
                    </div>
                  </div>

                  <div className="p-5 -mt-8 relative z-10">
                    <h3 className="font-display text-xl font-bold group-hover:text-[var(--gold)] transition-colors">
                      {player.name}
                    </h3>

                    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="font-data text-lg font-bold text-[var(--green)]">
                          {player.totalKills}
                        </p>
                        <p className="text-[9px] text-[var(--text-muted)]">KILLS</p>
                      </div>
                      <div>
                        <p className="font-data text-lg font-bold text-[var(--red)]">
                          {player.totalDeaths}
                        </p>
                        <p className="text-[9px] text-[var(--text-muted)]">DEATHS</p>
                      </div>
                      <div>
                        <p className="font-data text-lg font-bold">
                          {player.totalAssists}
                        </p>
                        <p className="text-[9px] text-[var(--text-muted)]">ASSISTS</p>
                      </div>
                      <div>
                        <p className="font-data text-lg font-bold text-[var(--gold)]">
                          {kda}
                        </p>
                        <p className="text-[9px] text-[var(--text-muted)]">KDA</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex gap-1">
                        {player.champions.slice(0, 5).map((c) => (
                          <Image
                            key={c}
                            src={championIconUrl(c)}
                            alt={c}
                            width={24}
                            height={24}
                            className="rounded-full border border-[var(--border-gold)]"
                            data-tooltip={c}
                          />
                        ))}
                      </div>
                      <span className="font-data text-[10px] text-[var(--text-muted)] ml-auto">
                        {player.gamesPlayed} games
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── RECENT ALUMNI (2025 that left before 2026) ──────────── */}
      {recentAlumni.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 md:px-6 py-10">
          <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--text-muted)] mb-1.5">
                ◆ Récents départs
              </p>
              <h2 className="font-display text-2xl md:text-3xl font-black text-white/80">
                Saison <span className="text-[var(--cyan)]">2025</span>
              </h2>
            </div>
            <Link
              href="/alumni"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)] uppercase tracking-widest font-bold"
            >
              Historique complet →
            </Link>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {recentAlumni.map((player) => {
              const kda =
                player.totalDeaths > 0
                  ? (
                      (player.totalKills + player.totalAssists) /
                      player.totalDeaths
                    ).toFixed(1)
                  : "Perfect";
              return (
                <Link
                  key={player.name}
                  href={`/player/${encodeURIComponent(player.name)}`}
                  className="flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 grayscale opacity-75 transition-all hover:grayscale-0 hover:opacity-100 hover:border-[var(--gold)]/40"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-elevated)] font-bold text-[var(--text-muted)]">
                    {player.name[0]}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{player.name}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {displayRole(player.role)} · {player.gamesPlayed}G
                    </p>
                  </div>
                  <p className="font-data text-sm">
                    <span className="text-[var(--green)]">{player.totalKills}</span>/
                    <span className="text-[var(--red)]">{player.totalDeaths}</span>/
                    <span>{player.totalAssists}</span>
                    <span className="ml-2 text-[var(--gold)] font-bold">{kda}</span>
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── ALUMNI TEASER (the legends pre-2025) ─────────────────── */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 py-12">
        <div className="rounded-2xl border border-[var(--border-gold)] bg-gradient-to-br from-[var(--bg-surface)] via-[var(--bg-surface)] to-[var(--gold)]/5 p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="flex-1">
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
                ★ La légende
              </p>
              <h2 className="font-display text-2xl md:text-3xl font-black text-white mb-3">
                {ALUMNI.length} joueurs ont porté le{" "}
                <span className="text-gold-gradient">maillot KC</span>
              </h2>
              <p className="text-sm md:text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                Rekkles, Targamas, Cabochard, Saken, Vetheo, Yike, Hantera…
                Parcours individuels, ères, champions signatures et clips
                historiques. L&apos;histoire complète de la line Karmine Corp.
              </p>
            </div>

            <Link
              href="/alumni"
              className="rounded-xl bg-[var(--gold)] px-6 py-3 font-display text-sm font-black uppercase tracking-widest text-black hover:bg-[var(--gold-bright)] transition-all whitespace-nowrap"
            >
              Hall of Alumni →
            </Link>
          </div>

          {/* Quick alumni icon strip */}
          <div className="mt-6 flex flex-wrap gap-2 opacity-80">
            {ALUMNI.slice(0, 12).map((a) => (
              <Link
                key={a.slug}
                href={`/alumni/${a.slug}`}
                className="rounded-full border border-[var(--border-gold)] bg-black/30 px-3 py-1 text-[11px] font-bold text-white/70 hover:border-[var(--gold)]/60 hover:text-[var(--gold)] transition-all"
              >
                {a.name}
              </Link>
            ))}
            {ALUMNI.length > 12 && (
              <span className="rounded-full border border-dashed border-[var(--border-gold)] px-3 py-1 text-[11px] text-[var(--text-disabled)]">
                +{ALUMNI.length - 12} autres
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
