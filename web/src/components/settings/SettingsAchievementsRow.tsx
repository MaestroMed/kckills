"use client";

/**
 * "Mes badges" surface on the /settings page.
 *
 * Renders the user's earned badges as a row of icons. Click any icon →
 * deeplinks to /achievements?focus=<slug> so the user can read details
 * + see what they still have to unlock.
 *
 * Anon-safe : pulls from the new /api/achievements endpoint with the
 * BCC session hash. If the response is empty (new visitor, no badges),
 * we hide the row entirely so we don't pollute the panel.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { getBCCSessionHash } from "@/lib/bcc-state";
import {
  type AchievementRarity,
  type AchievementRow,
  RARITY_COLOR,
} from "@/lib/supabase/achievements-types";

export function SettingsAchievementsRow() {
  const [earned, setEarned] = useState<AchievementRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hash = getBCCSessionHash();
        const url = `/api/achievements${
          hash && hash.length >= 16 ? `?session=${encodeURIComponent(hash)}` : ""
        }`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { rows?: AchievementRow[] };
        if (cancelled) return;
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        setEarned(rows.filter((r) => Boolean(r.earned_at)));
      } catch {
        if (!cancelled) setEarned([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (earned === null) {
    return null; // initial load — render nothing rather than a skeleton
  }
  if (earned.length === 0) {
    return (
      <div>
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
          Mes badges
        </p>
        <Link
          href="/achievements"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)]"
        >
          Aucun badge encore. Voir le catalogue
          <span aria-hidden>{"→"}</span>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
          Mes badges ({earned.length})
        </p>
        <Link
          href="/achievements"
          className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--gold)]"
        >
          Voir tout
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {earned.slice(0, 18).map((badge) => (
          <BadgeIcon key={badge.slug} badge={badge} />
        ))}
      </div>
    </div>
  );
}

function BadgeIcon({ badge }: { badge: AchievementRow }) {
  const color = RARITY_COLOR[badge.rarity as AchievementRarity] ?? RARITY_COLOR.common;
  return (
    <Link
      href={`/achievements?focus=${encodeURIComponent(badge.slug)}`}
      title={`${badge.name} - ${badge.description}`}
      aria-label={`${badge.name} - ${badge.description}`}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-transform hover:scale-110 motion-reduce:hover:scale-100"
      style={{
        backgroundColor: `${color}1a`,
        border: `1px solid ${color}55`,
      }}
    >
      <span aria-hidden>{badge.icon}</span>
    </Link>
  );
}
