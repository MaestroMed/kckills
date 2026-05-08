"use client";

/**
 * useAffinityStore — V22 + V23 (Wave 24.1).
 *
 * Aggregates positive engagement across sessions : every time the
 * user dwells on a kill, the kill's killer-player and both
 * champions accumulate a small score weighted by `dwellFraction`.
 * Stored in localStorage (`kc_affinity_v1`) with exponential decay
 * so the signal stays fresh.
 *
 * Storage shape :
 *   {
 *     players:   { [playerId]: { score: number, lastSeen: number } },
 *     champions: { [name]:     { score: number, lastSeen: number } }
 *   }
 *
 * Decay : on read, every score is multiplied by exp(-Δt / TAU) where
 * TAU = 21 days. Keeps recent dwell heavy without forgetting.
 *
 * Consumed by :
 *   * `useRecommendationFeed` — top-K player/champion biases passed
 *     to /api/scroll/recommendations as `preferred_player_<id>` and
 *     `preferred_champion_<name>` query params.
 *   * `weightedShuffle` (server-side) — applies a small score
 *     multiplier (×1.15) when an item matches a top affinity entry.
 *   * `OnboardingModal` (V27) — seeds initial entries when the user
 *     picks their favorite roster on first visit.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kc_affinity_v1";
const DECAY_TAU_MS = 21 * 24 * 60 * 60 * 1000; // 21-day half-life-ish

interface Entry {
  score: number;
  lastSeen: number;
}

export interface AffinityState {
  players: Record<string, Entry>;
  champions: Record<string, Entry>;
}

const EMPTY: AffinityState = { players: {}, champions: {} };

function decayMap(map: Record<string, Entry>, now: number): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const [k, v] of Object.entries(map)) {
    const age = now - v.lastSeen;
    if (age < 0) {
      out[k] = v;
      continue;
    }
    const factor = Math.exp(-age / DECAY_TAU_MS);
    const decayed = v.score * factor;
    if (decayed > 0.05) {
      out[k] = { score: decayed, lastSeen: v.lastSeen };
    }
    // else drop — entry has decayed below relevance.
  }
  return out;
}

function readState(): AffinityState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AffinityState>;
    const now = Date.now();
    return {
      players: decayMap(parsed.players ?? {}, now),
      champions: decayMap(parsed.champions ?? {}, now),
    };
  } catch {
    return EMPTY;
  }
}

function writeState(s: AffinityState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("kc:affinity-changed"));
  } catch {
    /* quota exceeded */
  }
}

export function useAffinityStore() {
  const [state, setState] = useState<AffinityState>(readState);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setState(readState());
    window.addEventListener("kc:affinity-changed", onChange);
    return () => window.removeEventListener("kc:affinity-changed", onChange);
  }, []);

  /** Add a dwell observation. `dwellFraction` should be 0..1 ; the
   *  score increment is proportional. Fast scroll-pasts (< 0.05)
   *  contribute nothing. */
  const recordDwell = useCallback(
    (
      playerId: string | null | undefined,
      killerChampion: string | null | undefined,
      victimChampion: string | null | undefined,
      dwellFraction: number,
    ) => {
      if (dwellFraction < 0.05) return;
      const now = Date.now();
      // Read fresh so concurrent updates don't trample.
      const current = readState();
      const next: AffinityState = {
        players: { ...current.players },
        champions: { ...current.champions },
      };
      const bump = (
        map: Record<string, Entry>,
        key: string,
        amt: number,
      ) => {
        const prev = map[key];
        map[key] = {
          score: (prev?.score ?? 0) + amt,
          lastSeen: now,
        };
      };
      if (playerId) bump(next.players, playerId, dwellFraction);
      if (killerChampion) bump(next.champions, killerChampion, dwellFraction * 0.6);
      if (victimChampion) bump(next.champions, victimChampion, dwellFraction * 0.3);
      setState(next);
      writeState(next);
    },
    [],
  );

  /** Seed the store with initial player picks (V27 onboarding). Each
   *  picked player gets a score of 1.5 — enough to dominate the
   *  cold-start cosine until real dwell signals accumulate. */
  const seedFromOnboarding = useCallback((playerIds: string[]) => {
    const now = Date.now();
    const current = readState();
    const next: AffinityState = {
      players: { ...current.players },
      champions: { ...current.champions },
    };
    for (const id of playerIds) {
      next.players[id] = {
        score: Math.max(next.players[id]?.score ?? 0, 1.5),
        lastSeen: now,
      };
    }
    setState(next);
    writeState(next);
  }, []);

  /** Top-K player IDs sorted by score DESC. */
  const topPlayers = useCallback(
    (k: number = 3): string[] => {
      return Object.entries(state.players)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, k)
        .map(([id]) => id);
    },
    [state.players],
  );

  /** Top-K champion names sorted by score DESC. */
  const topChampions = useCallback(
    (k: number = 5): string[] => {
      return Object.entries(state.champions)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, k)
        .map(([name]) => name);
    },
    [state.champions],
  );

  return {
    state,
    recordDwell,
    seedFromOnboarding,
    topPlayers,
    topChampions,
  };
}
