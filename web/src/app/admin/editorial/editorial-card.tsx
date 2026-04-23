"use client";

/**
 * EditorialCard — one kill, three actions :
 *   ★ Pin     → opens an inline date-range form
 *   📣 Discord → posts a gold-accent embed to the configured webhook
 *   🚫 Hide    → toggles kill_visible (only for KC-killer kills)
 *
 * Each action is its own POST to a dedicated /api/admin/editorial/*
 * route. We don't bundle them server-side because the editor often
 * wants to do exactly one — bundling would force them to fill the
 * date range every time they want to push to Discord.
 *
 * Optimistic UI : the button shows a pending state immediately,
 * then either confirms or rolls back. We DON'T window.location.reload()
 * here — the parent EditorialBoard tracks server state via the latest
 * action timestamp, and the card's `pinnedFeature` / `isHidden` props
 * will refresh on the next navigation. Local state shows the change
 * until then.
 */

import { useState } from "react";
import Image from "next/image";

interface PinnedFeature {
  valid_from: string | null;
  valid_to: string | null;
  set_by: string | null;
  custom_note: string | null;
}

export interface EditorialCardProps {
  id: string;
  killerChampion: string;
  victimChampion: string;
  thumbnail: string | null;
  highlightScore: number | null;
  aiDescription: string | null;
  multiKill: string | null;
  isFirstBlood: boolean;
  isHidden: boolean;
  createdAt: string;
  pinnedFeature: PinnedFeature | null;
}

type PendingAction = "pin" | "discord" | "hide" | null;

function defaultRange(): { from: string; to: string } {
  // Default = today 00:00 UTC → +24h (one full day).
  // The editor edits these inputs before submitting if they want
  // a longer window (a weekend, an event, etc.).
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1000);
  // datetime-local format : YYYY-MM-DDTHH:mm
  const fmt = (d: Date) => d.toISOString().slice(0, 16);
  return { from: fmt(from), to: fmt(to) };
}

export function EditorialCard(props: EditorialCardProps) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [range, setRange] = useState(defaultRange());
  const [note, setNote] = useState("");

  const [localHidden, setLocalHidden] = useState(props.isHidden);
  const [localPinned, setLocalPinned] = useState<PinnedFeature | null>(props.pinnedFeature);
  const [discordPushedAt, setDiscordPushedAt] = useState<string | null>(null);

  const post = async (path: string, body: unknown) => {
    setError(null);
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      const msg = (data as { error?: string }).error ?? `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return r.json();
  };

  const handlePin = async () => {
    setPending("pin");
    try {
      const fromIso = new Date(range.from).toISOString();
      const toIso = new Date(range.to).toISOString();
      await post("/api/admin/editorial/feature", {
        kill_id: props.id,
        valid_from: fromIso,
        valid_to: toIso,
        custom_note: note || null,
      });
      setLocalPinned({ valid_from: fromIso, valid_to: toIso, set_by: "admin", custom_note: note || null });
      setPinOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(null);
    }
  };

  const handleDiscord = async () => {
    setPending("discord");
    try {
      await post("/api/admin/editorial/discord", { kill_id: props.id });
      setDiscordPushedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(null);
    }
  };

  const handleHideToggle = async () => {
    setPending("hide");
    const nextHidden = !localHidden;
    try {
      await post("/api/admin/editorial/hide", { kill_id: props.id, hide: nextHidden });
      setLocalHidden(nextHidden);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(null);
    }
  };

  const score = props.highlightScore;
  const scoreClass =
    score == null ? "text-[var(--text-muted)]"
    : score >= 9 ? "text-[var(--gold-bright)]"
    : score >= 7 ? "text-[var(--gold)]"
    : score >= 5 ? "text-[var(--text-secondary)]"
    : "text-[var(--text-muted)]";

  return (
    <div
      className={`relative rounded-lg border bg-[var(--bg-surface)] overflow-hidden transition-all ${
        localHidden
          ? "border-[var(--red)]/30 opacity-60"
          : localPinned
          ? "border-[var(--gold)]/40 shadow-[0_0_0_1px_var(--gold)]/20"
          : "border-[var(--border-gold)]"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-black">
        {props.thumbnail ? (
          <Image
            src={props.thumbnail}
            alt={`${props.killerChampion} → ${props.victimChampion}`}
            fill
            sizes="(max-width: 640px) 100vw, 33vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
            no thumbnail
          </div>
        )}
        {/* Overlays */}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          {props.multiKill && (
            <span className="rounded bg-[var(--red)]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
              {props.multiKill}
            </span>
          )}
          {props.isFirstBlood && (
            <span className="rounded bg-[var(--orange)]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
              FB
            </span>
          )}
          {localPinned && (
            <span className="rounded bg-[var(--gold)]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
              ★ pinned
            </span>
          )}
          {localHidden && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--red)]">
              hidden
            </span>
          )}
        </div>
        <div className={`absolute top-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-mono ${scoreClass}`}>
          {score != null ? score.toFixed(1) : "—"}
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        <div className="font-display text-sm font-bold text-[var(--text-primary)]">
          {props.killerChampion} <span className="text-[var(--text-muted)]">→</span> {props.victimChampion}
        </div>
        {props.aiDescription && (
          <p className="line-clamp-2 text-xs text-[var(--text-secondary)]">
            {props.aiDescription}
          </p>
        )}

        {/* Pin range editor (collapsible) */}
        {pinOpen && (
          <div className="rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] p-2 space-y-2">
            <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Du
              <input
                type="datetime-local"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className="mt-0.5 w-full rounded bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-gold)]"
              />
            </label>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Au
              <input
                type="datetime-local"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="mt-0.5 w-full rounded bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-gold)]"
              />
            </label>
            <input
              type="text"
              placeholder="Note éditeur (optionnel)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              className="w-full rounded bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-gold)]"
            />
            <div className="flex gap-2">
              <button
                onClick={handlePin}
                disabled={pending === "pin"}
                className="flex-1 rounded bg-[var(--gold)] px-2 py-1 text-xs font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
              >
                {pending === "pin" ? "…" : "Confirmer"}
              </button>
              <button
                onClick={() => setPinOpen(false)}
                className="rounded border border-[var(--border-gold)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Pinned summary */}
        {localPinned && !pinOpen && (
          <div className="rounded border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-2 py-1 text-[10px] text-[var(--gold)]">
            ★ {localPinned.valid_from?.slice(0, 10)} → {localPinned.valid_to?.slice(0, 10)}
            {localPinned.custom_note && (
              <div className="mt-0.5 text-[var(--text-secondary)]">{localPinned.custom_note}</div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={() => setPinOpen((v) => !v)}
            disabled={pending !== null}
            className="flex-1 rounded border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-2 py-1 text-[11px] font-medium text-[var(--gold)] hover:bg-[var(--gold)]/15 disabled:opacity-50"
            title="Pin avec date range"
          >
            ★ {localPinned ? "Modifier" : "Pin"}
          </button>
          <button
            onClick={handleDiscord}
            disabled={pending !== null}
            className="flex-1 rounded border border-[#5865F2]/30 bg-[#5865F2]/10 px-2 py-1 text-[11px] font-medium text-[#8B9DFF] hover:bg-[#5865F2]/20 disabled:opacity-50"
            title="Push Discord"
          >
            {pending === "discord" ? "…" : discordPushedAt ? "✓ pushed" : "📣 Discord"}
          </button>
          <button
            onClick={handleHideToggle}
            disabled={pending !== null}
            className={`flex-1 rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
              localHidden
                ? "border-[var(--green)]/30 bg-[var(--green)]/10 text-[var(--green)] hover:bg-[var(--green)]/20"
                : "border-[var(--red)]/30 bg-[var(--red)]/10 text-[var(--red)] hover:bg-[var(--red)]/20"
            }`}
            title={localHidden ? "Réafficher publiquement" : "Cacher du scroll public"}
          >
            {pending === "hide" ? "…" : localHidden ? "↶ Unhide" : "🚫 Hide"}
          </button>
        </div>

        {error && (
          <div className="rounded bg-[var(--red)]/10 px-2 py-1 text-[10px] text-[var(--red)]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
