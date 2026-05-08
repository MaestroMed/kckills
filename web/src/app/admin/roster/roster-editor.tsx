"use client";

/**
 * Roster editor (PR-loltok ED).
 *
 * Migrated to Agent EA's primitives. Adds :
 *   - 5 KC player cards on top with avatar / IGN / role / nat / kill
 *     count / win-rate / KDA → click to drill into player detail.
 *   - "Edit roster" toggle that opens per-player forms : IGN / role
 *     / nationality / image_url / display_order.
 *   - Toast on save.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminBreadcrumbs } from "@/components/admin/ui/AdminBreadcrumbs";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminEmptyState } from "@/components/admin/ui/AdminEmptyState";
import { AdminSection } from "@/components/admin/ui/AdminSection";
import { patchPlayer } from "./actions";

interface Player {
  id: string;
  ign: string;
  real_name: string | null;
  role: string | null;
  nationality: string | null;
  image_url: string | null;
  team_id: string | null;
  external_id: string | null;
  teamCode: string | null;
  teamName: string | null;
  isKc: boolean;
  killCount: number;
  // Optional extra stats — not always provided by the server query;
  // we tolerate undefined so the page stays sturdy if upstream changes.
  display_order?: number | null;
  deathCount?: number | null;
  assistCount?: number | null;
  winRate?: number | null;
}

interface Team {
  id: string;
  name: string;
  code: string;
  is_tracked: boolean;
}

const ROLES = ["top", "jungle", "mid", "bottom", "support"];
const ROLE_LABELS: Record<string, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  bottom: "ADC",
  support: "Support",
};

interface ToastMsg {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

export function RosterEditor({
  players: initial,
  teams,
}: {
  players: Player[];
  teams: Team[];
}) {
  const [players, setPlayers] = useState(initial);
  const [showAlumni, setShowAlumni] = useState(false);
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [, startTransition] = useTransition();

  const pushToast = (text: string, tone: ToastMsg["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  };

  const filtered = useMemo(() => {
    return players
      .filter((p) => {
        if (!showAlumni && !p.isKc) return false;
        if (search.trim() && !p.ign.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.isKc !== b.isKc) return a.isKc ? -1 : 1;
        const ra = ROLES.indexOf(a.role ?? "");
        const rb = ROLES.indexOf(b.role ?? "");
        if (ra !== rb) return ra - rb;
        return a.ign.localeCompare(b.ign);
      });
  }, [players, showAlumni, search]);

  const kcPlayers = useMemo(
    () =>
      players
        .filter((p) => p.isKc)
        .sort((a, b) => ROLES.indexOf(a.role ?? "") - ROLES.indexOf(b.role ?? "")),
    [players],
  );

  const updatePlayer = (id: string, patch: Partial<Player>) => {
    const previous = players.find((p) => p.id === id);
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    startTransition(async () => {
      try {
        const result = await patchPlayer(id, patch as Parameters<typeof patchPlayer>[1]);
        if (result.ok) {
          pushToast(`${previous?.ign ?? id} mis à jour.`);
        } else {
          pushToast(`Erreur : ${result.error ?? "inconnue"}`, "error");
          if (previous) {
            setPlayers((prev) => prev.map((p) => (p.id === id ? previous : p)));
          }
        }
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Erreur action", "error");
        if (previous) {
          setPlayers((prev) => prev.map((p) => (p.id === id ? previous : p)));
        }
      }
    });
  };

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  return (
    <div className="space-y-5">
      <AdminBreadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Roster" }]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Roster
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {filtered.length} joueur(s) · {kcPlayers.length} KC actuels ·{" "}
            {players.filter((p) => !p.isKc).length} alumni
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un IGN…"
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs"
            aria-label="Recherche IGN"
          />
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={showAlumni}
              onChange={(e) => setShowAlumni(e.target.checked)}
              className="accent-[var(--gold)]"
            />
            Alumni
          </label>
          <AdminButton
            variant={editMode ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              setEditMode((v) => !v);
              if (editMode) setEditingId(null);
            }}
          >
            {editMode ? "Quitter l'édition" : "Éditer"}
          </AdminButton>
        </div>
      </header>

      {/* KC starting 5 — quick-glance cards */}
      <AdminSection
        title="KC — 5 titulaires"
        subtitle="Clic pour ouvrir la fiche complète."
      >
        {kcPlayers.length === 0 ? (
          <AdminCard variant="default">
            <AdminEmptyState
              icon="●"
              title="Aucun joueur KC marqué comme tracked"
              body="Vérifie la table teams.is_tracked."
              compact
            />
          </AdminCard>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {kcPlayers.map((p) => (
              <PlayerCard key={p.id} player={p} />
            ))}
          </div>
        )}
      </AdminSection>

      {/* Full roster table */}
      <AdminSection
        title="Roster complet"
        subtitle={editMode ? "Mode édition actif." : "Lecture seule."}
      >
        <AdminCard variant="dense">
          {filtered.length === 0 ? (
            <AdminEmptyState
              icon="◎"
              title="Aucun joueur"
              body="Ajuste la recherche ou affiche les alumni."
              compact
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 w-12">Avatar</th>
                  <th className="px-3 py-2">IGN</th>
                  <th className="px-3 py-2">Nom</th>
                  <th className="px-3 py-2 w-20">Role</th>
                  <th className="px-3 py-2 w-16">Nat</th>
                  <th className="px-3 py-2 w-20">Team</th>
                  <th className="px-3 py-2 w-16">Ordre</th>
                  <th className="px-3 py-2 w-16 text-right">Kills</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const isEditing = editMode && editingId === p.id;
                  return (
                    <tr key={p.id} className="border-b border-[var(--border-gold)]/20">
                      <td className="px-3 py-2">
                        {p.image_url ? (
                          <Image
                            src={p.image_url}
                            alt={p.ign}
                            width={32}
                            height={32}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center text-[10px] font-bold text-[var(--text-muted)]">
                            {p.ign[0]}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-bold text-[var(--gold)]">
                        {isEditing ? (
                          <input
                            type="text"
                            defaultValue={p.ign}
                            onBlur={(e) =>
                              e.target.value !== p.ign &&
                              updatePlayer(p.id, { ign: e.target.value })
                            }
                            className="bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-2 py-0.5 text-xs"
                          />
                        ) : (
                          <Link
                            href={`/player/${encodeURIComponent(p.ign.toLowerCase())}`}
                            className="hover:underline"
                          >
                            {p.ign}
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {isEditing ? (
                          <input
                            type="text"
                            defaultValue={p.real_name ?? ""}
                            onBlur={(e) =>
                              updatePlayer(p.id, { real_name: e.target.value || null })
                            }
                            className="bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-2 py-0.5 text-xs"
                          />
                        ) : (
                          (p.real_name ?? "—")
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select
                            defaultValue={p.role ?? ""}
                            onChange={(e) =>
                              updatePlayer(p.id, { role: e.target.value || null })
                            }
                            className="bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-1 py-0.5 text-xs"
                          >
                            <option value="">—</option>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono text-[10px] uppercase">
                            {p.role ?? "?"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isEditing ? (
                          <input
                            type="text"
                            maxLength={3}
                            defaultValue={p.nationality ?? ""}
                            onBlur={(e) =>
                              updatePlayer(p.id, {
                                nationality: e.target.value || null,
                              })
                            }
                            className="w-12 bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-1 py-0.5 text-xs text-center"
                          />
                        ) : (
                          <span className="text-sm">{p.nationality ?? "?"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {p.isKc ? (
                          <AdminBadge variant="pending" size="sm">
                            KC
                          </AdminBadge>
                        ) : (
                          <span className="text-[var(--text-disabled)]">
                            {p.teamCode ?? teamMap.get(p.team_id ?? "")?.code ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            max={99}
                            defaultValue={p.display_order ?? 0}
                            onBlur={(e) =>
                              updatePlayer(p.id, {
                                display_order: Number(e.target.value),
                              })
                            }
                            className="w-12 bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-1 py-0.5 text-xs"
                          />
                        ) : (
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">
                            {p.display_order ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--cyan)]">
                        {p.killCount}
                      </td>
                      <td className="px-3 py-2 flex items-center gap-1">
                        {editMode && (
                          <button
                            onClick={() => setEditingId(isEditing ? null : p.id)}
                            className="text-[var(--text-muted)] hover:text-[var(--gold)] text-xs"
                            title={isEditing ? "Fermer" : "Éditer cette ligne"}
                          >
                            {isEditing ? "✓" : "✎"}
                          </button>
                        )}
                        {editMode && isEditing && (
                          <input
                            type="text"
                            placeholder="image url"
                            defaultValue={p.image_url ?? ""}
                            onBlur={(e) =>
                              updatePlayer(p.id, { image_url: e.target.value || null })
                            }
                            className="bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-2 py-0.5 text-[10px] w-24"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </AdminCard>
      </AdminSection>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg px-4 py-2 text-xs font-medium shadow-lg backdrop-blur-md ${
                t.tone === "success"
                  ? "bg-[var(--green)]/90 text-black"
                  : t.tone === "error"
                    ? "bg-[var(--red)]/90 text-white"
                    : "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-gold)]"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerCard({ player }: { player: Player }) {
  const kda =
    player.killCount > 0 || (player.assistCount ?? 0) > 0
      ? `${player.killCount}/${player.deathCount ?? 0}/${player.assistCount ?? 0}`
      : null;
  return (
    <Link
      href={`/player/${encodeURIComponent(player.ign.toLowerCase())}`}
      className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 hover:border-[var(--gold)]/60 transition-colors block"
    >
      <div className="flex items-center gap-3">
        {player.image_url ? (
          <Image
            src={player.image_url}
            alt={player.ign}
            width={48}
            height={48}
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <div className="h-12 w-12 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center text-base font-black text-[var(--gold)]">
            {player.ign[0]}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-[var(--gold)] truncate">
              {player.ign}
            </h3>
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {player.role ? ROLE_LABELS[player.role] ?? player.role : "?"}
            </span>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] truncate">
            {player.real_name ?? "—"} {player.nationality ? `· ${player.nationality}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 text-[10px] text-[var(--text-muted)]">
        <div>
          <p className="uppercase tracking-widest text-[9px]">Kills</p>
          <p className="font-mono text-sm text-[var(--cyan)]">{player.killCount}</p>
        </div>
        <div>
          <p className="uppercase tracking-widest text-[9px]">Win rate</p>
          <p className="font-mono text-sm text-[var(--green)]">
            {player.winRate != null ? `${(player.winRate * 100).toFixed(0)}%` : "—"}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-widest text-[9px]">KDA</p>
          <p className="font-mono text-sm text-[var(--gold)]">{kda ?? "—"}</p>
        </div>
      </div>
    </Link>
  );
}
