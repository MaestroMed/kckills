"use client";

/**
 * Command Palette — ⌘K / Ctrl+K global search.
 *
 * Self-contained: no cmdk dep, no shadcn, ~4 KB after tree-shaking.
 * Indexes eras + current roster + recent matches + static routes at module load
 * time (baked from the existing static imports), so search runs client-side
 * against a fixed JSON list.
 *
 * Keyboard:
 *  ⌘K / Ctrl+K     open
 *  Esc             close
 *  ↑ / ↓           cycle results
 *  Enter           navigate to the highlighted entry
 *
 * Mounted globally in Providers.tsx so every route has it.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import kcMatchesJson from "@/data/kc_matches.json";
import { ERAS } from "@/lib/eras";
import { ALUMNI } from "@/lib/alumni";

// ─── Index types ────────────────────────────────────────────────────────────

type Group = "era" | "player" | "match" | "page" | "champion";

interface Entry {
  id: string;
  group: Group;
  label: string;          // main title shown in the list
  subtitle?: string;      // secondary line (period, code, stage…)
  href: string;
  hint?: string;          // tiny right-aligned hint (result, score, icon…)
  searchText: string;     // concatenated lowercased tokens for matching
}

// ─── Static routes ──────────────────────────────────────────────────────────

const PAGES: Entry[] = [
  { id: "page-home",    group: "page", label: "Accueil",       subtitle: "Landing KCKILLS", href: "/",            searchText: "accueil home landing" },
  { id: "page-scroll",  group: "page", label: "Scroll kills",  subtitle: "Mode TikTok",      href: "/scroll",      searchText: "scroll tiktok feed clips kills" },
  { id: "page-best",    group: "page", label: "Meilleurs",     subtitle: "Curation IA + comm.", href: "/best",     searchText: "meilleurs best top curation legendaires" },
  { id: "page-recent",  group: "page", label: "Derniers clips", subtitle: "Chronologique",   href: "/recent",     searchText: "recent derniers chronologique latest nouveau frais" },
  { id: "page-sphere",  group: "page", label: "Sphere immersif", subtitle: "Mode 3D 360",   href: "/sphere",     searchText: "sphere 3d 360 immersif experimental orbit" },
  { id: "page-players", group: "page", label: "Joueurs",       subtitle: "Roster KC",        href: "/players",     searchText: "joueurs players roster" },
  { id: "page-champions", group: "page", label: "Champions",   subtitle: "Browse par champ", href: "/champions",   searchText: "champions champion picks pool meta" },
  { id: "page-matchups",  group: "page", label: "Match-ups",     subtitle: "Confrontations",   href: "/matchups",    searchText: "matchups match-ups vs versus confrontations rivalites duels champions" },
  { id: "page-multikills",group: "page", label: "Multi-kills",   subtitle: "Pentas, quadras, triples", href: "/multikills", searchText: "multikills multi kills penta pentakill quadra quadrakill triple triplekill double doublekill" },
  { id: "page-alumni",  group: "page", label: "Alumni",        subtitle: "Legendes passees", href: "/alumni",      searchText: "alumni ancien past legendes rekkles xmatty cabochard" },
  { id: "page-matches", group: "page", label: "Matchs",        subtitle: "Historique",       href: "/matches",     searchText: "matchs matches historique" },
  { id: "page-top",     group: "page", label: "Top kills",     subtitle: "Leaderboard",      href: "/top",         searchText: "top leaderboard best meilleurs" },
  { id: "page-hof",     group: "page", label: "Hall of Fame",  subtitle: "Legendes KC",      href: "/hall-of-fame", searchText: "hall fame legendes legends" },
  { id: "page-records", group: "page", label: "Records",       subtitle: "Les chiffres",     href: "/records",     searchText: "records chiffres stats" },
  { id: "page-stats",   group: "page", label: "Stats",          subtitle: "Dashboard KC",     href: "/stats",       searchText: "stats statistiques dashboard kda winrate chiffres" },
  { id: "page-compare", group: "page", label: "Comparateur",   subtitle: "Joueur vs joueur", href: "/compare",     searchText: "compare comparateur versus vs joueur duel" },
  { id: "page-community",group: "page", label: "Community",    subtitle: "Edits fans",       href: "/community",   searchText: "community communaute edits fans" },
  { id: "page-api",     group: "page", label: "API Docs",       subtitle: "Documentation",    href: "/api-docs",    searchText: "api documentation endpoints rest developers" },
  { id: "page-review",  group: "page", label: "Review QA",      subtitle: "Clip quality",     href: "/review",      searchText: "review qa quality test noter clips" },
  { id: "page-settings",group: "page", label: "Parametres",    subtitle: "Profil",           href: "/settings",    searchText: "settings parametres profil" },
];

// Alumni are grouped under "player" so the search UX is consistent
const ALUMNI_ENTRIES: Entry[] = ALUMNI.map((a) => ({
  id: `alumni-${a.slug}`,
  group: "player",
  label: a.name,
  subtitle: `Alumni ${a.period} - ${a.subtitle}`,
  href: `/alumni/${a.slug}`,
  hint: a.role.toUpperCase(),
  searchText: `${a.name} ${a.realName ?? ""} ${a.role} ${a.tag} ${a.period} alumni`.toLowerCase(),
}));

// ─── Eras index ─────────────────────────────────────────────────────────────

const ERA_ENTRIES: Entry[] = ERAS.map((era) => ({
  id: `era-${era.id}`,
  group: "era",
  label: era.label,
  subtitle: `${era.period} - ${era.subtitle}`,
  href: `/era/${era.id}`,
  hint: era.result,
  searchText: [
    era.label,
    era.period,
    era.subtitle,
    era.phase,
    era.result,
    era.roster ?? "",
    era.coach ?? "",
  ]
    .join(" ")
    .toLowerCase(),
}));

// ─── Players index (built from the static kc_matches.json) ──────────────────

interface MiniMatch {
  id: string;
  date: string;
  league: string;
  stage: string;
  kc_won: boolean;
  kc_score: number;
  opp_score: number;
  best_of: number;
  opponent: { name: string; code: string };
  games: {
    kc_players: { name: string; role: string; champion?: string }[];
    opp_players?: { name: string; role: string; champion?: string }[];
  }[];
}
const kc = kcMatchesJson as unknown as { matches: MiniMatch[] };

function cleanName(raw: string): string {
  return raw.replace(/^[A-Z]{2,}\s+/, "").trim();
}
function isKCPlayer(name: string): boolean {
  return name.startsWith("KC ") || name.startsWith("KCB ");
}

const PLAYER_ENTRIES: Entry[] = (() => {
  const seen = new Map<string, { role: string; games: number }>();
  for (const match of kc.matches) {
    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (!isKCPlayer(p.name)) continue;
        const slug = cleanName(p.name).toLowerCase();
        if (!slug) continue;
        const prev = seen.get(slug);
        if (prev) {
          prev.games += 1;
        } else {
          seen.set(slug, { role: p.role, games: 1 });
        }
      }
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => b[1].games - a[1].games)
    .map(([slug, { role, games }]) => {
      const display = slug.charAt(0).toUpperCase() + slug.slice(1);
      return {
        id: `player-${slug}`,
        group: "player" as const,
        label: display,
        subtitle: `${role.toUpperCase()} - ${games} games`,
        href: `/player/${slug}`,
        hint: role.toUpperCase(),
        searchText: `${display} ${role}`.toLowerCase(),
      };
    });
})();

// ─── Champions index (every champion seen in any kc_players or opp_players) ─

const CHAMPION_ENTRIES: Entry[] = (() => {
  const seen = new Map<string, number>();
  for (const match of kc.matches) {
    for (const game of match.games) {
      const all = [...(game.kc_players ?? []), ...(game.opp_players ?? [])];
      for (const p of all) {
        const c = p.champion;
        if (!c) continue;
        seen.set(c, (seen.get(c) ?? 0) + 1);
      }
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([champ, count]) => ({
      id: `champion-${champ}`,
      group: "champion" as const,
      label: champ,
      subtitle: `${count} apparition${count > 1 ? "s" : ""}`,
      href: `/champion/${encodeURIComponent(champ)}`,
      hint: "CHAMP",
      searchText: champ.toLowerCase(),
    }));
})();

// ─── Matches index (last 40, newest first) ──────────────────────────────────

const MATCH_ENTRIES: Entry[] = kc.matches
  .slice()
  .sort((a, b) => (a.date > b.date ? -1 : 1))
  .slice(0, 40)
  .map((m) => {
    const date = m.date.slice(0, 10);
    const score = `${m.kc_score}-${m.opp_score}`;
    return {
      id: `match-${m.id}`,
      group: "match" as const,
      label: `KC vs ${m.opponent.name}`,
      subtitle: `${date} - ${m.league} ${m.stage}`,
      href: `/match/${m.id}`,
      hint: `${m.kc_won ? "W" : "L"} ${score}`,
      searchText: `${m.opponent.name} ${m.opponent.code} ${m.league} ${m.stage} ${date}`.toLowerCase(),
    };
  });

const INDEX: Entry[] = [
  ...PAGES,
  ...ERA_ENTRIES,
  ...ALUMNI_ENTRIES,
  ...PLAYER_ENTRIES,
  ...CHAMPION_ENTRIES,
  ...MATCH_ENTRIES,
];

// ─── Fuzzy-ish match (substring + token scoring) ────────────────────────────

function scoreEntry(entry: Entry, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  let score = 0;
  const label = entry.label.toLowerCase();
  const hay = entry.searchText;

  for (const tok of tokens) {
    if (!hay.includes(tok)) return 0; // AND across tokens
    if (label.startsWith(tok)) score += 100;
    else if (label.includes(tok)) score += 40;
    else score += 10;
  }
  // Tiny boost per group so pages/eras rise above long match list
  const groupBoost: Record<Group, number> = { era: 12, page: 8, player: 6, champion: 4, match: 2 };
  return score + groupBoost[entry.group];
}

function search(query: string): Entry[] {
  if (!query.trim()) {
    // Empty query: show default suggestions (pages + a few eras)
    return [...PAGES.slice(0, 6), ...ERA_ENTRIES.slice(0, 6)];
  }
  const scored = INDEX
    .map((e) => ({ e, s: scoreEntry(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 24)
    .map((x) => x.e);
  return scored;
}

// ─── Component ──────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<Group, string> = {
  page: "Pages",
  era: "Epoques",
  player: "Joueurs",
  champion: "Champions",
  match: "Matchs",
};
const GROUP_ORDER: Group[] = ["page", "era", "player", "champion", "match"];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Listen to "open-command-palette" custom event from navbar button
  useEffect(() => {
    const onCustom = () => setOpen(true);
    window.addEventListener("kckills:open-palette", onCustom as EventListener);
    return () => window.removeEventListener("kckills:open-palette", onCustom as EventListener);
  }, []);

  // Focus input when opened
  useLayoutEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => search(query), [query]);

  // Keep active in bounds
  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results.length, active]);

  // Group results for display
  const grouped = useMemo(() => {
    const map: Record<Group, Entry[]> = { page: [], era: [], player: [], champion: [], match: [] };
    for (const r of results) map[r.group].push(r);
    // Flat list order must match the visual order so keyboard nav is consistent
    const flat: Entry[] = [];
    for (const g of GROUP_ORDER) flat.push(...map[g]);
    return { map, flat };
  }, [results]);

  const navigate = useCallback(
    (entry: Entry) => {
      setOpen(false);
      router.push(entry.href);
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, grouped.flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = grouped.flat[active];
      if (entry) navigate(entry);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recherche globale"
      className="fixed inset-0 z-[400] flex items-start justify-center bg-black/80 backdrop-blur-md pt-[12vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-surface)]/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
        style={{ boxShadow: "0 40px 120px rgba(0,0,0,0.7), 0 0 40px rgba(200,170,110,0.15)" }}
      >
        {/* Top gold accent bar */}
        <div className="h-[2px] bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent" />

        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--border-gold)] px-5 py-4">
          <svg className="h-4 w-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Joueur, epoque, match, page..."
            className="flex-1 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-medium"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex h-6 items-center rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1.5 font-data text-[10px] text-[var(--text-muted)]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto px-2 py-2" role="listbox">
          {grouped.flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
              Aucun resultat pour <span className="text-[var(--gold)]">&ldquo;{query}&rdquo;</span>
            </div>
          ) : (
            GROUP_ORDER.map((group) => {
              const entries = grouped.map[group];
              if (entries.length === 0) return null;
              return (
                <div key={group} className="mb-2 last:mb-0">
                  <div className="px-3 py-1.5 text-[10px] font-display font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    {GROUP_LABELS[group]}
                  </div>
                  <ul className="space-y-0.5">
                    {entries.map((entry) => {
                      const flatIdx = grouped.flat.indexOf(entry);
                      const isActive = flatIdx === active;
                      return (
                        <li key={entry.id}>
                          <button
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActive(flatIdx)}
                            onClick={() => navigate(entry)}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              isActive
                                ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/60"
                            }`}
                          >
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-display font-bold ${
                                isActive
                                  ? "bg-[var(--gold)]/25 text-[var(--gold-bright)]"
                                  : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                              }`}
                            >
                              {GROUP_ICON[group]}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className={`truncate text-sm font-medium ${isActive ? "text-[var(--gold-bright)]" : "text-[var(--text-primary)]"}`}>
                                {entry.label}
                              </div>
                              {entry.subtitle && (
                                <div className="truncate text-[11px] text-[var(--text-muted)]">{entry.subtitle}</div>
                              )}
                            </div>
                            {entry.hint && (
                              <span className="shrink-0 rounded border border-[var(--border-gold)] bg-[var(--bg-primary)] px-1.5 py-0.5 font-data text-[10px] text-[var(--gold)]">
                                {entry.hint}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between border-t border-[var(--border-gold)] bg-[var(--bg-primary)]/60 px-4 py-2 text-[10px] text-[var(--text-muted)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Kbd>{"\u2191"}</Kbd><Kbd>{"\u2193"}</Kbd>naviguer</span>
            <span className="flex items-center gap-1"><Kbd>{"\u21B5"}</Kbd>ouvrir</span>
            <span className="flex items-center gap-1"><Kbd>ESC</Kbd>fermer</span>
          </div>
          <span className="hidden sm:inline">KCKILLS search</span>
        </div>
      </div>
    </div>
  );
}

const GROUP_ICON: Record<Group, string> = {
  page: "P",
  era: "E",
  player: "J",
  champion: "C",
  match: "M",
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-[16px] items-center justify-center rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1 font-data text-[9px] text-[var(--text-secondary)]">
      {children}
    </kbd>
  );
}

/**
 * Small button helper rendered in the navbar. Triggers the palette via a
 * window event so it doesn't need a React context handshake.
 */
export function CommandPaletteButton({ className = "" }: { className?: string }) {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("kckills:open-palette"))}
      aria-label="Recherche globale"
      className={`flex items-center gap-2 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-all hover:border-[var(--gold)]/50 hover:text-[var(--gold)] ${className}`}
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
      </svg>
      <span className="hidden lg:inline">Rechercher</span>
      <kbd className="hidden sm:inline-flex h-4 items-center rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1 font-data text-[9px] text-[var(--text-secondary)]">
        {mac ? "\u2318" : "Ctrl"} K
      </kbd>
    </button>
  );
}
