/**
 * Next KC match registry — hand-curated for now, future-ready for a worker
 * that polls `getSchedule` from lolesports.
 *
 * Each entry is a real upcoming Karmine Corp match. Add new ones here with
 * the official LoL Esports timestamps; the overlay picks the soonest one
 * whose `kickoffISO` is still in the future. Past entries are silently
 * skipped, so you can leave a few weeks of history in the file without
 * polluting the UI.
 *
 * When the worker LEC schedule poll lands, replace `getNextMatch()` with
 * a Supabase query against a `matches_upcoming` table and keep the same
 * return shape so the overlay stays untouched.
 */

export interface UpcomingMatch {
  /** ISO 8601 kickoff timestamp (UTC). */
  kickoffISO: string;
  /** Best-of format — "bo1", "bo3", "bo5". Drives the badge label. */
  format: "bo1" | "bo3" | "bo5";
  /** Opponent team three-letter code (uppercase). */
  opponentCode: string;
  /** Opponent display name. */
  opponentName: string;
  /** Tournament label (e.g. "LEC Spring 2026 · Week 4"). */
  stage: string;
  /** Optional: official VOD URL once it's known (post-match). */
  vodUrl?: string;
}

const UPCOMING: UpcomingMatch[] = [
  {
    kickoffISO: "2026-04-18T17:00:00Z",
    format: "bo3",
    opponentCode: "G2",
    opponentName: "G2 Esports",
    stage: "LEC Spring 2026 \u00b7 Playoffs Round 1",
  },
  {
    kickoffISO: "2026-04-25T17:00:00Z",
    format: "bo3",
    opponentCode: "FNC",
    opponentName: "Fnatic",
    stage: "LEC Spring 2026 \u00b7 Playoffs",
  },
  {
    kickoffISO: "2026-05-02T17:00:00Z",
    format: "bo5",
    opponentCode: "TBD",
    opponentName: "TBD",
    stage: "LEC Spring 2026 \u00b7 Finals",
  },
];

/**
 * Returns the next future match, or `null` if none of the configured
 * entries are still ahead of `now`.
 */
export function getNextMatch(now: Date = new Date()): UpcomingMatch | null {
  const t = now.getTime();
  for (const m of UPCOMING) {
    const kickoff = Date.parse(m.kickoffISO);
    if (Number.isFinite(kickoff) && kickoff > t) return m;
  }
  return null;
}

/**
 * Treats a match as "live" if we're within `windowHours` after kickoff.
 * Used by the overlay to flip from countdown to LIVE state without
 * pinging an API.
 */
export function getLiveMatch(now: Date = new Date(), windowHours = 4): UpcomingMatch | null {
  const t = now.getTime();
  const windowMs = windowHours * 60 * 60 * 1000;
  for (const m of UPCOMING) {
    const kickoff = Date.parse(m.kickoffISO);
    if (Number.isFinite(kickoff) && t >= kickoff && t <= kickoff + windowMs) {
      return m;
    }
  }
  return null;
}
