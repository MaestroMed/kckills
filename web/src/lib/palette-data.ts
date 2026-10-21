/**
 * Index « données » de la palette ⌘K : joueurs, champions, 40 dernières
 * séries. Construit côté serveur (/api/palette/data) depuis getRealData(),
 * donc à jour sans redéploiement. Avant : calculé dans le bundle client
 * depuis le kc_matches.json embarqué, figé au 11/04/2026.
 */
import type { RealMatch } from "@/lib/real-data";

export type PaletteGroup = "era" | "player" | "match" | "page" | "champion" | "clip";

export interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  label: string;          // main title shown in the list
  subtitle?: string;      // secondary line (period, code, stage…)
  href: string;
  hint?: string;          // tiny right-aligned hint (result, score, icon…)
  searchText: string;     // concatenated lowercased tokens for matching
}

// ─── Players index ──────────────────────────────────────────────────────────

function cleanName(raw: string): string {
  return raw.replace(/^[A-Z]{2,}\s+/, "").trim();
}
function isKCPlayer(name: string): boolean {
  return name.startsWith("KC ") || name.startsWith("KCB ");
}

function playerEntries(matches: RealMatch[]): PaletteEntry[] {
  const seen = new Map<string, { role: string; games: number }>();
  for (const match of matches) {
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
}

// ─── Champions index (every champion seen in any kc_players or opp_players) ─

function championEntries(matches: RealMatch[]): PaletteEntry[] {
  const seen = new Map<string, number>();
  for (const match of matches) {
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
}

// ─── Matches index (last 40, newest first) ──────────────────────────────────

function matchEntries(matches: RealMatch[]): PaletteEntry[] {
  return matches
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
}

export function buildPaletteDataEntries(matches: RealMatch[]): PaletteEntry[] {
  return [...playerEntries(matches), ...championEntries(matches), ...matchEntries(matches)];
}
