"use client";

import { useState } from "react";

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
}

interface Team {
  id: string;
  name: string;
  code: string;
  is_tracked: boolean;
}

const ROLES = ["top", "jungle", "mid", "bottom", "support"];

export function RosterEditor({ players: initial, teams }: { players: Player[]; teams: Team[] }) {
  const [players, setPlayers] = useState(initial);
  const [showAlumni, setShowAlumni] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = players.filter((p) => {
    if (!showAlumni && !p.isKc) return false;
    if (search.trim() && !p.ign.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Sort: KC first by role order, then alumni
  filtered.sort((a, b) => {
    if (a.isKc !== b.isKc) return a.isKc ? -1 : 1;
    const ra = ROLES.indexOf(a.role ?? "");
    const rb = ROLES.indexOf(b.role ?? "");
    if (ra !== rb) return ra - rb;
    return a.ign.localeCompare(b.ign);
  });

  const updatePlayer = async (id: string, patch: Partial<Player>) => {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    await fetch(`/api/admin/players/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">Roster</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {filtered.length} joueurs · {players.filter((p) => p.isKc).length} KC actuels · {players.filter((p) => !p.isKc).length} alumni
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ign..."
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs"
          />
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={showAlumni}
              onChange={(e) => setShowAlumni(e.target.checked)}
              className="accent-[var(--gold)]"
            />
            Show alumni
          </label>
        </div>
      </header>

      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2">Avatar</th>
              <th className="px-3 py-2">IGN</th>
              <th className="px-3 py-2">Real name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Nat</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 text-right">Kills</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-b border-[var(--border-gold)]/20">
                <td className="px-3 py-2">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.ign} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center text-[10px] font-bold text-[var(--text-muted)]">
                      {p.ign[0]}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-bold text-[var(--gold)]">{p.ign}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">
                  {editingId === p.id ? (
                    <input
                      type="text"
                      defaultValue={p.real_name ?? ""}
                      onBlur={(e) => updatePlayer(p.id, { real_name: e.target.value || null })}
                      className="bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-2 py-0.5 text-xs"
                    />
                  ) : (
                    p.real_name ?? "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {editingId === p.id ? (
                    <select
                      defaultValue={p.role ?? ""}
                      onChange={(e) => updatePlayer(p.id, { role: e.target.value || null })}
                      className="bg-[var(--bg-primary)] border border-[var(--gold)]/50 rounded px-1 py-0.5 text-xs"
                    >
                      <option value="">—</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className="font-mono text-[10px] uppercase">{p.role ?? "?"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">{p.nationality ?? "?"}</td>
                <td className="px-3 py-2">
                  {p.isKc ? (
                    <span className="rounded bg-[var(--gold)]/20 text-[var(--gold)] px-1.5 py-0.5 text-[9px] font-bold">KC</span>
                  ) : (
                    <span className="text-[var(--text-disabled)]">{p.teamCode ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--cyan)]">{p.killCount}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--gold)] text-xs"
                  >
                    {editingId === p.id ? "✓" : "✎"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
