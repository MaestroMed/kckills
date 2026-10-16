"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bureau de revue : un clip à la fois, plein cadre, piloté au clavier.
 *
 *   J / ↓  suivant          K / ↑  précédent
 *   A      valider (QC humain OK, retire la marque re-clip)
 *   H      masquer du feed  U      réafficher
 *   R      à re-clipper     F      clip du jour
 *   M      son              Espace lecture / pause
 *
 * Après une action, on passe tout seul au clip suivant.
 */
type Queue = "reports" | "qc" | "reclip" | "recent";
const QUEUES: { id: Queue; label: string }[] = [
  { id: "reports", label: "Signalés" },
  { id: "qc", label: "QC humain" },
  { id: "reclip", label: "À re-clipper" },
  { id: "recent", label: "Derniers publiés" },
];

interface Item {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  game_time_seconds: number | null;
  highlight_score: number | null;
  ai_description: string | null;
  ai_tags: string[] | null;
  clip_url_vertical: string | null;
  clip_url_horizontal: string | null;
  thumbnail_url: string | null;
  kill_visible: boolean | null;
  needs_reclip: boolean | null;
  reclip_reason: string | null;
  qc_status: string | null;
  publication_status: string | null;
  multi_kill: string | null;
  is_first_blood: boolean | null;
  fight_type: string | null;
  killer: { ign: string } | null;
  victim: { ign: string } | null;
  games: { game_number: number; vod_offset_seconds: number | null; matches: { stage: string | null; scheduled_at: string | null } | null } | null;
}

type Act = "approve" | "hide" | "unhide" | "reclip" | "feature";

const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export function ReviewDesk() {
  const [queue, setQueue] = useState<Queue>("reports");
  const [counts, setCounts] = useState<Record<Queue, number> | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [i, setI] = useState(0);
  const [muted, setMuted] = useState(true);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const picked = useRef(false);
  const loadCounts = useCallback(async () => {
    const r = await fetch("/api/admin/review?counts=1", { cache: "no-store" });
    if (!r.ok) return;
    const c = (await r.json()) as Record<Queue, number>;
    setCounts(c);
    // À l'ouverture : la première file qui contient quelque chose.
    if (!picked.current) {
      picked.current = true;
      const first = QUEUES.find((q) => c[q.id] > 0);
      if (first) setQueue(first.id);
    }
  }, []);

  const load = useCallback(async (q: Queue, off: number) => {
    setError(null);
    const r = await fetch(`/api/admin/review?queue=${q}&offset=${off}`, { cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { items?: Item[]; count?: number | null; error?: string };
    if (!r.ok) return setError(d.error ?? `HTTP ${r.status}`);
    setItems(d.items ?? []);
    setTotal(d.count ?? null);
    setI(0);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadCounts();
      void load(queue, offset);
    }, 0);
    return () => window.clearTimeout(t);
  }, [queue, offset, load, loadCounts]);

  const item = items[i];

  const next = useCallback(() => {
    if (i < items.length - 1) setI(i + 1);
    else if (items.length && total !== null && offset + items.length < total) setOffset(offset + items.length);
  }, [i, items.length, total, offset]);
  const prev = useCallback(() => {
    if (i > 0) setI(i - 1);
    else if (offset > 0) setOffset(Math.max(0, offset - 30));
  }, [i, offset]);

  const act = useCallback(
    async (a: Act) => {
      if (!item || busy) return;
      setBusy(true);
      try {
        let r: Response;
        if (a === "approve") {
          r = await fetch("/api/admin/clips/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [item.id], action: "approve_qc" }),
          });
          if (r.ok && item.needs_reclip) {
            await fetch("/api/admin/clips/bulk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: [item.id], action: "clear_reclip" }),
            });
          }
        } else {
          const action = a === "unhide" ? "republish" : a;
          r = await fetch(`/api/admin/clips/${item.id}/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
        }
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        const labels: Record<Act, string> = { approve: "Validé", hide: "Masqué", unhide: "Réaffiché", reclip: "Marqué à re-clipper", feature: "Clip du jour" };
        setFlash({ text: r.ok ? labels[a] : `Erreur : ${d.error ?? r.status}`, ok: r.ok });
        if (r.ok) {
          setItems((list) =>
            list.map((x) =>
              x.id !== item.id ? x
              : a === "hide" ? { ...x, kill_visible: false }
              : a === "unhide" ? { ...x, kill_visible: true }
              : a === "reclip" ? { ...x, needs_reclip: true }
              : a === "approve" ? { ...x, qc_status: "passed", needs_reclip: false }
              : x,
            ),
          );
          window.setTimeout(next, 350);
        }
      } finally {
        setBusy(false);
        window.setTimeout(() => setFlash(null), 1600);
      }
    },
    [item, busy, next],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        j: next, arrowdown: next, k: prev, arrowup: prev,
        a: () => void act("approve"), h: () => void act("hide"), u: () => void act("unhide"),
        r: () => void act("reclip"), f: () => void act("feature"),
        m: () => setMuted((m) => !m),
        " ": () => {
          const v = videoRef.current;
          if (v) {
            if (v.paused) void v.play();
            else v.pause();
          }
        },
      };
      if (map[k]) {
        e.preventDefault();
        map[k]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, act]);

  const src = item?.clip_url_vertical ?? item?.clip_url_horizontal ?? undefined;
  const pos = total !== null && item ? `${(offset + i + 1).toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {QUEUES.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => {
              setQueue(q.id);
              setOffset(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs ${queue === q.id ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)]"}`}
          >
            {q.label}
            {counts && <span className="ml-1.5 font-data tabular-nums opacity-70">{counts[q.id].toLocaleString("fr-FR")}</span>}
          </button>
        ))}
        <span className="ml-auto font-data text-xs text-[var(--text-muted)]">{pos}</span>
      </div>

      {error && <p className="text-sm text-[var(--red)]">Lecture impossible : {error}</p>}
      {!error && items.length === 0 && (
        <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Rien dans cette file.
        </p>
      )}

      {item && (
        <div className="grid gap-5 md:grid-cols-[minmax(0,360px)_1fr]">
          <div className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black aspect-[9/16]">
            {src ? (
              <video
                key={item.id}
                ref={videoRef}
                src={src}
                poster={item.thumbnail_url ?? undefined}
                autoPlay
                loop
                playsInline
                muted={muted}
                controls
                className="h-full w-full object-contain"
              />
            ) : (
              <p className="grid h-full place-items-center text-xs text-[var(--text-muted)]">Pas de clip</p>
            )}
            {flash && (
              <span className={`absolute left-1/2 top-4 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-bold ${flash.ok ? "bg-[var(--green)] text-black" : "bg-[var(--red)] text-white"}`}>
                {flash.text}
              </span>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div>
              <p className="font-display text-xl font-bold">
                <span className="text-[var(--gold)]">{item.killer?.ign ?? "?"}</span> ({item.killer_champion ?? "?"})
                <span className="mx-2 text-[var(--text-muted)]">→</span>
                {item.victim?.ign ?? "?"} ({item.victim_champion ?? "?"})
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {item.games?.matches?.stage ?? "—"} · G{item.games?.game_number ?? "?"} · T+{mmss(item.game_time_seconds)}
                {item.games?.matches?.scheduled_at ? ` · ${new Date(item.games.matches.scheduled_at).toLocaleDateString("fr-FR")}` : ""}
                {item.games?.vod_offset_seconds == null ? " · offset VOD inconnu" : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-widest">
              {item.kill_visible === false && <span className="rounded bg-[var(--red)]/15 px-2 py-0.5 text-[var(--red)]">masqué</span>}
              {item.needs_reclip && <span className="rounded bg-[var(--orange)]/15 px-2 py-0.5 text-[var(--orange)]">re-clip{item.reclip_reason ? ` · ${item.reclip_reason}` : ""}</span>}
              {item.qc_status && <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text-secondary)]">qc {item.qc_status}</span>}
              {item.multi_kill && <span className="rounded bg-[var(--gold)]/15 px-2 py-0.5 text-[var(--gold)]">{item.multi_kill}</span>}
              {item.is_first_blood && <span className="rounded bg-[var(--gold)]/15 px-2 py-0.5 text-[var(--gold)]">first blood</span>}
              {item.highlight_score != null && <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text-secondary)]">score {item.highlight_score}</span>}
            </div>
            <p className="max-w-prose text-sm text-[var(--text-secondary)]">{item.ai_description ?? "Pas de description."}</p>

            <div className="grid max-w-md grid-cols-2 gap-2 sm:grid-cols-3">
              {([
                ["A", "Valider", "approve"],
                ["H", "Masquer", "hide"],
                ["U", "Réafficher", "unhide"],
                ["R", "Re-clip", "reclip"],
                ["F", "Clip du jour", "feature"],
              ] as const).map(([key, label, a]) => (
                <button
                  key={a}
                  type="button"
                  disabled={busy}
                  onClick={() => void act(a)}
                  className="flex items-center justify-between rounded-md border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--gold)]/50 hover:text-[var(--gold)] disabled:opacity-50"
                >
                  {label}
                  <kbd className="rounded bg-[var(--bg-elevated)] px-1.5 font-mono text-[10px] text-[var(--text-muted)]">{key}</kbd>
                </button>
              ))}
              <Link
                href={`/admin/clips/${item.id}`}
                className="flex items-center justify-between rounded-md border border-[var(--border-gold)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
              >
                Fiche complète <span aria-hidden>→</span>
              </Link>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              <kbd className="font-mono">J</kbd>/<kbd className="font-mono">K</kbd> suivant / précédent · <kbd className="font-mono">M</kbd> son ·{" "}
              <kbd className="font-mono">Espace</kbd> lecture
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
