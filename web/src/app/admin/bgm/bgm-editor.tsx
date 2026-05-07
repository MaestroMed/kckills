"use client";

/**
 * BgmEditor — DEPRECATED legacy editor (PR-loltok EE).
 *
 * Kept around in read-only mode as historical reference. The new
 * surface is /admin/playlists (wolf floating player).
 *
 * In read-only mode (default when called from the legacy /admin/bgm
 * page) :
 *   - All inputs are disabled
 *   - Save button is hidden
 *   - Drag-and-drop reorder is disabled
 *   - A 5-second meta-refresh sends the browser to /admin/playlists
 *
 * In editable mode (legacy callers that pass readOnly={false}) the old
 * behaviour is preserved so existing flows don't break.
 */

import { useState, useEffect } from "react";
import Image from "next/image";
import type { BgmTrack } from "@/lib/scroll/bgm-playlist";

const GENRES: BgmTrack["genre"][] = [
  "synthwave",
  "trap",
  "edm",
  "dnb",
  "chill",
  "hype",
];

interface Props {
  initial: BgmTrack[];
  /** Read-only mode (default true on the deprecated /admin/bgm page). */
  readOnly?: boolean;
}

export function BgmEditor({ initial, readOnly = false }: Props) {
  const [tracks, setTracks] = useState<BgmTrack[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Native HTML5 drag-and-drop state.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [redirectIn, setRedirectIn] = useState<number>(5);

  // Add track form state (only used in editable mode)
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newArtist, setNewArtist] = useState("");
  const [newGenre, setNewGenre] = useState<BgmTrack["genre"]>("synthwave");

  // ─── Auto-redirect when read-only ────────────────────────────────────
  useEffect(() => {
    if (!readOnly) return;
    let remaining = 5;
    const tick = window.setInterval(() => {
      remaining -= 1;
      setRedirectIn(remaining);
      if (remaining <= 0) {
        window.clearInterval(tick);
        window.location.href = "/admin/playlists";
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [readOnly]);

  const extractYouTubeId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/, // raw ID
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  };

  const addTrack = () => {
    if (readOnly) return;
    const id = extractYouTubeId(newUrl.trim());
    if (!id) {
      setError("URL YouTube invalide");
      return;
    }
    if (!newTitle.trim() || !newArtist.trim()) {
      setError("Titre + artiste requis");
      return;
    }
    setTracks((prev) => [
      ...prev,
      {
        id: `track_${Date.now()}`,
        title: newTitle.trim(),
        artist: newArtist.trim(),
        youtubeId: id,
        durationSeconds: 200,
        genre: newGenre,
      },
    ]);
    setNewUrl("");
    setNewTitle("");
    setNewArtist("");
    setError(null);
  };

  const removeTrack = (id: string) => {
    if (readOnly) return;
    setTracks((prev) => prev.filter((t) => t.id !== id));
  };

  const moveUp = (idx: number) => {
    if (readOnly || idx === 0) return;
    setTracks((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    if (readOnly) return;
    setTracks((prev) => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const moveTo = (from: number, to: number) => {
    if (readOnly || from === to || from < 0) return;
    setTracks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const adjusted = to > from ? to - 1 : to;
      next.splice(adjusted, 0, moved);
      return next;
    });
  };

  const save = async () => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch("/api/bgm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tracks),
      });
      if (r.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await r.json();
        setError(data.error ?? "Erreur");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`space-y-6 max-w-3xl ${readOnly ? "opacity-80 pointer-events-auto" : ""}`}
      aria-label={
        readOnly
          ? "Éditeur BGM en lecture seule (déprécié)"
          : "Éditeur BGM"
      }
    >
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-black text-[var(--gold)]">
            BGM Playlist legacy
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {tracks.length} tracks · NCS / royalty-free
            {readOnly && (
              <span className="ml-2 text-[var(--orange)]">
                (lecture seule · redirection dans {redirectIn}s)
              </span>
            )}
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
          >
            {saving ? "Sauvegarde..." : saved ? "✓ Sauvegardé" : "Sauvegarder"}
          </button>
        )}
      </header>

      {error && (
        <p className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-3 py-2 text-xs text-[var(--red)]">
          {error}
        </p>
      )}

      {/* Tracks list */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
        {tracks.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">
            Aucun track.
          </p>
        ) : (
          tracks.map((track, idx) => {
            const isDragging = dragIdx === idx;
            const showDropAbove =
              dropIdx === idx && dragIdx !== null && dragIdx !== idx;
            return (
              <div
                key={track.id}
                draggable={!readOnly}
                onDragStart={
                  readOnly
                    ? undefined
                    : (e) => {
                        setDragIdx(idx);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }
                }
                onDragEnd={
                  readOnly
                    ? undefined
                    : () => {
                        setDragIdx(null);
                        setDropIdx(null);
                      }
                }
                onDragOver={
                  readOnly
                    ? undefined
                    : (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const rect = e.currentTarget.getBoundingClientRect();
                        const above = e.clientY - rect.top < rect.height / 2;
                        setDropIdx(above ? idx : idx + 1);
                      }
                }
                onDrop={
                  readOnly
                    ? undefined
                    : (e) => {
                        e.preventDefault();
                        if (dragIdx !== null && dropIdx !== null)
                          moveTo(dragIdx, dropIdx);
                        setDragIdx(null);
                        setDropIdx(null);
                      }
                }
                className={`p-3 flex items-center gap-3 ${readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing"} transition-all relative ${
                  isDragging ? "opacity-30" : ""
                }`}
              >
                {showDropAbove && (
                  <div className="absolute -top-px left-0 right-0 h-0.5 bg-[var(--gold)] z-10 shadow-[0_0_8px_var(--gold)]" />
                )}
                <span
                  aria-hidden
                  className="text-[var(--text-muted)] text-lg select-none leading-none"
                  title="Glisser pour réordonner"
                >
                  ⋮⋮
                </span>
                {!readOnly && (
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] disabled:opacity-20"
                      title="Monter"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveDown(idx)}
                      disabled={idx === tracks.length - 1}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] disabled:opacity-20"
                      title="Descendre"
                    >
                      ▼
                    </button>
                  </div>
                )}
                <span className="font-mono text-xs text-[var(--text-muted)] w-6">
                  {idx + 1}.
                </span>
                <Image
                  src={`https://img.youtube.com/vi/${track.youtubeId}/default.jpg`}
                  alt=""
                  width={64}
                  height={48}
                  className="h-12 w-16 rounded object-cover pointer-events-none"
                />
                <div className="flex-1 min-w-0 pointer-events-none">
                  <p className="font-bold text-sm truncate">{track.title}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {track.artist} ·{" "}
                    <span className="font-mono">{track.youtubeId}</span> ·{" "}
                    {track.genre}
                  </p>
                </div>
                <a
                  href={`https://www.youtube.com/watch?v=${track.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--cyan)] hover:underline"
                  draggable={false}
                  onClick={(e) => e.stopPropagation()}
                >
                  YouTube
                </a>
                {!readOnly && (
                  <button
                    onClick={() => removeTrack(track.id)}
                    className="text-xs text-[var(--red)] hover:opacity-80 px-2"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Add track — hidden in read-only mode */}
      {!readOnly && (
        <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 space-y-3">
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Ajouter un track
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="URL YouTube ou ID (11 chars)"
              className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono"
            />
            <select
              value={newGenre}
              onChange={(e) =>
                setNewGenre(e.target.value as BgmTrack["genre"])
              }
              className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Titre (ex: Phoenix)"
              className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={newArtist}
              onChange={(e) => setNewArtist(e.target.value)}
              placeholder="Artiste (ex: Netrum & Halvorsen)"
              className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={addTrack}
            className="rounded-lg border border-[var(--gold)] px-4 py-2 text-sm font-bold text-[var(--gold)] hover:bg-[var(--gold)]/10"
          >
            + Ajouter
          </button>
        </section>
      )}

      <div className="rounded-lg border border-[var(--orange)]/30 bg-[var(--orange)]/5 p-3 text-xs text-[var(--text-muted)]">
        <p className="font-bold text-[var(--orange)] mb-1">
          ⚠ Statut BGM Player
        </p>
        <p>
          Le player legacy est désactivé temporairement (CSP bloque l&apos;URL
          Invidious). Pour le réactiver : héberger les MP3 sur R2
          (clips.kckills.com est CSP-allowed) OU autoriser inv.nadeko.net
          dans le CSP. Cette interface n&apos;est plus utilisée — bascule
          sur{" "}
          <a
            href="/admin/playlists"
            className="text-[var(--gold)] underline"
          >
            /admin/playlists
          </a>
          .
        </p>
      </div>
    </div>
  );
}
