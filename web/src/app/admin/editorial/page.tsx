/**
 * /admin/editorial — editorial command-center.
 *
 * Differs from /admin/featured (the per-day calendar picker) in two ways :
 *
 *   1. KILL-CENTRIC, not date-centric. We list the top KC kills of the
 *      last 14 days as cards. The editor scrolls through them and acts
 *      on each one with one click : pin to a date range, push to
 *      Discord, hide from public scroll.
 *   2. RANGE PINS, not single-day. featured_clips now carries
 *      valid_from / valid_to (migration 020) so a clip can stay pinned
 *      for a weekend, an event, etc. Kill-of-the-Week (Sunday auto)
 *      uses this same surface.
 *
 * Filter chips along the top let the editor narrow to what they're
 * curating right now ("today only", "score >= 8", etc.). Filters live
 * client-side on top of a single server fetch — no extra round-trips.
 *
 * SECURITY : the parent layout calls requireAdmin() ; this page just
 * inherits the gate. We DO NOT call requireAdmin() again here (it would
 * duplicate the cookie+session lookup on every render).
 */

import { adminPageDb } from "@/lib/admin/db";
import Link from "next/link";
import { EditorialBoard } from "./editorial-board";
import { FeaturedPicker } from "../featured/featured-picker";
import { loadFeaturedData } from "@/lib/admin/featured-data";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = {
  title: "Editorial — Admin",
  robots: { index: false, follow: false },
};

interface KillRow {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  ai_description: string | null;
  multi_kill: string | null;
  is_first_blood: boolean | null;
  kill_visible: boolean | null;
  created_at: string;
  tracked_team_involvement: string | null;
}

interface FeaturedRow {
  kill_id: string;
  valid_from: string | null;
  valid_to: string | null;
  set_by: string | null;
  custom_note: string | null;
}

interface EditorialActionRow {
  id: string;
  action: string;
  kill_id: string | null;
  performed_by: string | null;
  performed_at: string;
  payload: Record<string, unknown> | null;
}

export default async function EditorialPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const sb = await adminPageDb();
  // « 14 j » : les clips récents à mettre en avant ; « tout » : les plus forts
  // de tout le catalogue (utile quand le worker est à l'arrêt).
  const range = sp.range === "all" ? "all" : "14d";

  // 14-day lookback window — matches the curating cadence the editor
  // would scan during a typical session. Past 14d is plenty even for
  // a heavy LEC week (10 games × ~14 KC kills = 140 candidates).
  const now = new Date();
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Single round-trip per data source — let Supabase do the joins/filters
  // server-side so we ship minimal JSON.
  const [killsRes, featuredRes, actionsRes] = await Promise.all([
    sb
      .from("kills")
      .select("id,killer_champion,victim_champion,thumbnail_url,highlight_score,ai_description,multi_kill,is_first_blood,kill_visible,created_at,tracked_team_involvement")
      .eq("status", "published")
      .eq("tracked_team_involvement", "team_killer")
      .gte("created_at", range === "all" ? "1970-01-01" : cutoff)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .limit(120),

    sb
      .from("featured_clips")
      .select("kill_id,valid_from,valid_to,set_by,custom_note")
      .gte("valid_to", now.toISOString())
      .limit(50),

    sb
      .from("editorial_actions")
      .select("id,action,kill_id,performed_by,performed_at,payload")
      .order("performed_at", { ascending: false })
      .limit(20),
  ]);

  const kills = (killsRes.data ?? []) as unknown as KillRow[];
  const featured = (featuredRes.data ?? []) as FeaturedRow[];
  const actions = (actionsRes.data ?? []) as EditorialActionRow[];

  // Index featured by kill_id so the card knows whether it's already pinned.
  const featuredByKill = new Map<string, FeaturedRow>();
  for (const f of featured) {
    if (f.kill_id) featuredByKill.set(f.kill_id, f);
  }

  const cards = kills.map((k) => ({
    id: k.id,
    killerChampion: k.killer_champion ?? "?",
    victimChampion: k.victim_champion ?? "?",
    thumbnail: k.thumbnail_url,
    highlightScore: k.highlight_score,
    aiDescription: k.ai_description,
    multiKill: k.multi_kill,
    isFirstBlood: !!k.is_first_blood,
    isHidden: k.kill_visible === false,
    createdAt: k.created_at,
    pinnedFeature: featuredByKill.get(k.id) ?? null,
  }));

  const featuredData = await loadFeaturedData(sb);

  return (
    <div className="space-y-8">
      <section id="clip-du-jour" className="scroll-mt-20">
        <FeaturedPicker featured={featuredData.featured} topKills={featuredData.topKills} />
      </section>
      <section className="space-y-3">
        <nav className="flex gap-2 text-xs">
          {([["14d", "14 derniers jours"], ["all", "Tout le catalogue"]] as const).map(([id, label]) => (
            <Link
              key={id}
              href={`/admin/editorial?range=${id}`}
              className={`rounded-full border px-3 py-1 ${range === id ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)]"}`}
            >
              {label}
            </Link>
          ))}
          {range === "14d" && !cards.length && <span className="self-center text-[var(--text-muted)]">Aucun clip publié ces 14 jours : passe sur « Tout le catalogue ».</span>}
        </nav>
        <EditorialBoard cards={cards} actions={actions} />
      </section>
    </div>
  );
}
