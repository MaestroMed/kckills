import Link from "next/link";
import type { Metadata } from "next";
import { adminPageDb } from "@/lib/admin/db";
import { fetchAll } from "@/lib/admin/paginate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audience — Admin", robots: { index: false, follow: false } };

/**
 * /admin/audience — qui regarde quoi, sur 30 jours, à partir de user_events
 * (tracking first-party, sans cookie tiers). Visiteurs = anonymous_user_id
 * distincts. Les événements des pages admin et ceux écrits par un serveur
 * local avant le 16/10 (dev, e2e, captures) sont écartés au mieux : pages
 * /admin exclues ; depuis le 16/10, /api/track n'écrit plus qu'en prod.
 */
interface Ev {
  anonymous_user_id: string | null;
  session_id: string | null;
  event_type: string;
  entity_id: string | null;
  created_at: string;
  metadata: { page_path?: string } | null;
}

const TYPES = ["page.viewed", "feed.view", "clip.viewed", "clip.started", "clip.completed", "clip.shared", "clip.liked", "clip.rated"];
const DAYS = 30;

export default async function AudiencePage() {
  const sb = await adminPageDb();
  const since = new Date(Date.now() - DAYS * 86400e3).toISOString();
  const events = (
    await fetchAll<Ev>((from, to) =>
      sb
        .from("user_events")
        .select("anonymous_user_id, session_id, event_type, entity_id, created_at, metadata")
        .in("event_type", TYPES)
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(from, to),
    )
  ).filter((e) => !e.metadata?.page_path?.startsWith("/admin"));

  const days = new Map<string, { visitors: Set<string>; views: number }>();
  for (let i = DAYS - 1; i >= 0; i--) days.set(new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10), { visitors: new Set(), views: 0 });
  const firstSeen = new Map<string, string>();
  const sessions = new Map<string, number>();
  const clipViews = new Map<string, number>();
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
    const d = days.get(e.created_at.slice(0, 10));
    if (e.anonymous_user_id) {
      d?.visitors.add(e.anonymous_user_id);
      const f = firstSeen.get(e.anonymous_user_id);
      if (!f || e.created_at < f) firstSeen.set(e.anonymous_user_id, e.created_at);
    }
    if (e.event_type === "clip.viewed") {
      if (d) d.views++;
      if (e.session_id) sessions.set(e.session_id, (sessions.get(e.session_id) ?? 0) + 1);
      if (e.entity_id) clipViews.set(e.entity_id, (clipViews.get(e.entity_id) ?? 0) + 1);
    }
  }
  const series = [...days.entries()].map(([d, v]) => ({ d, visitors: v.visitors.size, views: v.views }));
  const maxV = Math.max(1, ...series.map((s) => s.visitors));
  const visitors = firstSeen.size;
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
  const activeWeek = new Set(events.filter((e) => e.created_at >= weekAgo && e.anonymous_user_id).map((e) => e.anonymous_user_id!));
  const returning = [...activeWeek].filter((id) => (firstSeen.get(id) ?? "") < weekAgo).length;
  const sessList = [...sessions.values()];
  const perSession = sessList.length ? sessList.reduce((a, b) => a + b, 0) / sessList.length : 0;
  const started = counts["clip.started"] ?? 0;
  const completed = counts["clip.completed"] ?? 0;

  const topIds = [...clipViews.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const { data: topKills } = topIds.length
    ? await sb.from("kills").select("id, killer_champion, victim_champion, thumbnail_url").in("id", topIds.map(([id]) => id))
    : { data: [] as { id: string; killer_champion: string | null; victim_champion: string | null; thumbnail_url: string | null }[] };
  const killById = new Map((topKills ?? []).map((k) => [k.id, k]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Audience</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          {DAYS} derniers jours, tracking du site (sans cookie tiers). Pages admin exclues ; jusqu&apos;au 16/10, des tests locaux écrivaient
          aussi ici et gonflent un peu les chiffres.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { k: "Visiteurs", v: visitors },
          { k: "Actifs 7 j", v: activeWeek.size, s: `${returning} déjà venus avant` },
          { k: "Clips vus", v: counts["clip.viewed"] ?? 0 },
          { k: "Clips par session", v: perSession.toFixed(1) },
          { k: "Vus jusqu'au bout", v: started ? `${Math.round((100 * completed) / started)} %` : "—", s: `${completed} / ${started} lancés` },
        ].map((t) => (
          <div key={t.k} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{t.k}</p>
            <p className="font-data text-xl font-bold tabular-nums">{typeof t.v === "number" ? t.v.toLocaleString("fr-FR") : t.v}</p>
            {t.s && <p className="text-[10px] text-[var(--text-muted)]">{t.s}</p>}
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">Visiteurs par jour</h2>
        <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`Visiteurs uniques par jour sur ${DAYS} jours, maximum ${maxV}`}>
          {series.map((s) => (
            <div key={s.d} className="relative h-full flex-1" title={`${s.d} : ${s.visitors} visiteurs, ${s.views} clips vus`}>
              <div className="absolute bottom-0 w-full rounded-t bg-[var(--cyan)]/70" style={{ height: `${(s.visitors / maxV) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between font-data text-[10px] text-[var(--text-muted)]">
          <span>{series[0].d}</span>
          <span>max {maxV} / jour</span>
          <span>{series[series.length - 1].d}</span>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">Clips les plus vus</h2>
        {topIds.length ? (
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topIds.map(([id, n], i) => {
              const k = killById.get(id);
              return (
                <li key={id} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-right font-data text-[var(--text-muted)]">{i + 1}</span>
                  {k?.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={k.thumbnail_url} alt="" className="h-10 w-[22px] rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="h-10 w-[22px] rounded bg-[var(--bg-elevated)]" />
                  )}
                  <Link href={`/admin/clips/${id}`} className="min-w-0 flex-1 truncate hover:text-[var(--gold)]">
                    {k ? `${k.killer_champion} → ${k.victim_champion}` : id.slice(0, 8)}
                  </Link>
                  <span className="font-data tabular-nums text-[var(--cyan)]">{n}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Aucune vue enregistrée.</p>
        )}
      </section>
    </div>
  );
}
