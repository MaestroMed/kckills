"use client";

import Link from "next/link";
import { useState } from "react";
import type { DupKill, DupPair } from "@/lib/admin/duplicates";

const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

function Side({ k, onKeep, disabled }: { k: DupKill; onKeep: () => void; disabled: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 gap-3">
      <div className="relative aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-md bg-black">
        {k.clip_url_vertical ? (
          <video src={k.clip_url_vertical} poster={k.thumbnail_url ?? undefined} muted loop playsInline preload="none" className="h-full w-full object-cover" onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
        ) : null}
      </div>
      <div className="min-w-0 space-y-1 text-xs">
        <p className="font-bold">
          {k.killer_champion} → {k.victim_champion} <span className="font-data text-[var(--cyan)]">T+{mmss(k.game_time_seconds)}</span>
        </p>
        <p className="text-[var(--text-muted)]">
          source {k.data_source ?? "?"} · score {k.highlight_score ?? "—"} · {k.rating_count ?? 0} note(s) · {k.comment_count ?? 0} comm.
        </p>
        <p className="line-clamp-2 text-[11px] text-[var(--text-secondary)]">{k.ai_description}</p>
        <div className="flex gap-2 pt-1">
          <button type="button" disabled={disabled} onClick={onKeep} className="rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 px-2.5 py-1 text-[11px] font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20 disabled:opacity-40">
            Garder celui-ci
          </button>
          <Link href={`/admin/clips/${k.id}`} className="px-1 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--gold)]">fiche</Link>
        </div>
      </div>
    </div>
  );
}

export function DuplicateResolver({ pairs }: { pairs: DupPair[] }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (p: DupPair, body: Record<string, unknown>, label: string) => {
    setBusy(p.key);
    const r = await fetch("/api/admin/duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setDone((m) => ({ ...m, [p.key]: r.ok ? label : `Erreur : ${d.error ?? r.status}` }));
    setBusy(null);
  };

  if (!pairs.length) {
    return <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--green)]">Aucun doublon probable.</p>;
  }
  return (
    <ul className="space-y-3">
      {pairs.slice(0, 150).map((p) => (
        <li key={p.key} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            {p.match} · G{p.a.game_number} · {p.sameGame ? "même game" : "deux imports de la game"} · écart {p.dt} s
          </p>
          {done[p.key] ? (
            <p className="text-xs text-[var(--green)]">{done[p.key]}</p>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row">
              <Side k={p.a} disabled={busy !== null} onKeep={() => void send(p, { keep: p.a.id, drop: p.b.id }, "Gardé le premier, l'autre est retiré.")} />
              <Side k={p.b} disabled={busy !== null} onKeep={() => void send(p, { keep: p.b.id, drop: p.a.id }, "Gardé le second, l'autre est retiré.")} />
              <button type="button" disabled={busy !== null} onClick={() => void send(p, { ignore: [p.a.id, p.b.id] }, "Marqué « pas un doublon ».")} className="self-start rounded-md border border-[var(--border-gold)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--gold)] disabled:opacity-40">
                Pas un doublon
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
