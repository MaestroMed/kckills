"use client";

import { useState } from "react";

interface Profile {
  id: string;
  discord_username: string | null;
  discord_avatar_url: string | null;
  riot_summoner_name: string | null;
  total_ratings: number | null;
  total_comments: number | null;
  created_at: string;
  last_seen_at: string | null;
}

/** Une ligne de /admin/users : export JSON et effacement (pseudo à recopier pour confirmer). */
export function UserRow({ profile: p }: { profile: Profile }) {
  const [erasing, setErasing] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<string | null>(null);
  const name = p.discord_username ?? p.id.slice(0, 8);

  const erase = async () => {
    setState("…");
    const r = await fetch(`/api/admin/users/${p.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setState(r.ok ? "Compte effacé." : d.error ?? `HTTP ${r.status}`);
    if (r.ok) setErasing(false);
  };

  return (
    <tr className="border-t border-[var(--border-subtle)] align-top">
      <td className="px-3 py-2">
        <span className="font-bold">{name}</span>
        {p.riot_summoner_name && <span className="ml-1 text-[var(--text-muted)]">· {p.riot_summoner_name}</span>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-[var(--text-muted)]">{new Date(p.created_at).toLocaleDateString("fr-FR")}</td>
      <td className="px-3 py-2 whitespace-nowrap text-[var(--text-muted)]">{p.last_seen_at ? new Date(p.last_seen_at).toLocaleDateString("fr-FR") : "—"}</td>
      <td className="px-3 py-2 text-right font-data tabular-nums">{p.total_ratings ?? 0}</td>
      <td className="px-3 py-2 text-right font-data tabular-nums">{p.total_comments ?? 0}</td>
      <td className="px-3 py-2">
        {state === "Compte effacé." ? (
          <span className="text-[var(--text-muted)]">Compte effacé.</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/admin/users/${p.id}`} className="rounded-md border border-[var(--border-gold)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--gold)]">
              Exporter
            </a>
            {erasing ? (
              <>
                <input
                  id={`erase-${p.id}`}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={`Recopie « ${name} »`}
                  className="w-40 rounded-md border border-[var(--red)]/40 bg-[var(--bg-primary)] px-2 py-0.5 text-[11px]"
                />
                <button type="button" onClick={() => void erase()} disabled={confirm !== name} className="rounded-md border border-[var(--red)] bg-[var(--red)]/15 px-2 py-0.5 text-[11px] text-[var(--red)] disabled:opacity-40">
                  Effacer définitivement
                </button>
                <button type="button" onClick={() => setErasing(false)} className="text-[11px] text-[var(--text-muted)]">Annuler</button>
              </>
            ) : (
              <button type="button" onClick={() => setErasing(true)} className="rounded-md border border-[var(--red)]/40 px-2 py-0.5 text-[11px] text-[var(--red)] hover:bg-[var(--red)]/10">
                Effacer le compte
              </button>
            )}
            {state && <span className="text-[11px] text-[var(--text-muted)]">{state}</span>}
          </div>
        )}
      </td>
    </tr>
  );
}
