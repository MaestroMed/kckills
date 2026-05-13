/**
 * /live — dedicated live-match feed page.
 *
 * Server shell that :
 *   1. Resolves the current live match via getCurrentLiveMatch()
 *   2. If no match is live → redirects to /scroll with a query param
 *      so the destination can show a toast "no live match"
 *   3. Otherwise renders <LiveScroll /> which polls the same
 *      /api/live/state endpoint as the global LiveHotNow banner
 *
 * Why this can't be statically rendered :
 *   * the live-match identity is by definition transient (changes
 *     every match day)
 *   * the recent-kills list is a write-heavy resource updated mid-match
 *
 * Hence `dynamic = 'force-dynamic'`. We DO accept a tiny CDN cache via
 * the /api/live/state endpoint's `revalidate = 10` so visitor pileups
 * during a match still go to the CDN, not all the way down to Supabase.
 */

import { redirect } from "next/navigation";
import {
  getCurrentLiveMatch,
  getLiveMatchScore,
  getRecentLiveKills,
  type LiveMatchRow,
  type LiveKillRow,
} from "@/lib/supabase/live";
import { LiveScroll } from "./LiveScroll";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "KC Live — kills en direct · KCKILLS",
  description:
    "Les kills de Karmine Corp en direct pendant le match LEC. Clips, score live, et notifs push.",
  alternates: { canonical: "/live" },
  robots: { index: false, follow: true },
  openGraph: {
    title: "KC Live — kills en direct",
    description: "Suis le match KC kill par kill, en temps réel.",
    type: "website" as const,
    url: "/live",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
};

export default async function LivePage() {
  const liveMatch = await getCurrentLiveMatch();

  if (!liveMatch) {
    // Soft redirect to /scroll. The query param flags the destination
    // so it can pop a toast — without that, the user just lands on the
    // global feed without knowing why they were sent there.
    redirect("/scroll?from=live&reason=no-match");
  }

  // SSR the first chunk so the LCP isn't a spinner. The client will
  // take over polling from here.
  const [recentKills, score]: [LiveKillRow[], { kc: number; opp: number }] =
    await Promise.all([
      getRecentLiveKills(liveMatch.id, { limit: 30 }),
      getLiveMatchScore(liveMatch.id),
    ]);

  return (
    <LiveScroll
      initialMatch={liveMatch as LiveMatchRow}
      initialKills={recentKills}
      initialScore={score}
    />
  );
}
