"use client";

import Link from "next/link";
import { useState } from "react";

export interface ThemeOption {
  id: string;
  label: string;
  kicker: string;
  primary: string;
  accent: string;
  rival: string | null;
  when: string | null;
}

const DURATIONS = [
  { h: 6, label: "6 h" },
  { h: 24, label: "24 h" },
  { h: 72, label: "3 jours" },
  { h: 0, label: "jusqu'à nouvel ordre" },
];

export function ThemeControl({ options, forcedId, until, autoId, autoLabel }: { options: ThemeOption[]; forcedId: string | null; until: string | null; autoId: string; autoLabel: string }) {
  const [forced, setForced] = useState(forcedId && (!until || Date.parse(until) > Date.now()) ? forcedId : null);
  const [end, setEnd] = useState(until);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const set = async (id: string | null) => {
    setBusy(id ?? "auto");
    setMsg(null);
    const untilIso = id && hours ? new Date(Date.now() + hours * 3600e3).toISOString() : null;
    const r = await fetch("/api/admin/home-theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forceId: id, until: untilIso }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    if (r.ok) {
      setForced(id);
      setEnd(untilIso);
      setMsg({ text: id ? "Thème forcé. L'accueil est régénéré." : "Retour au choix automatique.", ok: true });
    } else setMsg({ text: d.error ?? `HTTP ${r.status}`, ok: false });
    setBusy(null);
  };

  const live = forced ?? autoId;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 text-xs">
        <span className="text-[var(--text-muted)]">En ce moment :</span>
        <strong className="text-[var(--gold)]">{options.find((o) => o.id === live)?.label ?? live}</strong>
        <span className="text-[var(--text-muted)]">
          {forced ? `forcé${end ? ` jusqu'au ${new Date(end).toLocaleString("fr-FR")}` : " jusqu'à nouvel ordre"}` : "choix automatique"}
        </span>
        {forced && (
          <button type="button" disabled={busy !== null} onClick={() => void set(null)} className="ml-auto rounded-md border border-[var(--border-gold)] px-3 py-1 text-[var(--text-secondary)] hover:text-[var(--gold)]">
            Revenir à l&apos;automatique ({autoLabel})
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)]">Durée d&apos;un forçage :</span>
        {DURATIONS.map((d) => (
          <button key={d.h} type="button" onClick={() => setHours(d.h)} className={`rounded-full border px-2.5 py-0.5 ${hours === d.h ? "border-[var(--gold)] text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-secondary)]"}`}>
            {d.label}
          </button>
        ))}
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{msg.text}</p>}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((o) => (
          <li key={o.id} className={`rounded-xl border bg-[var(--bg-surface)] p-3 ${o.id === live ? "border-[var(--gold)]" : "border-[var(--border-gold)]"}`}>
            <div className="flex items-center gap-1.5" aria-hidden>
              {[o.primary, o.accent, o.rival].filter(Boolean).map((c, i) => (
                <span key={i} className="h-3 w-7 rounded-full border border-white/10" style={{ background: c! }} />
              ))}
            </div>
            <p className="mt-2 font-display text-sm font-bold">{o.label}</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {o.kicker}
              {o.when ? ` · ${new Date(o.when).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy !== null || o.id === forced} onClick={() => void set(o.id)} className="rounded-md border border-[var(--gold)]/40 px-2.5 py-1 text-[11px] text-[var(--gold)] hover:bg-[var(--gold)]/10 disabled:opacity-40">
                {o.id === forced ? "Forcé" : busy === o.id ? "…" : "Forcer"}
              </button>
              <Link href={`/themes/${o.id}`} target="_blank" className="px-1 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--gold)]">
                Aperçu ↗
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
