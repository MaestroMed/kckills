/**
 * Données des séries KC (kc_matches.json) — SERVER-ONLY.
 *
 * Le worker (modules/real_data_export.py) régénère le fichier après chaque
 * série et le publie sur R2 (`data/kc_matches.json`). On le relit ici toutes
 * les 30 min, sans redéploiement. Repli sur la copie du dépôt (figée au
 * 11/04/2026) si R2 ne répond pas ou renvoie un fichier vide.
 *
 * Types et helpers purs : lib/real-data.ts (importable côté client).
 */
import "server-only";
import { cache } from "react";
import embeddedJson from "@/data/kc_matches.json";
import type { RealData } from "@/lib/real-data";

const R2_BASE = (process.env.R2_PUBLIC_URL ?? process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "https://clips.kckills.com")
  .replace(/\/+$/, "");
const REAL_DATA_URL = `${R2_BASE}/data/kc_matches.json`;

const embedded = embeddedJson as unknown as RealData;

/** Copie du dépôt, sans réseau. */
export function loadEmbeddedRealData(): RealData {
  return embedded;
}

/** Fichier publié par le worker, relu toutes les 30 min (tag « real-data »). */
export const getRealData = cache(async (): Promise<RealData> => {
  try {
    const r = await fetch(REAL_DATA_URL, {
      next: { revalidate: 1800, tags: ["real-data"] },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = (await r.json()) as RealData;
      if (Array.isArray(d?.matches) && d.matches.length > 0) return d;
    }
  } catch {
    // R2 injoignable : on sert la copie du dépôt.
  }
  return embedded;
});
