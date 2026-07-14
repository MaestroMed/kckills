/**
 * /admin/ledger — Clip Ledger (décryptage audit, Wave 41).
 *
 * One row per canonical kill from the `clip_ledger` mega-table (migration
 * 088), joined to kills/games/vod_sources/publication-gates via the
 * `v_clip_ledger_full` view. This is the "audit a kill end-to-end" surface:
 * resolved offset + confidence + method, multi-kill hierarchy (absorbed
 * count), QC verdict, asset health (needs_reclip + reasons), duplicate link,
 * and publishability — all in one place.
 *
 * The view is security_invoker (RLS on clip_ledger has no anon policy), so we
 * read through the service-role client (server-only, admin-gated page), with
 * an anon fallback if the key isn't provisioned (degrades to empty, no crash).
 */

import Link from "next/link";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { AdminPage, AdminBadge } from "@/components/admin/ui";
import type { AdminBadgeVariant } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Clip Ledger — Admin",
  robots: { index: false, follow: false },
};

const ROW_LIMIT = 200;
const LOW_CONFIDENCE = 0.75;

type FilterId =
  | "all"
  | "needs_reclip"
  | "low_confidence"
  | "duplicates"
  | "needs_review"
  | "multikill";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "needs_reclip", label: "À re-clipper" },
  { id: "low_confidence", label: "Offset douteux" },
  { id: "multikill", label: "Multi-kills" },
  { id: "duplicates", label: "Doublons" },
  { id: "needs_review", label: "Needs review" },
];

interface AssetCheck {
  needs_reclip?: boolean;
  reasons?: string[];
}

interface LedgerRow {
  ledger_id: string;
  kill_id: string | null;
  game_external_id: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  multi_kill: string | null;
  multi_kill_tier: number | null;
  absorbed_count: number | null;
  resolved_offset_seconds: number | null;
  offset_confidence: number | null;
  offset_method: string | null;
  vod_source_type: string | null;
  qc_verdict: string | null;
  qc_pass_count: number | null;
  asset_check: AssetCheck | null;
  is_duplicate_of: string | null;
  kill_status: string | null;
  has_vertical_url: boolean | null;
  has_horizontal_url: boolean | null;
  is_publishable: boolean | null;
  updated_at: string | null;
}

function confidenceBadge(c: number | null): { variant: AdminBadgeVariant; label: string } {
  if (c == null) return { variant: "neutral", label: "—" };
  const pct = `${Math.round(c * 100)}%`;
  if (c >= 0.85) return { variant: "success", label: pct };
  if (c >= LOW_CONFIDENCE) return { variant: "pending", label: pct };
  return { variant: "danger", label: pct };
}

function qcBadge(v: string | null): AdminBadgeVariant {
  if (v === "pass") return "success";
  if (v === "reject" || v === "needs_review") return "danger";
  return "neutral";
}

function statusBadge(s: string | null): AdminBadgeVariant {
  switch (s) {
    case "published":
      return "success";
    case "needs_review":
      return "warn";
    case "clip_error":
    case "manual_review":
      return "danger";
    case "duplicate":
      return "neutral";
    default:
      return "info";
  }
}

function fmtOffset(s: number | null): string {
  if (s == null) return "—";
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(Math.round(s));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.id === sp.filter)?.id ?? "all") as FilterId;

  const sb = createServiceSupabase() ?? (await createServerSupabase());

  let query = sb
    .from("v_clip_ledger_full")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(ROW_LIMIT);

  switch (filter) {
    case "needs_reclip":
      query = query.eq("asset_check->>needs_reclip", "true");
      break;
    case "low_confidence":
      query = query.lt("offset_confidence", LOW_CONFIDENCE);
      break;
    case "duplicates":
      query = query.not("is_duplicate_of", "is", null);
      break;
    case "needs_review":
      query = query.eq("kill_status", "needs_review");
      break;
    case "multikill":
      query = query.gte("multi_kill_tier", 2);
      break;
  }

  const { data, error } = await query;
  const rows = (data ?? []) as LedgerRow[];

  return (
    <AdminPage
      title="Clip Ledger"
      subtitle="Décryptage end-to-end : offset · QC · assets · doublons · publication"
    >
      {/* Filter chips (server-safe Links — preserve the audit workflow via URL) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <Link
              key={f.id}
              href={f.id === "all" ? "/admin/ledger" : `/admin/ledger?filter=${f.id}`}
              className={`rounded-full border px-3 py-1.5 font-data text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                active
                  ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]"
                  : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <span className="ml-auto self-center font-data text-[11px] text-[var(--text-muted)]">
          {rows.length}{rows.length === ROW_LIMIT ? "+" : ""} lignes
        </span>
      </div>

      {error ? (
        <div className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-4 py-3 text-sm text-[var(--red)]">
          Erreur de lecture du ledger : {error.message}. (La vue
          v_clip_ledger_full est security_invoker — vérifie que
          SUPABASE_SERVICE_ROLE_KEY est provisionnée.)
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          Aucune ligne pour ce filtre.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-gold)]">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-gold)] bg-[var(--bg-surface)] font-data text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                <th className="px-3 py-2.5">Kill</th>
                <th className="px-3 py-2.5">Matchup</th>
                <th className="px-3 py-2.5">Multi</th>
                <th className="px-3 py-2.5">Offset</th>
                <th className="px-3 py-2.5">QC</th>
                <th className="px-3 py-2.5">Assets</th>
                <th className="px-3 py-2.5">Statut</th>
                <th className="px-3 py-2.5">Pub</th>
                <th className="px-3 py-2.5">MAJ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const conf = confidenceBadge(r.offset_confidence);
                const reclip = r.asset_check?.needs_reclip === true;
                const reasons = r.asset_check?.reasons ?? [];
                return (
                  <tr
                    key={r.ledger_id}
                    className="border-b border-[var(--border-subtle)] align-top hover:bg-[var(--bg-elevated)]/40"
                  >
                    <td className="px-3 py-2.5 font-data text-[11px]">
                      {r.kill_id ? (
                        <Link
                          href={`/admin/clips/${r.kill_id}`}
                          className="text-[var(--cyan)] hover:underline"
                          title={r.kill_id}
                        >
                          {r.kill_id.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {r.game_external_id ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[var(--text-primary)]">
                        {r.killer_champion ?? "?"}
                      </span>
                      <span className="text-[var(--text-muted)]"> → </span>
                      <span className="text-[var(--text-secondary)]">
                        {r.victim_champion ?? "?"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.multi_kill ? (
                        <AdminBadge variant="info" size="sm">
                          {r.multi_kill}
                          {(r.absorbed_count ?? 0) > 0 ? ` ·${r.absorbed_count}` : ""}
                        </AdminBadge>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <AdminBadge variant={conf.variant} size="sm" title={r.offset_method ?? undefined}>
                        {conf.label}
                      </AdminBadge>
                      <span className="ml-1.5 font-data text-[11px] text-[var(--text-muted)]">
                        {fmtOffset(r.resolved_offset_seconds)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <AdminBadge variant={qcBadge(r.qc_verdict)} size="sm">
                        {r.qc_verdict ?? "—"}
                        {r.qc_pass_count != null ? ` ${r.qc_pass_count}` : ""}
                      </AdminBadge>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-data text-[11px]">
                      {reclip ? (
                        <AdminBadge
                          variant="danger"
                          size="sm"
                          title={reasons.join(", ")}
                        >
                          re-clip{reasons.length ? ` (${reasons.length})` : ""}
                        </AdminBadge>
                      ) : (
                        <span className="text-[var(--text-muted)]">
                          {r.has_horizontal_url ? "H" : "·"}
                          {r.has_vertical_url ? "V" : "·"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <AdminBadge variant={statusBadge(r.kill_status)} size="sm">
                        {r.kill_status ?? "—"}
                      </AdminBadge>
                      {r.is_duplicate_of ? (
                        <Link
                          href={`/admin/clips/${r.is_duplicate_of}`}
                          className="ml-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--cyan)]"
                          title={`Doublon de ${r.is_duplicate_of}`}
                        >
                          ⧉
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.is_publishable ? (
                        <AdminBadge variant="success" size="sm">
                          ✓
                        </AdminBadge>
                      ) : (
                        <AdminBadge variant="neutral" size="sm">
                          ✗
                        </AdminBadge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-data text-[11px] text-[var(--text-muted)]">
                      {r.updated_at ? r.updated_at.slice(0, 16).replace("T", " ") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminPage>
  );
}
