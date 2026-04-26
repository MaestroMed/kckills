import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin/audit";
import type {
  GlobalSearchKill,
  GlobalSearchMatch,
  GlobalSearchJob,
  GlobalSearchUser,
  GlobalSearchResponse,
} from "@/app/api/admin/global-search/route";

/**
 * /admin/search?q=… — full results page for the topbar global search.
 *
 * Server-rendered. Calls the same /api/admin/global-search endpoint
 * the typeahead uses (no separate query path) so results stay
 * consistent. We pull more rows here (PER_ENTITY_LIMIT * 4) for the
 * dedicated page experience.
 *
 * Each entity section links into the relevant admin detail page :
 *   - kills    → /admin/clips/{id}
 *   - matches  → /admin/pipeline?match={external_id}
 *   - jobs     → /admin/pipeline/jobs/{id}
 *   - users    → /admin/audit?actor={label}
 *
 * Empty state offers an explicit hint about minimum query length.
 */
export const metadata: Metadata = {
  title: "Recherche globale — Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams?: Promise<{ q?: string; types?: string }>;
}

async function fetchResults(q: string, types?: string): Promise<GlobalSearchResponse | { error: string }> {
  // Internal fetch via absolute URL — Next 15 prefers an absolute URL
  // when calling our own API from a server component. We derive the
  // origin from the request headers so this works in dev / preview /
  // prod without a hard-coded URL.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const url = new URL(`${proto}://${host}/api/admin/global-search`);
  url.searchParams.set("q", q);
  if (types) url.searchParams.set("types", types);
  // Forward cookies so requireAdmin() in the route handler sees the
  // same session.
  const cookie = h.get("cookie") ?? "";
  const res = await fetch(url, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) {
    return { error: `Search failed (${res.status})` };
  }
  return (await res.json()) as GlobalSearchResponse;
}

export default async function AdminSearchPage({ searchParams }: SearchPageProps) {
  // Defence in depth — the layout already gates this, but per-page
  // requireAdmin() means the page can never accidentally render under
  // a misconfigured layout.
  const auth = await requireAdmin();
  if (!auth.ok) {
    return (
      <p className="text-sm text-[var(--red)]">
        Accès refusé : {auth.error}
      </p>
    );
  }

  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();
  const types = sp.types;

  if (q.length < 2) {
    return (
      <div className="space-y-6">
        <Header q="" />
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            Tapez au moins 2 caractères dans la barre de recherche en haut.
          </p>
          <p className="text-[11px] text-[var(--text-disabled)] mt-2">
            Vous pouvez chercher par ID, nom de champion, code de match, type de job…
          </p>
        </div>
      </div>
    );
  }

  const data = await fetchResults(q, types);
  if ("error" in data) {
    return (
      <div className="space-y-4">
        <Header q={q} />
        <p className="rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/10 px-4 py-3 text-sm text-[var(--red)]">
          {data.error}
        </p>
      </div>
    );
  }

  const total =
    data.kills.length + data.matches.length + data.jobs.length + data.users.length;

  return (
    <div className="space-y-6">
      <Header q={q} total={total} />

      {total === 0 ? (
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            Aucun résultat pour <span className="font-data text-[var(--gold)]">« {q} »</span>.
          </p>
          <p className="text-[11px] text-[var(--text-disabled)] mt-2">
            Essayez un ID partiel, un nom de champion ou un code de match.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          <KillsSection rows={data.kills} q={q} />
          <MatchesSection rows={data.matches} q={q} />
          <JobsSection rows={data.jobs} q={q} />
          <UsersSection rows={data.users} q={q} />
        </div>
      )}
    </div>
  );
}

function Header({ q, total }: { q: string; total?: number }) {
  return (
    <header className="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-black text-[var(--gold)]">
          Recherche globale
        </h1>
        {q ? (
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Résultats pour{" "}
            <span className="font-data text-[var(--text-secondary)]">« {q} »</span>
            {typeof total === "number" && (
              <>
                {" "}
                — {total} hit{total !== 1 ? "s" : ""}
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Cherchez à travers kills, matchs, jobs et utilisateurs admin.
          </p>
        )}
      </div>
    </header>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-display text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          {title}
        </h2>
        <span className="text-[10px] font-data text-[var(--text-disabled)]">
          {count} résultat{count !== 1 ? "s" : ""}
        </span>
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
          {empty}
        </p>
      ) : (
        <ul className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
          {children}
        </ul>
      )}
    </section>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[var(--gold)]/20 text-[var(--gold-bright)] px-0.5 rounded">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function Row({
  href,
  primary,
  secondary,
  badge,
}: {
  href: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--bg-elevated)]"
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[var(--text-primary)] truncate">{primary}</div>
          {secondary && (
            <div className="text-[10px] font-data text-[var(--text-muted)] truncate">
              {secondary}
            </div>
          )}
        </div>
        {badge && <span className="shrink-0">{badge}</span>}
      </Link>
    </li>
  );
}

function KillsSection({ rows, q }: { rows: GlobalSearchKill[]; q: string }) {
  return (
    <Section title="Kills" count={rows.length} empty="Aucun kill correspondant.">
      {rows.map((k) => (
        <Row
          key={k.id}
          href={`/admin/clips/${k.id}`}
          primary={
            <>
              <Highlight text={k.killer} q={q} />
              <span className="text-[var(--text-muted)]"> → </span>
              <Highlight text={k.victim} q={q} />
            </>
          }
          secondary={k.id}
          badge={
            <span className="rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
              kill
            </span>
          }
        />
      ))}
    </Section>
  );
}

function MatchesSection({ rows, q }: { rows: GlobalSearchMatch[]; q: string }) {
  return (
    <Section title="Matchs" count={rows.length} empty="Aucun match correspondant.">
      {rows.map((m) => (
        <Row
          key={m.id}
          href={`/admin/pipeline?match=${encodeURIComponent(m.external_id)}`}
          primary={<Highlight text={m.label} q={q} />}
          secondary={m.id}
          badge={
            <span className="rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
              match
            </span>
          }
        />
      ))}
    </Section>
  );
}

function JobsSection({ rows, q }: { rows: GlobalSearchJob[]; q: string }) {
  return (
    <Section title="Jobs pipeline" count={rows.length} empty="Aucun job correspondant.">
      {rows.map((j) => (
        <Row
          key={j.id}
          href={`/admin/pipeline/jobs/${j.id}`}
          primary={<Highlight text={j.type} q={q} />}
          secondary={j.id}
          badge={
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${
                j.status === "succeeded"
                  ? "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]"
                  : j.status === "failed"
                    ? "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]"
                    : j.status === "claimed"
                      ? "border-[var(--orange)]/40 bg-[var(--orange)]/10 text-[var(--orange)]"
                      : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-muted)]"
              }`}
            >
              {j.status}
            </span>
          }
        />
      ))}
    </Section>
  );
}

function UsersSection({ rows, q }: { rows: GlobalSearchUser[]; q: string }) {
  return (
    <Section
      title="Utilisateurs admin"
      count={rows.length}
      empty="Aucun utilisateur admin correspondant."
    >
      {rows.map((u) => (
        <Row
          key={u.id}
          href={`/admin/audit?actor=${encodeURIComponent(u.label)}`}
          primary={<Highlight text={u.label} q={q} />}
          secondary={`Voir l'historique des actions`}
          badge={
            <span className="rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
              user
            </span>
          }
        />
      ))}
    </Section>
  );
}
