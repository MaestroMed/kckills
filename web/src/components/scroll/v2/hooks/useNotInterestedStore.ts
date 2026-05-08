"use client";

/**
 * useNotInterestedStore — V29 (Wave 22.1).
 *
 * Tiny localStorage-backed signal store : when the user picks
 * "Pas intéressé" from the V3 long-press menu we record the kill's
 * key facets (player, champion, fight type, tags) and downweight
 * future cold-start anchors that match.
 *
 * Storage shape (localStorage key `kc_neg_signals_v1`) :
 *   {
 *     players:    { [playerId]: timestamp_ms },
 *     champions:  { [name]:     timestamp_ms },
 *     fightTypes: { [type]:     timestamp_ms },
 *     tags:       { [tag]:      timestamp_ms },
 *     killIds:    { [id]:       timestamp_ms }   // exact-match ban
 *   }
 *
 * Decay : entries older than 14 days are pruned on read so the
 * negative signal doesn't shadow forever.
 *
 * Consumed by useRecommendationFeed via the matching hook.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kc_neg_signals_v1";
const DECAY_MS = 14 * 24 * 60 * 60 * 1000;

export interface NegativeSignals {
  players: Record<string, number>;
  champions: Record<string, number>;
  fightTypes: Record<string, number>;
  tags: Record<string, number>;
  killIds: Record<string, number>;
}

const EMPTY: NegativeSignals = {
  players: {},
  champions: {},
  fightTypes: {},
  tags: {},
  killIds: {},
};

function decay(map: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (now - v < DECAY_MS) out[k] = v;
  }
  return out;
}

function readSignals(): NegativeSignals {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<NegativeSignals>;
    const now = Date.now();
    return {
      players: decay(parsed.players ?? {}, now),
      champions: decay(parsed.champions ?? {}, now),
      fightTypes: decay(parsed.fightTypes ?? {}, now),
      tags: decay(parsed.tags ?? {}, now),
      killIds: decay(parsed.killIds ?? {}, now),
    };
  } catch {
    return EMPTY;
  }
}

function writeSignals(s: NegativeSignals) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("kc:neg-signals-changed"));
  } catch {
    /* quota exceeded */
  }
}

export function useNotInterestedStore() {
  const [signals, setSignals] = useState<NegativeSignals>(readSignals);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setSignals(readSignals());
    window.addEventListener("kc:neg-signals-changed", onChange);
    return () => window.removeEventListener("kc:neg-signals-changed", onChange);
  }, []);

  const recordNotInterested = useCallback(
    (item: {
      id?: string | null;
      killerPlayerId?: string | null;
      killerChampion?: string | null;
      victimChampion?: string | null;
      fightType?: string | null;
      aiTags?: string[] | null;
    }) => {
      const now = Date.now();
      const next: NegativeSignals = {
        players: { ...signals.players },
        champions: { ...signals.champions },
        fightTypes: { ...signals.fightTypes },
        tags: { ...signals.tags },
        killIds: { ...signals.killIds },
      };
      if (item.id) next.killIds[item.id] = now;
      if (item.killerPlayerId) next.players[item.killerPlayerId] = now;
      if (item.killerChampion) next.champions[item.killerChampion] = now;
      if (item.victimChampion) next.champions[item.victimChampion] = now;
      if (item.fightType) next.fightTypes[item.fightType] = now;
      for (const tag of item.aiTags ?? []) {
        next.tags[tag.toLowerCase()] = now;
      }
      setSignals(next);
      writeSignals(next);
    },
    [signals],
  );

  /** Return a downweight factor in [0, 1] for an item. 1.0 = no
   *  penalty, lower = stronger ban. Combine multiplicatively with
   *  the base score upstream. */
  const downweightFor = useCallback(
    (item: {
      id?: string | null;
      killerPlayerId?: string | null;
      killerChampion?: string | null;
      victimChampion?: string | null;
      fightType?: string | null;
      aiTags?: string[] | null;
    }): number => {
      let factor = 1;
      if (item.id && signals.killIds[item.id]) factor *= 0; // hard ban
      if (item.killerPlayerId && signals.players[item.killerPlayerId]) factor *= 0.4;
      if (item.killerChampion && signals.champions[item.killerChampion]) factor *= 0.55;
      if (item.victimChampion && signals.champions[item.victimChampion]) factor *= 0.65;
      if (item.fightType && signals.fightTypes[item.fightType]) factor *= 0.7;
      for (const tag of item.aiTags ?? []) {
        if (signals.tags[tag.toLowerCase()]) factor *= 0.85;
      }
      return factor;
    },
    [signals],
  );

  return { signals, recordNotInterested, downweightFor };
}
