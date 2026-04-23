import "server-only";
import Link from "next/link";
import Image from "next/image";
import { createServerSupabase } from "@/lib/supabase/server";

interface SimilarKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  ai_description_preview: string | null;
  similarity: number;
}

async function fetchSimilar(killId: string): Promise<SimilarKill[]> {
  try {
    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("fn_similar_kills", {
      target_id: killId,
      match_count: 6,
    });
    if (error) {
      console.warn("[SimilarClipsCarousel] rpc error:", error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      killer_champion: (row.killer_champion as string) ?? null,
      victim_champion: (row.victim_champion as string) ?? null,
      thumbnail_url: (row.thumbnail_url as string) ?? null,
      highlight_score:
        row.highlight_score == null ? null : Number(row.highlight_score),
      ai_description_preview:
        (row.ai_description_preview as string) ?? null,
      similarity: Number(row.similarity ?? 0),
    }));
  } catch (err) {
    console.warn("[SimilarClipsCarousel] threw:", err);
    return [];
  }
}

export async function SimilarClipsCarousel({ killId }: { killId: string }) {
  const similar = await fetchSimilar(killId);
  if (similar.length === 0) return null;

  return (
    <section className="max-w-6xl mx-auto px-6 py-14">
      <header className="flex items-end justify-between mb-6">
        <div>
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--cyan)]/70 mb-2">
            ▽ Similar moments
          </p>
          <h2 className="font-display text-2xl md:text-3xl font-black text-white">
            Same energy
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Powered by AI similarity
        </span>
      </header>

      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 scrollbar-thin scrollbar-thumb-[var(--cyan)]/30">
        {similar.map((sk) => (
          <Link
            key={sk.id}
            href={`/kill/${sk.id}`}
            className="snap-start shrink-0 w-56 rounded-xl overflow-hidden border border-[var(--border-gold)] bg-[var(--bg-surface)] hover:border-[var(--cyan)]/60 transition-all group"
          >
            <div className="relative aspect-video w-full bg-black overflow-hidden">
              {sk.thumbnail_url ? (
                <Image
                  src={sk.thumbnail_url}
                  alt={`${sk.killer_champion ?? "?"} → ${sk.victim_champion ?? "?"}`}
                  width={224}
                  height={126}
                  loading="lazy"
                  className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                />
              ) : (
                <div className="grid place-items-center h-full text-[var(--text-muted)] text-xs">
                  no clip
                </div>
              )}
              <span
                className="absolute bottom-2 left-2 rounded bg-black/70 backdrop-blur px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-wider text-[var(--cyan)]/90"
                title={`Cosine similarity: ${sk.similarity.toFixed(3)}`}
              >
                {Math.round(sk.similarity * 100)}% match
              </span>
              {sk.highlight_score != null && (
                <span className="absolute top-2 right-2 rounded bg-black/60 backdrop-blur px-1.5 py-0.5 font-data text-[10px] font-bold text-[var(--gold)]">
                  {sk.highlight_score.toFixed(1)}
                </span>
              )}
            </div>
            <div className="px-3 py-2.5">
              <p className="text-xs font-medium text-white truncate">
                {sk.killer_champion} → {sk.victim_champion}
              </p>
              {sk.ai_description_preview && (
                <p className="mt-1 text-[10px] text-[var(--text-muted)] line-clamp-2 italic">
                  {sk.ai_description_preview}
                  {sk.ai_description_preview.length >= 100 ? "…" : ""}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
