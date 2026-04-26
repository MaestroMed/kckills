import type { Metadata } from "next";
import { getKillsForGrid, isDataOnlyKill } from "@/lib/supabase/kills";
import { loadRealData } from "@/lib/real-data";
import { JsonLd, clipsCollectionLD } from "@/lib/seo/jsonld";
import { getAssetMetadata, pickAssetUrl } from "@/lib/kill-assets";
import { ClipsGrid, type ClipCard, type InitialFilters } from "./clips-grid";

// 300s cache — /clips pulls 500 kills and filters client-side. The
// catalog doesn't churn per-minute; 5-min ISR is plenty.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Clips — KCKILLS",
  description:
    "Tous les clips Karmine Corp. Filtrer par joueur, équipe adverse, type de fight, multi-kills, first bloods. Mise à jour live.",
  alternates: { canonical: "/clips" },
  openGraph: {
    title: "Tous les clips KC — KCKILLS",
    description:
      "Catalogue complet des clips Karmine Corp en LEC. Filtrable, classable par score IA.",
    type: "website",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tous les clips KC — KCKILLS",
    description: "Catalogue complet. Filtre, trie, partage.",
  },
};

interface SearchParams {
  multi?: string;
  fb?: string;
  fight?: string;
  opp?: string;
  sort?: string;
  q?: string;
}

export default async function ClipsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  const initialFilters: InitialFilters = {
    multiKillsOnly: sp.multi === "1" || sp.multi === "true",
    firstBloodOnly: sp.fb === "1" || sp.fb === "true",
    fightType: sp.fight ?? null,
    opponent: sp.opp ?? null,
    sort: (sp.sort as InitialFilters["sort"]) ?? "recent",
    search: sp.q ?? "",
  };

  const [kills, data] = await Promise.all([
    // PR23 — getKillsForGrid pulls BOTH the published-with-clip rows
    // AND the data-only gol.gg historical rows (no clip but verified
    // killer/victim/champions/timestamp). The /scroll feed continues
    // to use getPublishedKills (clip-only) — only browse pages here
    // get the full 6-year catalog.
    getKillsForGrid(2000),
    Promise.resolve(loadRealData()),
  ]);

  // KC team_killer kills, visible (clip OR data-only). isDataOnlyKill
  // == kill_url_vertical is null → ClipsGrid renders a stats card
  // instead of a video card.
  const cards: ClipCard[] = kills
    .filter((k) => k.tracked_team_involvement === "team_killer" && k.kill_visible !== false)
    .map((k) => {
      const matchExt = k.games?.matches?.external_id;
      const matchJson = matchExt ? data.matches.find((m) => m.id === matchExt) : null;
      // Manifest-aware asset URLs (migration 026). Falls back to the
      // legacy thumbnail_url / clip_url_vertical_low columns on rows
      // that haven't been re-clipped through the new pipeline yet.
      const thumbnail = pickAssetUrl(k, "thumbnail");
      const thumbMeta = getAssetMetadata(k, "thumbnail");
      return {
        id: k.id,
        killerChampion: k.killer_champion ?? "?",
        victimChampion: k.victim_champion ?? "?",
        killerPlayerId: k.killer_player_id,
        thumbnail,
        thumbnailWidth: thumbMeta?.width ?? null,
        thumbnailHeight: thumbMeta?.height ?? null,
        clipVerticalLow: pickAssetUrl(k, "vertical_low"),
        highlightScore: k.highlight_score,
        avgRating: k.avg_rating,
        ratingCount: k.rating_count ?? 0,
        commentCount: k.comment_count ?? 0,
        impressionCount: k.impression_count ?? 0,
        aiDescription: k.ai_description,
        aiDescriptionFr: k.ai_description_fr,
        aiDescriptionEn: k.ai_description_en,
        aiDescriptionKo: k.ai_description_ko,
        aiDescriptionEs: k.ai_description_es,
        aiTags: k.ai_tags ?? [],
        multiKill: k.multi_kill,
        isFirstBlood: k.is_first_blood,
        fightType: k.fight_type,
        gameTimeSeconds: k.game_time_seconds ?? 0,
        gameNumber: k.games?.game_number ?? 1,
        matchStage: k.games?.matches?.stage ?? "LEC",
        matchDate: k.games?.matches?.scheduled_at ?? k.created_at,
        opponentCode: matchJson?.opponent.code ?? "LEC",
        opponentName: matchJson?.opponent.name ?? null,
        kcWon: matchJson?.kc_won ?? null,
        matchScore: matchJson ? `${matchJson.kc_score}-${matchJson.opp_score}` : null,
        createdAt: k.created_at,
        isDataOnly: isDataOnlyKill(k),
      };
    })
    // Default: chronological (most recent first by match date)
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""));

  // Schema.org payload for the catalog. Sample = first 20 cards (pre-filter)
  // so Google sees the same default ordering a fresh visitor would see,
  // and the numberOfItems reflects the full unfiltered count for honesty.
  const ld = clipsCollectionLD({
    totalCount: cards.length,
    sample: cards.slice(0, 20).map((c) => ({
      id: c.id,
      killer_champion: c.killerChampion,
      victim_champion: c.victimChampion,
      highlight_score: c.highlightScore,
      created_at: c.createdAt,
      thumbnail_url: c.thumbnail,
    })),
  });

  return (
    <>
      <JsonLd data={ld} />
      <ClipsGrid initialCards={cards} initialFilters={initialFilters} />
    </>
  );
}
