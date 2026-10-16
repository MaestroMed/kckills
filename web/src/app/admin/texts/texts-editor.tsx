"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * Descriptions des clips : corriger à la main (Ctrl+Entrée enregistre) ou
 * redemander l'analyse à Gemini — un par un ou toute la page d'un coup.
 */
type Tab = "provisional" | "missing" | "all";
interface Item {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  ai_description: string | null;
  thumbnail_url: string | null;
  highlight_score: number | null;
  game_time_seconds: number | null;
}

export function TextsEditor() {
  const [tab, setTab] = useState<Tab>("provisional");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [counts, setCounts] = useState<{ provisional: number; missing: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ tab, offset: String(offset) });
    if (tab === "all" && q) p.set("q", q);
    const r = await fetch(`/api/admin/texts?${p}`, { cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { items?: Item[]; count?: number; error?: string };
    if (!r.ok) return setMsg(d.error ?? `HTTP ${r.status}`);
    setItems(d.items ?? []);
    setCount(d.count ?? 0);
    setDrafts({});
    setState({});
  }, [tab, q, offset]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), tab === "all" ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, tab]);
  useEffect(() => {
    void fetch("/api/admin/texts?counts=1", { cache: "no-store" }).then(async (r) => r.ok && setCounts(await r.json()));
  }, []);

  const save = async (it: Item) => {
    const text = (drafts[it.id] ?? "").trim();
    if (!text || text === it.ai_description) return;
    setState((s) => ({ ...s, [it.id]: "…" }));
    const r = await fetch(`/api/kills/${it.id}/edit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_description: text }),
    });
    setState((s) => ({ ...s, [it.id]: r.ok ? "Enregistré" : "Échec" }));
    if (r.ok) setItems((list) => list.map((x) => (x.id === it.id ? { ...x, ai_description: text } : x)));
  };

  const regen = async (ids: string[]) => {
    setMsg(null);
    const r = await fetch("/api/admin/clips/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "mark_reanalyze" }),
    });
    const d = (await r.json().catch(() => ({}))) as { affected?: number; error?: string };
    setMsg(r.ok ? `${d.affected ?? 0} analyse(s) mise(s) en file : le worker les traitera à sa prochaine passe (quota Gemini du jour).` : `Erreur : ${d.error}`);
    if (r.ok) setState((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, "En file"])) }));
  };

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: "provisional", label: "Textes provisoires", n: counts?.provisional },
    { id: "missing", label: "Sans texte", n: counts?.missing },
    { id: "all", label: "Recherche" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setOffset(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs ${tab === t.id ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)]"}`}
          >
            {t.label} {t.n !== undefined && <span className="font-data tabular-nums opacity-70">{t.n.toLocaleString("fr-FR")}</span>}
          </button>
        ))}
        {tab === "all" && (
          <input
            id="texts-search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            placeholder="Mot dans la description…"
            className="w-60 rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
          />
        )}
        {items.length > 0 && (
          <button type="button" onClick={() => void regen(items.map((i) => i.id))} className="ml-auto rounded-md border border-[var(--cyan)]/40 px-3 py-1 text-xs text-[var(--cyan)] hover:bg-[var(--cyan)]/10">
            Ré-analyser les {items.length} de la page
          </button>
        )}
      </div>
      {msg && <p className="text-xs text-[var(--text-secondary)]">{msg}</p>}

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex gap-3 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
            {it.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.thumbnail_url} alt="" loading="lazy" className="h-20 w-[45px] shrink-0 rounded object-cover" />
            ) : (
              <span className="h-20 w-[45px] shrink-0 rounded bg-[var(--bg-elevated)]" />
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs">
                <span className="font-bold text-[var(--gold)]">{it.killer_champion}</span> → {it.victim_champion}
                <span className="ml-2 text-[var(--text-muted)]">score {it.highlight_score ?? "—"}</span>
                <Link href={`/admin/clips/${it.id}`} className="ml-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)]">fiche</Link>
              </p>
              <textarea
                id={`desc-${it.id}`}
                defaultValue={it.ai_description ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void save(it);
                  }
                }}
                rows={2}
                maxLength={240}
                className="w-full resize-y rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs leading-relaxed"
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void save(it)} disabled={!drafts[it.id] || drafts[it.id].trim() === it.ai_description} className="rounded-md border border-[var(--gold)]/40 px-2.5 py-1 text-[11px] text-[var(--gold)] disabled:opacity-30">
                  Enregistrer
                </button>
                <button type="button" onClick={() => void regen([it.id])} className="rounded-md border border-[var(--border-gold)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--cyan)]">
                  Redemander à Gemini
                </button>
                {state[it.id] && <span className="text-[11px] text-[var(--text-muted)]">{state[it.id]}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!items.length && <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">Rien ici.</p>}

      {count > items.length && (
        <div className="flex items-center gap-3 text-xs">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))} className="rounded-md border border-[var(--border-gold)] px-3 py-1 disabled:opacity-30">← Précédents</button>
          <span className="font-data text-[var(--text-muted)]">{offset + 1}–{offset + items.length} / {count.toLocaleString("fr-FR")}</span>
          <button type="button" disabled={offset + items.length >= count} onClick={() => setOffset(offset + 40)} className="rounded-md border border-[var(--border-gold)] px-3 py-1 disabled:opacity-30">Suivants →</button>
        </div>
      )}
    </div>
  );
}
