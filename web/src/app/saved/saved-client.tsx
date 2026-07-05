"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { readLocalBookmarks, setBookmark } from "@/lib/bookmarks";
import { useT } from "@/lib/i18n/use-lang";

interface SavedKill {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  multi_kill: string | null;
  is_first_blood: boolean;
}

/**
 * Resolves the bookmark ids (DB when signed-in, localStorage
 * otherwise — Vague 1 keeps both in sync) into renderable cards via
 * the public /api/v1/kills?ids= endpoint added for this page.
 */
export function SavedClient() {
  const t = useT();
  const [ids, setIds] = useState<string[] | null>(null);
  const [kills, setKills] = useState<SavedKill[] | null>(null);
  const [isAnon, setIsAnon] = useState(false);

  // 1. Collect bookmark ids — server first, localStorage fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bookmarks", { credentials: "same-origin" });
        if (res.ok) {
          const body = (await res.json()) as { rows?: { kill_id: string }[] };
          if (!cancelled) setIds((body.rows ?? []).map((r) => r.kill_id));
          return;
        }
      } catch {
        /* offline — fall through to localStorage */
      }
      if (!cancelled) {
        setIsAnon(true);
        setIds([...readLocalBookmarks()].reverse());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Resolve ids → kill cards (published-only via RLS).
  useEffect(() => {
    if (ids == null) return;
    if (ids.length === 0) {
      setKills([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const chunk = ids.slice(0, 100).join(",");
        const res = await fetch(
          `/api/v1/kills?ids=${encodeURIComponent(chunk)}&limit=100&sort=created_at`,
        );
        const body = res.ok
          ? ((await res.json()) as { kills?: SavedKill[] })
          : { kills: [] };
        if (cancelled) return;
        // Preserve bookmark order (most recent save first).
        const byId = new Map((body.kills ?? []).map((k) => [k.id, k]));
        setKills(ids.map((id) => byId.get(id)).filter(Boolean) as SavedKill[]);
      } catch {
        if (!cancelled) setKills([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const remove = (killId: string) => {
    setBookmark(killId, false);
    setIds((prev) => (prev ? prev.filter((i) => i !== killId) : prev));
    setKills((prev) => (prev ? prev.filter((k) => k.id !== killId) : prev));
  };

  const skeletons = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);

  return (
    <div className="space-y-8">
      <header className="pt-4">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          KCKILLS
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">{t("p_saved.title")}</span>
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {t("p_saved.subtitle")}
        </p>
        {isAnon && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t("p_saved.anon_note")}{" "}
            <Link href="/login" className="text-[var(--gold)] hover:underline">
              Discord →
            </Link>
          </p>
        )}
      </header>

      {kills == null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {skeletons.map((i) => (
            <div
              key={i}
              className="aspect-[9/12] rounded-2xl bg-white/[0.04] animate-pulse"
            />
          ))}
        </div>
      ) : kills.length === 0 ? (
        <div className="rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-6 py-16 text-center">
          <p className="text-4xl mb-4" aria-hidden>
            🔖
          </p>
          <h2 className="font-display text-xl font-bold text-[var(--text-primary)]">
            {t("p_saved.empty_title")}
          </h2>
          <p className="mt-2 text-sm text-[var(--text-muted)] max-w-md mx-auto">
            {t("p_saved.empty_hint")}
          </p>
          <Link
            href="/scroll"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--gold)] px-6 py-3 font-display text-xs font-bold uppercase tracking-widest text-[var(--bg-primary)]"
          >
            {t("p_saved.goto_scroll")} →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {kills.map((k) => (
            <div key={k.id} className="group relative">
              <Link
                href={`/kill/${k.id}`}
                className="block overflow-hidden rounded-2xl border border-white/10 transition-all hover:border-[var(--gold)]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
              >
                <div className="relative aspect-[9/12] bg-[var(--bg-elevated)]">
                  {k.thumbnail_url && (
                    <Image
                      src={k.thumbnail_url}
                      alt={`${k.killer_champion ?? "?"} → ${k.victim_champion ?? "?"}`}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                  <div className="absolute inset-x-3 bottom-3">
                    <p className="text-xs font-bold text-white truncate">
                      {k.killer_champion} <span className="text-[var(--gold)]">→</span>{" "}
                      {k.victim_champion}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5">
                      {k.multi_kill && (
                        <span className="rounded bg-[var(--gold)]/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-[var(--gold)]">
                          {k.multi_kill}
                        </span>
                      )}
                      {k.is_first_blood && (
                        <span className="rounded bg-[var(--red)]/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-[var(--red)]">
                          FB
                        </span>
                      )}
                      {k.highlight_score != null && (
                        <span className="font-data text-[10px] text-white/60">
                          {k.highlight_score.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => remove(k.id)}
                aria-label={t("p_saved.remove")}
                className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/70 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--red)]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
