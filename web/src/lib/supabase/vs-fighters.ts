/**
 * Les combattants de l'écran de sélection VS (/vs).
 *
 * Candidats : le roster 2026 et les anciens de la KC (lib/alumni, photos de
 * lib/kc-assets). Chacun n'est proposé que s'il a au moins MIN_CLIPS kills
 * jouables par la roulette — même filtre que fn_pick_vs_pair (migration
 * 093) : publié, clip vertical, kill DE la KC, kill_visible non faux, tueur
 * au pseudo identique (casse ignorée). Une requête `count` par candidat
 * (aucune ligne transférée), ISR 30 min.
 */

import "server-only";
import { cache } from "react";
import { ALUMNI } from "@/lib/alumni";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { createCachedAnonSupabase, rethrowIfDynamic } from "./server";

export interface VSFighter {
  /** Pseudo exact, sert de `player_slug` à la roulette. */
  ign: string;
  role: "top" | "jungle" | "mid" | "bottom" | "support" | null;
  /** « Roster 2026 » ou la période à la KC (« 2022 »). */
  period: string;
  photo: string | null;
  /** Champion signature : art de repli sans photo. */
  champion: string | null;
  clips: number;
  current: boolean;
}

const MIN_CLIPS = 3;

/** Roster 2026, dans l'ordre des rôles. */
const ROSTER_2026: { ign: string; role: VSFighter["role"] }[] = [
  { ign: "Canna", role: "top" },
  { ign: "Yike", role: "jungle" },
  { ign: "Kyeahoo", role: "mid" },
  { ign: "Caliste", role: "bottom" },
  { ign: "Busio", role: "support" },
];

const ROLE_OF: Record<string, VSFighter["role"]> = {
  top: "top",
  jungle: "jungle",
  mid: "mid",
  adc: "bottom",
  bottom: "bottom",
  support: "support",
};

export const getVSFighters = cache(async function getVSFighters(): Promise<VSFighter[]> {
  const candidates: Omit<VSFighter, "clips">[] = [
    ...ROSTER_2026.map((r) => ({
      ign: r.ign,
      role: r.role,
      period: "Roster 2026",
      photo: PLAYER_PHOTOS[r.ign] ?? null,
      champion: null,
      current: true,
    })),
    ...ALUMNI.filter((a) => !ROSTER_2026.some((r) => r.ign.toLowerCase() === a.name.toLowerCase())).map((a) => ({
      ign: a.name,
      role: ROLE_OF[a.role] ?? null,
      period: a.period,
      photo: PLAYER_PHOTOS[a.name] ?? null,
      champion: a.signatureChampion ?? null,
      current: false,
    })),
  ];
  try {
    const sb = createCachedAnonSupabase(1800);
    const counts = await Promise.all(
      candidates.map(async (c) => {
        try {
          const { count, error } = await sb
            .from("kills")
            .select("id, killer:players!kills_killer_player_id_fkey!inner(ign)", { count: "exact", head: true })
            .eq("status", "published")
            .not("clip_url_vertical", "is", null)
            .eq("tracked_team_involvement", "team_killer")
            .not("kill_visible", "is", false)
            .ilike("killer.ign", c.ign);
          return error ? 0 : (count ?? 0);
        } catch (err) {
          rethrowIfDynamic(err);
          return 0;
        }
      }),
    );
    return candidates
      .map((c, i) => ({ ...c, clips: counts[i] }))
      .filter((f) => f.clips >= MIN_CLIPS)
      .sort((a, b) => Number(b.current) - Number(a.current) || (a.current ? 0 : b.clips - a.clips));
  } catch (err) {
    rethrowIfDynamic(err);
    return [];
  }
});
