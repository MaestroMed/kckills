import type { Metadata } from "next";
import { getPublishedKills } from "@/lib/supabase/kills";
import { SphereSceneClient } from "@/components/sphere/SphereSceneClient";
import type { SphereTile } from "@/components/sphere/SphereScene";

export const revalidate = 600;
export const metadata: Metadata = {
  title: "Sphere — Mode Immersif",
  description:
    "Mode experimental : 360 kills KC dans une sphere 3D navigable. Drag pour orbiter, scroll pour zoomer, click pour ouvrir.",
  alternates: { canonical: "/sphere" },
  robots: {
    // Experimental mode — keep out of Google index until validated.
    // The vertical /scroll feed remains the canonical SEO surface.
    index: false,
    follow: true,
  },
  openGraph: {
    title: "Sphere — Mode Immersif KCKILLS",
    description: "Experiment de navigation 3D pour le pilote KC.",
    type: "website",
  },
};

const HUE_BY_PLAYER: Record<string, number> = {
  // Stable colour banding per KC roster — keeps clusters readable at
  // distance even when thumbnails haven't loaded yet.
  Canna: 200,    // blue
  Yike: 130,     // emerald
  kyeahoo: 290,  // purple
  Caliste: 45,   // gold
  Busio: 0,      // red
};

function hueForKill(killerName: string | null | undefined): number {
  if (!killerName) return 220;
  return HUE_BY_PLAYER[killerName] ?? 220;
}

export default async function SpherePage() {
  // Pull a generous slice — the sphere only feels alive past ~50 tiles.
  // Cap at 200 so the WebGL scene stays under the V0 perf budget.
  const all = await getPublishedKills(200);
  const eligible = all.filter(
    (k) => !!k.thumbnail_url && k.kill_visible !== false,
  );

  // Map each kill to a SphereTile. Player IGN lookup happens via the
  // kill's killer_player_id — we don't have it on the kill row directly,
  // so we'll color-band by killer_champion as a proxy. Phase 1 will
  // upgrade to real player banding via a join.
  const tiles: SphereTile[] = eligible.map((k) => ({
    id: k.id,
    thumbnailUrl: k.thumbnail_url,
    killerChampion: k.killer_champion,
    victimChampion: k.victim_champion,
    highlightScore: k.highlight_score,
    multiKill: k.multi_kill,
    tagX: k.game_minute_bucket,
    tagY: k.killer_player_id,
    hue: hueForKill(k.killer_champion),
  }));

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ═══ HERO STRIP — keeps the page Google-friendly even though the
          canvas itself is invisible to crawlers ═══ */}
      <header className="relative z-10 mx-auto max-w-5xl px-6 pt-10 pb-6 text-center">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          Mode immersif · experimental
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-black mb-3">
          <span className="text-shimmer">SPHERE 360</span>
        </h1>
        <p className="text-sm md:text-base text-white/70 max-w-2xl mx-auto leading-relaxed">
          {tiles.length} kills KC distribues sur une sphere navigable. Drag pour orbiter,
          scroll pour zoomer, click sur une vignette pour l&apos;ouvrir. Mode experimental V0 —
          version finale prevue avec algorithme semantique par direction.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap text-[10px] font-data uppercase tracking-widest text-white/45">
          <span>Drag : orbite</span>
          <span className="text-white/20">·</span>
          <span>Scroll : zoom</span>
          <span className="text-white/20">·</span>
          <span>Click : ouvrir le kill</span>
        </div>
      </header>

      {/* ═══ SPHERE CANVAS ═══ */}
      <div className="relative" style={{ height: "calc(100vh - 220px)", minHeight: 500 }}>
        <SphereSceneClient tiles={tiles} cameraZ={0} />
      </div>

      {/* Discrete legend — colour banding per killer champion family */}
      <div className="relative z-10 mx-auto max-w-5xl px-6 py-6 text-center">
        <p className="font-data text-[9px] uppercase tracking-[0.3em] text-white/35">
          Roster KC actif &middot; banding couleur par joueur (proxy par champion en V0)
        </p>
      </div>
    </div>
  );
}
