"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Calage d'une game : la VOD YouTube intégrée, chaque kill cliquable pour
 * sauter à son instant présumé (offset + chrono − 5 s), et la saisie de
 * l'offset. Méthode : cliquer un kill, regarder le chrono à l'écran,
 * corriger l'offset de l'écart, vérifier sur un 2e kill, enregistrer,
 * puis marquer les clips à re-clipper.
 */
export interface CalibKill {
  id: string;
  game_time_seconds: number | null;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  kill_visible: boolean | null;
  needs_reclip: boolean | null;
  publication_status: string | null;
  status: string | null;
  tracked_team_involvement: string | null;
  multi_kill: string | null;
}

const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** « 1:02:03 », « 34:10 » ou « 2049 » → secondes. */
function parseTime(v: string): number | null {
  const parts = v.trim().split(":").map((p) => Number(p));
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function GameCalibrator({ gameId, vodId, offset, kills }: { gameId: string; vodId: string | null; offset: number | null; kills: CalibKill[] }) {
  const [vod, setVod] = useState(vodId ?? "");
  const [offsetText, setOffsetText] = useState(offset ? String(offset) : "");
  const [start, setStart] = useState<number>(offset ?? 0);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);

  const off = parseTime(offsetText);
  const jump = (k: CalibKill) => {
    if (off == null || k.game_time_seconds == null) return;
    setStart(Math.max(0, off + k.game_time_seconds - 5));
  };

  const post = async (body: Record<string, unknown>, okText: (d: Record<string, unknown>) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/games/${gameId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (r.status === 409) setForce(true);
      setMsg({ text: r.ok ? okText(d) : d.error ?? `HTTP ${r.status}`, ok: r.ok });
    } finally {
      setBusy(false);
    }
  };

  const visible = kills.filter((k) => k.kill_visible && k.clip_url_vertical).length;
  const toReclip = kills.filter((k) => k.needs_reclip).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black">
          {vod.length === 11 ? (
            <iframe
              key={`${vod}-${start}`}
              src={`https://www.youtube-nocookie.com/embed/${vod}?start=${start}&autoplay=1&mute=1`}
              title="VOD de la game"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          ) : (
            <p className="grid h-full place-items-center text-xs text-[var(--text-muted)]">Aucune VOD YouTube.</p>
          )}
        </div>

        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (off == null) return setMsg({ text: "Offset illisible (ex. 2049 ou 34:09)", ok: false });
            void post({ action: "set_vod", vod_youtube_id: vod, vod_offset_seconds: off, force }, () => {
              setForce(false);
              return `Enregistré : ${vod} @ ${off} s. Marque maintenant les clips à re-clipper.`;
            });
          }}
        >
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            VOD YouTube
            <input id="vod-id" value={vod} onChange={(e) => setVod(e.target.value.trim())} className="w-36 rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-[var(--text-primary)]" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Début de la game (offset)
            <input id="vod-offset" value={offsetText} onChange={(e) => setOffsetText(e.target.value)} placeholder="2049 ou 34:09" className="w-32 rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-[var(--text-primary)]" />
          </label>
          <span className="pb-2 font-data text-[11px] text-[var(--text-muted)]">{off != null ? `${off} s` : ""}</span>
          <button type="button" onClick={() => off != null && setStart(off)} className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)]">
            Voir le début
          </button>
          <button type="submit" disabled={busy} className="rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/15 px-3 py-1.5 text-xs font-bold text-[var(--gold)] disabled:opacity-50">
            {force ? "Enregistrer quand même" : "Enregistrer l'offset"}
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void post({ action: "reclip_all" }, (d) => `${d.affected ?? 0} clip(s) marqué(s) à re-clipper.`)} className="rounded-md border border-[var(--orange)]/40 px-3 py-1.5 text-xs text-[var(--orange)] hover:bg-[var(--orange)]/10 disabled:opacity-50">
            Marquer les {kills.filter((k) => k.clip_url_vertical).length} clips à re-clipper
          </button>
          <button type="button" disabled={busy} onClick={() => void post({ action: "hide_all" }, (d) => `${d.affected ?? 0} clip(s) retiré(s) du feed.`)} className="rounded-md border border-[var(--red)]/40 px-3 py-1.5 text-xs text-[var(--red)] hover:bg-[var(--red)]/10 disabled:opacity-50">
            Retirer les clips du feed (mauvaise VOD)
          </button>
          <button type="button" disabled={busy} onClick={() => void post({ action: "show_all" }, (d) => `${d.affected ?? 0} clip(s) remis en ligne.`)} className="rounded-md border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--gold)] disabled:opacity-50">
            Remettre en ligne
          </button>
        </div>
        {msg && <p className={`text-xs ${msg.ok ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{msg.text}</p>}
        <p className="text-[11px] text-[var(--text-muted)]">
          {visible} clip(s) en ligne · {toReclip} à re-clipper. Méthode : clique un kill, lis le chrono à l&apos;écran, corrige l&apos;offset de
          l&apos;écart, vérifie sur un 2e kill, enregistre.
        </p>
      </div>

      <ol className="max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-2">
        {kills.map((k) => (
          <li key={k.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-elevated)]">
            <button type="button" onClick={() => jump(k)} className="w-12 shrink-0 text-left font-data text-xs tabular-nums text-[var(--cyan)] hover:underline" title="Voir dans la VOD">
              {mmss(k.game_time_seconds)}
            </button>
            {k.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={k.thumbnail_url} alt="" className="h-10 w-[22px] shrink-0 rounded object-cover" loading="lazy" />
            ) : (
              <span className="h-10 w-[22px] shrink-0 rounded bg-[var(--bg-elevated)]" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs">
              <span className={k.tracked_team_involvement === "team_killer" ? "text-[var(--gold)]" : ""}>{k.killer_champion ?? "?"}</span>
              <span className="text-[var(--text-muted)]"> → </span>
              {k.victim_champion ?? "?"}
              {k.multi_kill && <span className="ml-1 text-[10px] text-[var(--gold)]">{k.multi_kill}</span>}
            </span>
            {k.kill_visible === false && <span className="text-[10px] text-[var(--red)]">masqué</span>}
            {k.needs_reclip && <span className="text-[10px] text-[var(--orange)]">re-clip</span>}
            <Link href={`/admin/clips/${k.id}`} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)]">fiche</Link>
          </li>
        ))}
        {!kills.length && <li className="p-3 text-xs text-[var(--text-muted)]">Aucun kill pour cette game.</li>}
      </ol>
    </div>
  );
}
