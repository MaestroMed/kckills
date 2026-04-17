import { getActiveChannels, KC_YOUTUBE_CHANNELS } from "@/lib/youtube-channels";
import { fetchAllChannelVideos } from "@/lib/youtube-rss";
import { rankAndCap } from "@/lib/youtube-scoring";
import { getSeedVideos } from "@/lib/youtube-seed";
import { YouTubeParallaxCarousel } from "./YouTubeParallaxCarousel";

/**
 * Server component that builds the homepage YouTube parallax showcase.
 *
 * Pipeline:
 *   1. Fetch RSS for every channel in `youtube-channels.ts` that has a
 *      configured channelId. Failures from individual channels are
 *      silently dropped.
 *   2. Merge with the hand-curated seed list (`youtube-seed.ts`) so the
 *      carousel always has content even when channel IDs are missing or
 *      the network is flaky.
 *   3. Score every video (recency × channel weight × log views × KC
 *      keyword bonus) and keep the top 14.
 *   4. Hand off to the client carousel.
 *
 * Cached for 10 minutes via Next's `fetch` cache (set in `youtube-rss.ts`).
 */
export async function HomeYouTubeShowcase() {
  const liveChannels = getActiveChannels();
  const [rss, seed] = await Promise.all([
    fetchAllChannelVideos(liveChannels, 10),
    Promise.resolve(getSeedVideos()),
  ]);

  // RSS first so live wins on ties — but rank dedupe keeps the highest-
  // scoring duplicate either way.
  const ranked = rankAndCap([...rss, ...seed], 14);

  if (ranked.length === 0) return null;

  const liveCount = liveChannels.length;
  const totalChannels = KC_YOUTUBE_CHANNELS.length;

  return (
    <section className="relative py-16 md:py-24">
      <div className="px-4 md:px-8 max-w-7xl mx-auto mb-10 text-center">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-3">
          Chaînes YouTube de l&apos;écosystème KC
        </p>
        <h2 className="font-display text-4xl md:text-5xl font-black mb-4">
          <span className="text-shimmer">VIDEOS DU MOMENT</span>
        </h2>
        <p className="max-w-2xl mx-auto text-sm md:text-base text-white/65 leading-relaxed">
          Les derniers uploads des chaînes officielles, des fondateurs et
          des créateurs qui couvrent la KC. Mis à jour automatiquement,
          classés par fraîcheur et popularité.
        </p>
      </div>

      <YouTubeParallaxCarousel videos={ranked} />

      <p className="mt-10 text-center text-[10px] font-data uppercase tracking-[0.25em] text-white/35">
        {liveCount}/{totalChannels} chaînes connectées · Données YouTube RSS
      </p>
    </section>
  );
}
