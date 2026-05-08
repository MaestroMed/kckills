"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * ScrollChipBar — sticky filter chip strip rendered above the feed.
 *
 * Why a separate component: the feed itself is a heavy snap-y/snap-mandatory
 * container with hundreds of items; isolating the chip bar means filter
 * toggles re-render only the strip + trigger a server navigation, not the
 * feed component tree.
 *
 * URL state is the single source of truth — every chip toggle pushes a new
 * URL via router.replace(). The page.tsx server component re-runs, applies
 * the filter, and ScrollFeed receives a new `items` prop. Refresh-safe and
 * shareable by design.
 *
 * Five chip categories:
 *   1. Multi-kills   (boolean — ?multi=1)
 *   2. First bloods  (boolean — ?fb=1)
 *   3. Side          (kc / vs — ?side=kc)
 *   4. Fight type    (one of N — ?fight=teamfight_5v5)
 *   5. Player        (one of 5 KC roster IDs — ?player=<UUID>)
 */

export interface ChipFilters {
  multiKillsOnly: boolean;
  firstBloodsOnly: boolean;
  player: string | null;
  fight: string | null;
  side: "kc" | "vs" | null;
  /** V14 — `?tag=` filter active (e.g. "outplay", "clutch"). Lower-cased
   *  string ; null when the user hasn't pinned a tag. The chip bar
   *  doesn't expose tag chips itself (would be too many) — the bar
   *  surfaces a "clear tag" pill when one is active so the user can
   *  unfilter without leaving /scroll. */
  tag: string | null;
}

interface PlayerChipDef {
  /** killer_player_id UUID (resolved server-side from kc_matches.json IGNs). */
  id: string;
  ign: string;
  role: "TOP" | "JGL" | "MID" | "ADC" | "SUP";
}

interface Props {
  filters: ChipFilters;
  /** Optional roster UUIDs (resolved by the server). When empty, the
   *  player chip group hides — better than rendering buttons that don't
   *  filter to anything. */
  rosterChips?: PlayerChipDef[];
}

const FIGHT_CHIPS: { value: string; label: string }[] = [
  { value: "solo_kill", label: "Solo" },
  { value: "skirmish_2v2", label: "2v2" },
  { value: "skirmish_3v3", label: "3v3" },
  { value: "teamfight_4v4", label: "Teamfight" },
  { value: "teamfight_5v5", label: "5v5" },
  { value: "gank", label: "Gank" },
  { value: "pick", label: "Pick" },
];

export function ScrollChipBar({ filters, rosterChips = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const activeCount =
    (filters.multiKillsOnly ? 1 : 0) +
    (filters.firstBloodsOnly ? 1 : 0) +
    (filters.player ? 1 : 0) +
    (filters.fight ? 1 : 0) +
    (filters.side ? 1 : 0) +
    (filters.tag ? 1 : 0);

  const hasAny = activeCount > 0;

  /** Build a new query string preserving anything we don't touch. */
  const buildHref = (mutations: Record<string, string | null>): string => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(mutations)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const navigate = (mutations: Record<string, string | null>) => {
    startTransition(() => {
      router.replace(buildHref(mutations), { scroll: false });
    });
  };

  const clearAll = () => {
    navigate({ multi: null, fb: null, player: null, fight: null, side: null, tag: null });
  };

  const clearTag = () => navigate({ tag: null });

  const toggleBoolean = (key: "multi" | "fb", currently: boolean) => {
    navigate({ [key]: currently ? null : "1" });
  };

  const toggleSide = (next: "kc" | "vs") => {
    navigate({ side: filters.side === next ? null : next });
  };

  const toggleFight = (value: string) => {
    navigate({ fight: filters.fight === value ? null : value });
  };

  const togglePlayer = (id: string) => {
    navigate({ player: filters.player === id ? null : id });
  };

  return (
    <div
      className="fixed left-0 right-0 z-40 px-3"
      style={{ top: "calc(env(safe-area-inset-top, 0.75rem) + 56px)" }}
    >
      <div
        className={`mx-auto max-w-3xl rounded-2xl border border-[var(--gold)]/20 bg-black/65 backdrop-blur-md shadow-lg shadow-black/30 transition-all ${
          isPending ? "opacity-70" : ""
        }`}
      >
        {/* Compact row — always visible */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-2 scrollbar-none">
          <ChipButton
            active={hasAny}
            onClick={() => setExpanded((v) => !v)}
            ariaLabel="Filtres"
            compact
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L15 12.414V19a1 1 0 01-.553.894l-4 2A1 1 0 019 21v-8.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            {activeCount > 0 && (
              <span className="ml-1 rounded-full bg-[var(--gold)] px-1.5 text-[9px] font-black text-black tabular-nums">
                {activeCount}
              </span>
            )}
          </ChipButton>

          {/* Quick toggles — always inline because they're the highest-value */}
          <ChipButton
            active={filters.multiKillsOnly}
            onClick={() => toggleBoolean("multi", filters.multiKillsOnly)}
            accent="var(--orange)"
          >
            ★ Multi
          </ChipButton>
          {/* V14 — when a tag is pinned (deep-linked from a feed item),
              show a clearable pill so the user can unfilter without
              leaving /scroll. The tag chip bar doesn't enumerate every
              possible tag (would be 30+ chips) — discovery happens via
              tap on a clip's tag row. */}
          {filters.tag && (
            <ChipButton
              active
              onClick={clearTag}
              ariaLabel={`Effacer le filtre #${filters.tag}`}
              accent="var(--cyan)"
            >
              #{filters.tag}
              <span aria-hidden className="ml-1 text-white/70">×</span>
            </ChipButton>
          )}
          <ChipButton
            active={filters.firstBloodsOnly}
            onClick={() => toggleBoolean("fb", filters.firstBloodsOnly)}
            accent="var(--red)"
          >
            ☠ FB
          </ChipButton>
          <ChipButton
            active={filters.side === "kc"}
            onClick={() => toggleSide("kc")}
            accent="var(--gold)"
          >
            KC
          </ChipButton>
          <ChipButton
            active={filters.side === "vs"}
            onClick={() => toggleSide("vs")}
            accent="var(--red)"
          >
            vs KC
          </ChipButton>

          {hasAny && (
            <button
              onClick={clearAll}
              className="ml-auto rounded-full px-2 py-1 text-[10px] font-data uppercase tracking-widest text-white/55 hover:text-white transition-colors flex-shrink-0"
              aria-label="Reset filters"
            >
              Reset
            </button>
          )}
        </div>

        {/* Expanded panel — fight types + player chips */}
        {expanded && (
          <div className="border-t border-white/10 px-2 py-2 space-y-2">
            <div>
              <p className="px-1 pb-1 text-[9px] font-data uppercase tracking-widest text-white/45">
                Fight type
              </p>
              <div className="flex flex-wrap gap-1.5">
                {FIGHT_CHIPS.map((f) => (
                  <ChipButton
                    key={f.value}
                    active={filters.fight === f.value}
                    onClick={() => toggleFight(f.value)}
                    accent="var(--cyan)"
                  >
                    {f.label}
                  </ChipButton>
                ))}
              </div>
            </div>

            {rosterChips.length > 0 && (
              <div>
                <p className="px-1 pb-1 text-[9px] font-data uppercase tracking-widest text-white/45">
                  Joueur
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {rosterChips.map((p) => (
                    <ChipButton
                      key={p.id}
                      active={filters.player === p.id}
                      onClick={() => togglePlayer(p.id)}
                      accent="var(--gold)"
                    >
                      {p.ign}
                      <span className="ml-1 text-[9px] text-white/40">{p.role}</span>
                    </ChipButton>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chip button ───────────────────────────────────────────────────────

function ChipButton({
  children,
  active,
  onClick,
  accent = "var(--gold)",
  ariaLabel,
  compact = false,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  accent?: string;
  ariaLabel?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`flex items-center rounded-full border font-data text-[11px] font-bold uppercase tracking-wider transition-all flex-shrink-0 ${
        compact ? "px-2 py-1" : "px-2.5 py-1"
      }`}
      style={{
        color: active ? accent : "rgba(255,255,255,0.7)",
        borderColor: active ? `${accent}` : "rgba(255,255,255,0.15)",
        backgroundColor: active ? `${accent}25` : "rgba(255,255,255,0.04)",
        boxShadow: active ? `0 0 12px ${accent}55` : undefined,
      }}
    >
      {children}
    </button>
  );
}
