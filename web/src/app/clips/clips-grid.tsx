"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { championIconUrl } from "@/lib/constants";
import { TEAM_LOGOS } from "@/lib/kc-assets";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";
import { Breadcrumb } from "@/components/Breadcrumb";

export interface ClipCard {
  id: string;
  killerChampion: string;
  victimChampion: string;
  killerPlayerId: string | null;
  thumbnail: string | null;
  clipVerticalLow: string | null;
  highlightScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  commentCount: number;
  impressionCount: number;
  aiDescription: string | null;
  aiTags: string[];
  multiKill: string | null;
  isFirstBlood: boolean;
  fightType: string | null;
  gameTimeSeconds: number;
  gameNumber: number;
  matchStage: string;
  matchDate: string;
  opponentCode: string;
  opponentName: string | null;
  kcWon: boolean | null;
  matchScore: string | null;
  createdAt: string;
}

type SortKey = "recent" | "score" | "rating" | "impressions";

export interface InitialFilters {
  multiKillsOnly: boolean;
  firstBloodOnly: boolean;
  fightType: string | null;
  opponent: string | null;
  sort: SortKey;
  search: string;
}

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Récents",
  score: "Meilleurs",
  rating: "Mieux notés",
  impressions: "Populaires",
};

const FIGHT_TYPE_LABELS: Record<string, string> = {
  solo_kill: "Solo",
  pick: "Pick",
  gank: "Gank",
  skirmish_2v2: "2v2",
  skirmish_3v3: "3v3",
  teamfight_4v4: "TF 4v4",
  teamfight_5v5: "TF 5v5",
};

export function ClipsGrid({ initialCards, initialFilters }: { initialCards: ClipCard[]; initialFilters?: InitialFilters }) {
  const [sortKey, setSortKey] = useState<SortKey>(initialFilters?.sort ?? "recent");
  const [opponentFilter, setOpponentFilter] = useState<string | null>(initialFilters?.opponent ?? null);
  const [fightTypeFilter, setFightTypeFilter] = useState<string | null>(initialFilters?.fightType ?? null);
  const [multiKillsOnly, setMultiKillsOnly] = useState(initialFilters?.multiKillsOnly ?? false);
  const [firstBloodOnly, setFirstBloodOnly] = useState(initialFilters?.firstBloodOnly ?? false);
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [visibleCount, setVisibleCount] = useState(60);

  // Distinct opponents for the chip bar
  const opponents = useMemo(() => {
    const set = new Set<string>();
    for (const c of initialCards) {
      if (c.opponentCode && c.opponentCode !== "LEC") set.add(c.opponentCode);
    }
    return Array.from(set).sort();
  }, [initialCards]);

  // Distinct fight types
  const fightTypes = useMemo(() => {
    const set = new Set<string>();
    for (const c of initialCards) {
      if (c.fightType) set.add(c.fightType);
    }
    return Array.from(set).sort();
  }, [initialCards]);

  const filtered = useMemo(() => {
    let list = [...initialCards];

    if (opponentFilter) list = list.filter((c) => c.opponentCode === opponentFilter);
    if (fightTypeFilter) list = list.filter((c) => c.fightType === fightTypeFilter);
    if (multiKillsOnly) list = list.filter((c) => !!c.multiKill);
    if (firstBloodOnly) list = list.filter((c) => c.isFirstBlood);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.killerChampion.toLowerCase().includes(q) ||
          c.victimChampion.toLowerCase().includes(q) ||
          (c.aiDescription ?? "").toLowerCase().includes(q),
      );
    }

    switch (sortKey) {
      case "recent":
        list.sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""));
        break;
      case "score":
        list.sort((a, b) => (b.highlightScore ?? 0) - (a.highlightScore ?? 0));
        break;
      case "rating":
        list.sort((a, b) => {
          const ar = a.ratingCount > 0 ? (a.avgRating ?? 0) : 0;
          const br = b.ratingCount > 0 ? (b.avgRating ?? 0) : 0;
          return br - ar;
        });
        break;
      case "impressions":
        list.sort((a, b) => b.impressionCount - a.impressionCount);
        break;
    }

    return list;
  }, [initialCards, sortKey, opponentFilter, fightTypeFilter, multiKillsOnly, firstBloodOnly, search]);

  const hasActiveFilter =
    opponentFilter || fightTypeFilter || multiKillsOnly || firstBloodOnly || search.trim();

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Accueil", href: "/" },
          { label: "Clips" },
        ]}
      />

      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-black uppercase">
            Tous les <span className="text-gold-gradient">clips</span>
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {filtered.length} clips {hasActiveFilter ? "filtrés" : "publiés"} · {initialCards.length} au total
          </p>
        </div>
        {/* Hall-of-Fame cross-link — discoverability from the main catalog.
            /records curates the top clips by category, which is a natural
            next step when someone arrives here looking for "the best". */}
        <Link
          href="/records"
          className="group rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-4 py-2 text-xs font-display font-bold uppercase tracking-widest text-[var(--gold)] hover:bg-[var(--gold)]/15 hover:border-[var(--gold)]/60 transition-all inline-flex items-center gap-2"
        >
          <span>★ Records Absolus</span>
          <svg className="h-3 w-3 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </header>

      {/* Filters bar */}
      <div className="space-y-3 sticky top-0 z-30 bg-[var(--bg-primary)]/95 backdrop-blur-md py-3 -mx-4 px-4 border-b border-[var(--border-gold)]/30">
        {/* Search + sort */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(60);
            }}
            placeholder="Filtrer par champion ou description..."
            className="flex-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm focus:border-[var(--gold)] outline-none"
          />
          <div className="flex gap-1">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`rounded-lg border px-3 py-2 text-xs font-bold whitespace-nowrap transition-all ${
                  sortKey === k
                    ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]"
                    : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--gold)]"
                }`}
              >
                {SORT_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        {/* Opponent chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setOpponentFilter(null)}
            className={`rounded-full px-3 py-1 text-xs font-bold border transition-all ${
              !opponentFilter
                ? "border-[var(--gold)] bg-[var(--gold)]/20 text-[var(--gold)]"
                : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--gold)]"
            }`}
          >
            Tous adversaires
          </button>
          {opponents.map((code) => (
            <button
              key={code}
              onClick={() => setOpponentFilter(opponentFilter === code ? null : code)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border transition-all ${
                opponentFilter === code
                  ? "border-[var(--gold)] bg-[var(--gold)]/20 text-[var(--gold)]"
                  : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--gold)]"
              }`}
            >
              {TEAM_LOGOS[code] && (
                <img src={TEAM_LOGOS[code]} alt="" className="h-3.5 w-3.5 object-contain" />
              )}
              {code}
            </button>
          ))}
        </div>

        {/* Fight type + flags */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFightTypeFilter(null)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider border transition-all ${
              !fightTypeFilter
                ? "border-[var(--cyan)] bg-[var(--cyan)]/20 text-[var(--cyan)]"
                : "border-[var(--border-gold)]/50 text-[var(--text-muted)]"
            }`}
          >
            Tous fights
          </button>
          {fightTypes.map((ft) => (
            <button
              key={ft}
              onClick={() => setFightTypeFilter(fightTypeFilter === ft ? null : ft)}
              className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider border transition-all ${
                fightTypeFilter === ft
                  ? "border-[var(--cyan)] bg-[var(--cyan)]/20 text-[var(--cyan)]"
                  : "border-[var(--border-gold)]/50 text-[var(--text-muted)] hover:text-[var(--cyan)]"
              }`}
            >
              {FIGHT_TYPE_LABELS[ft] ?? ft}
            </button>
          ))}
          <button
            onClick={() => setMultiKillsOnly((v) => !v)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider border transition-all ${
              multiKillsOnly
                ? "border-[var(--orange)] bg-[var(--orange)]/20 text-[var(--orange)]"
                : "border-[var(--border-gold)]/50 text-[var(--text-muted)] hover:text-[var(--orange)]"
            }`}
          >
            ⚡ Multi-kills
          </button>
          <button
            onClick={() => setFirstBloodOnly((v) => !v)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider border transition-all ${
              firstBloodOnly
                ? "border-[var(--red)] bg-[var(--red)]/20 text-[var(--red)]"
                : "border-[var(--border-gold)]/50 text-[var(--text-muted)] hover:text-[var(--red)]"
            }`}
          >
            🩸 First Blood
          </button>
        </div>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <p className="text-center py-16 text-[var(--text-muted)]">
          Aucun clip ne correspond aux filtres.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {visible.map((c) => (
              <ClipCardComponent key={c.id} card={c} />
            ))}
          </div>

          {visibleCount < filtered.length && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => setVisibleCount((n) => n + 60)}
                className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-6 py-2.5 text-sm font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20"
              >
                Charger plus ({filtered.length - visibleCount} restants)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ClipCardComponent({ card }: { card: ClipCard }) {
  const gtMin = Math.floor(card.gameTimeSeconds / 60);
  const gtSec = card.gameTimeSeconds % 60;
  const dateStr = card.matchDate
    ? new Date(card.matchDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : "";

  const showDesc = isDescriptionClean(card.aiDescription);
  const oppLogo = TEAM_LOGOS[card.opponentCode];

  return (
    <Link
      href={`/scroll?kill=${card.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] hover:border-[var(--gold)]/60 hover:-translate-y-0.5 transition-all"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[9/16] overflow-hidden bg-black">
        {card.thumbnail ? (
          <Image
            src={card.thumbnail}
            alt={`${card.killerChampion} → ${card.victimChampion}`}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : null}

        {/* Top overlay: opponent + date */}
        <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between text-[10px] z-10">
          <div className="flex items-center gap-1 rounded-full bg-black/70 backdrop-blur-sm px-2 py-0.5 border border-white/10">
            <span className="font-bold text-[var(--gold)]">KC</span>
            <span className="text-white/50">vs</span>
            {oppLogo ? (
              <img src={oppLogo} alt="" className="h-3 w-3 object-contain" />
            ) : null}
            <span className="font-bold text-white">{card.opponentCode}</span>
          </div>
          {card.matchScore && card.kcWon !== null && (
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold backdrop-blur-sm ${
              card.kcWon ? "bg-[var(--green)]/30 text-[var(--green)]" : "bg-[var(--red)]/30 text-[var(--red)]"
            }`}>
              {card.matchScore}
            </span>
          )}
        </div>

        {/* Multi-kill badge */}
        {(card.multiKill || card.isFirstBlood) && (
          <div className="absolute top-9 left-1.5 right-1.5 flex flex-wrap gap-1 z-10">
            {card.multiKill && (
              <span className="rounded-full bg-[var(--orange)]/90 px-2 py-0.5 text-[9px] font-bold uppercase text-black">
                ⚡ {card.multiKill}
              </span>
            )}
            {card.isFirstBlood && (
              <span className="rounded-full bg-[var(--red)]/90 px-2 py-0.5 text-[9px] font-bold uppercase text-white">
                🩸 FB
              </span>
            )}
          </div>
        )}

        {/* Bottom overlay: champions */}
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 to-transparent z-10">
          <div className="flex items-center gap-1.5">
            <Image
              src={championIconUrl(card.killerChampion)}
              alt=""
              width={28}
              height={28}
              className="rounded-md border border-[var(--gold)]/60"
            />
            <span className="text-[var(--gold)] text-xs">→</span>
            <Image
              src={championIconUrl(card.victimChampion)}
              alt=""
              width={24}
              height={24}
              className="rounded-md border border-white/20 opacity-70"
            />
          </div>
        </div>

        {/* Score badge */}
        {card.highlightScore !== null && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-bold text-[var(--gold)] z-10">
            {card.highlightScore.toFixed(1)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-2 flex-1 flex flex-col justify-between min-h-[60px]">
        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
          <span className="font-mono">T+{gtMin}:{gtSec.toString().padStart(2, "0")}</span>
          <span>{dateStr}</span>
        </div>
        {showDesc && (
          <p className="text-[10px] text-white/70 italic leading-tight mt-1 line-clamp-2">
            {card.aiDescription}
          </p>
        )}
      </div>
    </Link>
  );
}
