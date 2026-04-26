"use client";

/**
 * HeroVideosEditor — admin curator for the homepage hero rotation.
 *
 * Sections (top → bottom) :
 *   1. Drag-and-drop upload zone (or "Choisir un fichier" on mobile)
 *      + title / context / tag fields → Upload button
 *   2. List of registered hero videos as cards :
 *        • thumbnail (poster or first frame)
 *        • title + context inline edit
 *        • duration / volume / tag inline edit
 *        • order arrows (↑ / ↓)
 *        • delete button (with R2 cleanup)
 *   3. Sticky save bar : "Sauvegarder l'ordre" + last-saved indicator
 *
 * Mobile-friendly : the drag-zone gracefully falls back to a tap-to-pick
 * input ; the list cards stack vertically below md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALLOWED_HERO_VIDEO_MIMES,
  MAX_HERO_VIDEO_BYTES,
  type HeroVideo,
  type HeroVideoTag,
} from "@/lib/hero-videos/types";

const TAG_LABELS: Record<HeroVideoTag, { label: string; emoji: string }> = {
  montage: { label: "Montage", emoji: "🎞️" },
  edit: { label: "Edit", emoji: "✂️" },
  "behind-scenes": { label: "Backstage", emoji: "🎬" },
  hype: { label: "Hype", emoji: "🔥" },
};

const TAG_OPTIONS: HeroVideoTag[] = ["montage", "edit", "behind-scenes", "hype"];

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}` : `${s}s`;
}

interface UploadFormState {
  title: string;
  context: string;
  tag: HeroVideoTag | "";
  audioVolume: number;
  durationMs: number;
}

const EMPTY_UPLOAD: UploadFormState = {
  title: "",
  context: "",
  tag: "",
  audioVolume: 0.8,
  durationMs: 15000,
};

export function HeroVideosEditor() {
  const [videos, setVideos] = useState<HeroVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Upload form state
  const [uploadForm, setUploadForm] = useState<UploadFormState>({ ...EMPTY_UPLOAD });
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Hydrate from server ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/hero-videos", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: { videos: HeroVideo[] }) => {
        if (cancelled) return;
        setVideos(Array.isArray(data?.videos) ? data.videos : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Impossible de charger la liste (${String(e?.message ?? e)}).`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-clear toasts after 4s
  useEffect(() => {
    if (!success && !error) return;
    const t = window.setTimeout(() => {
      setSuccess(null);
      // Don't auto-clear errors silently — they persist until next action.
    }, 4000);
    return () => window.clearTimeout(t);
  }, [success, error]);

  // ── File handling ──────────────────────────────────────────────────
  const validateFile = useCallback((file: File): string | null => {
    const ok = ALLOWED_HERO_VIDEO_MIMES.includes(
      file.type as (typeof ALLOWED_HERO_VIDEO_MIMES)[number],
    );
    if (!ok) {
      return `Type de fichier non supporté (${file.type || "inconnu"}). Accepté : MP4 ou MOV.`;
    }
    if (file.size > MAX_HERO_VIDEO_BYTES) {
      return `Fichier trop volumineux (${fmtBytes(file.size)}). Maximum ${fmtBytes(MAX_HERO_VIDEO_BYTES)} en upload direct.`;
    }
    return null;
  }, []);

  const acceptFile = useCallback(
    (file: File) => {
      const err = validateFile(file);
      if (err) {
        setError(err);
        setPendingFile(null);
        return;
      }
      setError(null);
      setPendingFile(file);
      // Auto-fill title from filename if empty
      if (!uploadForm.title) {
        const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
        setUploadForm((s) => ({ ...s, title: base.slice(0, 80) }));
      }
    },
    [validateFile, uploadForm.title],
  );

  // Drag-and-drop handlers
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) acceptFile(file);
    },
    [acceptFile],
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) acceptFile(file);
    },
    [acceptFile],
  );

  // ── Upload ─────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!pendingFile) {
      setError("Choisis d'abord un fichier MP4.");
      return;
    }
    if (!uploadForm.title.trim()) {
      setError("Donne un titre à la vidéo.");
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      fd.append("title", uploadForm.title.trim());
      if (uploadForm.context.trim()) fd.append("context", uploadForm.context.trim());
      if (uploadForm.tag) fd.append("tag", uploadForm.tag);
      fd.append("audioVolume", String(uploadForm.audioVolume));
      fd.append("durationMs", String(uploadForm.durationMs));

      const res = await fetch("/api/admin/hero-videos/upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; video: HeroVideo }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        throw new Error(
          json && "error" in json ? json.error : `HTTP ${res.status}`,
        );
      }

      setVideos((prev) => [...prev, json.video]);
      setPendingFile(null);
      setUploadForm({ ...EMPTY_UPLOAD });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSuccess(`✓ "${json.video.title}" uploadé.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'upload.");
    } finally {
      setUploading(false);
    }
  }, [pendingFile, uploadForm]);

  // ── List operations ────────────────────────────────────────────────
  const updateVideo = useCallback((idx: number, patch: Partial<HeroVideo>) => {
    setVideos((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    );
  }, []);

  const moveVideo = useCallback((idx: number, direction: -1 | 1) => {
    setVideos((prev) => {
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy.map((v, i) => ({ ...v, order: i }));
    });
  }, []);

  const deleteVideo = useCallback(async (id: string) => {
    if (!window.confirm("Supprimer définitivement cette vidéo ? L'asset sera retiré de R2.")) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/hero-videos?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVideos((prev) => prev.filter((v) => v.id !== id).map((v, i) => ({ ...v, order: i })));
      setSuccess("✓ Vidéo supprimée.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la suppression.");
    }
  }, []);

  // ── Save (reorder + metadata edit) ─────────────────────────────────
  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Re-stamp order to be safe.
      const ordered = videos.map((v, i) => ({ ...v, order: i }));
      const res = await fetch("/api/admin/hero-videos", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos: ordered }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; videos: HeroVideo[] }
        | { error: string }
        | null;
      if (!res.ok || !json || ("error" in json && !("ok" in json))) {
        const msg = json && "error" in json ? json.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (json && "videos" in json) setVideos(json.videos);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de sauvegarde.");
    } finally {
      setSaving(false);
    }
  }, [videos]);

  // ── Render ─────────────────────────────────────────────────────────
  const totalDurationMs = useMemo(
    () => videos.reduce((sum, v) => sum + v.durationMs, 0),
    [videos],
  );

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-muted)]">Chargement&hellip;</div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ─── Toast / status bar ─────────────────────────────────────── */}
      {(error || success) && (
        <div
          role={error ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]"
              : "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]"
          }`}
        >
          {error || success}
        </div>
      )}

      {/* ─── Upload zone ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-[var(--gold-bright)]">
            Uploader un nouveau hero
          </h2>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">
            {videos.length} vid&eacute;o{videos.length > 1 ? "s" : ""} &middot;{" "}
            {fmtDuration(totalDurationMs)} total
          </span>
        </div>

        <div
          className={`rounded-xl border-2 border-dashed transition-colors ${
            dragActive
              ? "border-[var(--gold)] bg-[var(--gold)]/5"
              : "border-[var(--border-gold)] bg-black/20"
          } p-6 text-center`}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={onDrop}
        >
          {pendingFile ? (
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-primary)]">
                <span className="text-[var(--gold)]">📁</span> {pendingFile.name}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {fmtBytes(pendingFile.size)} &middot; {pendingFile.type || "video/mp4"}
              </p>
              <button
                type="button"
                onClick={() => {
                  setPendingFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="text-xs text-[var(--text-muted)] underline hover:text-[var(--red)]"
              >
                Changer
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">
                Glisse-d&eacute;pose un fichier MP4 ou MOV (max 60 MB)
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 hover:bg-[var(--gold)]/20 text-sm text-[var(--gold-bright)] transition-all"
              >
                Choisir un fichier
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime"
            onChange={onFileInput}
            className="hidden"
          />
        </div>

        {/* Metadata fields */}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Titre *
            </span>
            <input
              type="text"
              value={uploadForm.title}
              onChange={(e) => setUploadForm((s) => ({ ...s, title: e.target.value }))}
              placeholder="Le Sacre · Vladi MVP"
              className="w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Contexte (optionnel)
            </span>
            <input
              type="text"
              value={uploadForm.context}
              onChange={(e) => setUploadForm((s) => ({ ...s, context: e.target.value }))}
              placeholder="LEC Versus 2026 &middot; Game 3"
              className="w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Dur&eacute;e affich&eacute;e (s)
            </span>
            <input
              type="number"
              min={3}
              max={300}
              step={1}
              value={Math.round(uploadForm.durationMs / 1000)}
              onChange={(e) =>
                setUploadForm((s) => ({
                  ...s,
                  durationMs: Math.max(3, Math.min(300, parseInt(e.target.value, 10) || 15)) * 1000,
                }))
              }
              className="w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Volume audio (0-100%)
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(uploadForm.audioVolume * 100)}
              onChange={(e) =>
                setUploadForm((s) => ({ ...s, audioVolume: parseInt(e.target.value, 10) / 100 }))
              }
              className="w-full accent-[var(--gold)]"
            />
            <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
              {Math.round(uploadForm.audioVolume * 100)}%
            </span>
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Tag
            </span>
            <div className="flex flex-wrap gap-2">
              {TAG_OPTIONS.map((t) => {
                const active = uploadForm.tag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setUploadForm((s) => ({ ...s, tag: active ? "" : t }))}
                    className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                      active
                        ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold-bright)]"
                        : "border-white/10 bg-black/30 text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
                    }`}
                  >
                    {TAG_LABELS[t].emoji} {TAG_LABELS[t].label}
                  </button>
                );
              })}
            </div>
          </label>
        </div>

        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || !pendingFile || !uploadForm.title.trim()}
          className="px-5 py-2.5 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-bright)] text-[var(--bg-primary)] font-display font-bold text-sm uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? "Upload en cours&hellip;" : "Uploader vers R2"}
        </button>
      </section>

      {/* ─── Videos list ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-[var(--gold-bright)]">
          Rotation actuelle ({videos.length})
        </h2>

        {videos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-gold)] p-8 text-center text-sm text-[var(--text-muted)]">
            Aucune vid&eacute;o uploadee. Le hero affiche les fallbacks YouTube.
          </div>
        ) : (
          <div className="space-y-2">
            {videos.map((v, idx) => (
              <article
                key={v.id}
                className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 grid gap-3 md:grid-cols-[120px_1fr_auto]"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video w-full md:w-[120px] rounded-md overflow-hidden bg-black border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {v.posterUrl ? (
                    <img
                      src={v.posterUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <video
                      src={v.videoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    />
                  )}
                  <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-mono text-[var(--gold)]">
                    #{idx + 1}
                  </span>
                </div>

                {/* Inline edit */}
                <div className="space-y-2 min-w-0">
                  <input
                    type="text"
                    value={v.title}
                    onChange={(e) => updateVideo(idx, { title: e.target.value })}
                    placeholder="Titre"
                    className="w-full rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-sm font-bold text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={v.context ?? ""}
                    onChange={(e) => updateVideo(idx, { context: e.target.value || undefined })}
                    placeholder="Contexte (optionnel)"
                    className="w-full rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--gold)] focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
                    <label className="flex items-center gap-1">
                      Dur&eacute;e
                      <input
                        type="number"
                        min={3}
                        max={300}
                        value={Math.round(v.durationMs / 1000)}
                        onChange={(e) =>
                          updateVideo(idx, {
                            durationMs: Math.max(3, Math.min(300, parseInt(e.target.value, 10) || 15)) * 1000,
                          })
                        }
                        className="w-14 rounded bg-black/30 border border-white/10 px-1 py-0.5 text-xs tabular-nums"
                      />
                      s
                    </label>
                    <label className="flex items-center gap-1">
                      Vol
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(v.audioVolume * 100)}
                        onChange={(e) =>
                          updateVideo(idx, {
                            audioVolume: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) / 100,
                          })
                        }
                        className="w-12 rounded bg-black/30 border border-white/10 px-1 py-0.5 text-xs tabular-nums"
                      />
                      %
                    </label>
                    <select
                      value={v.tag ?? ""}
                      onChange={(e) =>
                        updateVideo(idx, {
                          tag: (e.target.value || undefined) as HeroVideoTag | undefined,
                        })
                      }
                      className="rounded bg-black/30 border border-white/10 px-1.5 py-0.5 text-xs"
                    >
                      <option value="">— tag —</option>
                      {TAG_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {TAG_LABELS[t].emoji} {TAG_LABELS[t].label}
                        </option>
                      ))}
                    </select>
                    <a
                      href={v.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[var(--gold)] truncate max-w-[200px]"
                      title={v.videoUrl}
                    >
                      Voir le MP4 &rarr;
                    </a>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex md:flex-col gap-1 items-center justify-end md:justify-start">
                  <button
                    type="button"
                    onClick={() => moveVideo(idx, -1)}
                    disabled={idx === 0}
                    aria-label="Monter"
                    className="w-8 h-8 grid place-items-center rounded-md hover:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--gold)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    onClick={() => moveVideo(idx, 1)}
                    disabled={idx === videos.length - 1}
                    aria-label="Descendre"
                    className="w-8 h-8 grid place-items-center rounded-md hover:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--gold)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteVideo(v.id)}
                    aria-label="Supprimer"
                    className="w-8 h-8 grid place-items-center rounded-md hover:bg-[var(--red)]/15 text-[var(--text-secondary)] hover:text-[var(--red)] transition-colors"
                  >
                    &times;
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ─── Sticky save bar ────────────────────────────────────────── */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--gold)]/40 bg-black/60 backdrop-blur-xl px-4 py-3 z-10">
        <div className="text-xs text-[var(--text-muted)]">
          {savedAt ? (
            <span className="text-[var(--green)]">
              &#10003; Sauvegardé {Math.floor((Date.now() - savedAt) / 1000)}s
            </span>
          ) : (
            <span>Modifications de l&apos;ordre / m&eacute;tadonn&eacute;es non sauvegard&eacute;es</span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || videos.length === 0}
          className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-bright)] text-[var(--bg-primary)] font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Sauvegarde…" : "Sauvegarder l'ordre"}
        </button>
      </div>
    </div>
  );
}
