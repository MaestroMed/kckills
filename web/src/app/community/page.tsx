"use client";

import Link from "next/link";
import { useState } from "react";

interface Clip {
  id: string;
  url: string;
  title: string;
  platform: string;
  submittedAt: string;
}

function detectPlatform(url: string): string {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("twitter.com") || url.includes("x.com")) return "twitter";
  return "link";
}

const PLATFORM_ICONS: Record<string, string> = {
  youtube: "\u25B6",
  tiktok: "\uD83C\uDFB5",
  twitter: "\uD83D\uDCAC",
  link: "\uD83D\uDD17",
};

export default function CommunityPage() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!url.trim()) return;
    const clip: Clip = {
      id: `clip-${Date.now()}`,
      url: url.trim(),
      title: title.trim() || "Sans titre",
      platform: detectPlatform(url),
      submittedAt: new Date().toISOString(),
    };
    setClips((prev) => [clip, ...prev]);
    setUrl("");
    setTitle("");
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Community</span>
      </nav>

      <div>
        <h1 className="font-display text-3xl font-bold">
          Community <span className="text-gold-gradient">Clips</span>
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Soumets tes edits YouTube, TikTok ou Twitter des kills KC.
          Les meilleurs sont mis en avant par la communaut&eacute;.
        </p>
      </div>

      {/* Submit form */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 space-y-4">
        <h2 className="font-display font-semibold">Soumettre un clip</h2>
        <div className="space-y-3">
          <input
            type="url"
            placeholder="URL YouTube, TikTok ou Twitter..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)]"
          />
          <input
            type="text"
            placeholder="Titre (optionnel)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)]"
          />
          <button
            onClick={handleSubmit}
            disabled={!url.trim()}
            className="rounded-lg bg-[var(--gold)] px-6 py-3 text-sm font-semibold text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] disabled:opacity-40 transition-all"
          >
            Soumettre
          </button>
        </div>
        {submitted && (
          <p className="text-sm text-[var(--green)] animate-[fadeInUp_0.3s]">
            Clip soumis ! Il sera visible apr&egrave;s mod&eacute;ration.
          </p>
        )}
        <p className="text-[10px] text-[var(--text-disabled)]">
          Les clips sont mod&eacute;r&eacute;s avant publication. Contenu KC uniquement.
        </p>
      </div>

      {/* Submitted clips */}
      {clips.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display font-semibold text-[var(--text-muted)]">
            Soumissions r&eacute;centes ({clips.length})
          </h2>
          {clips.map((clip) => (
            <a
              key={clip.id}
              href={clip.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--gold)]/40"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-lg">
                {PLATFORM_ICONS[clip.platform]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{clip.title}</p>
                <p className="text-[10px] text-[var(--text-muted)] truncate">{clip.url}</p>
              </div>
              <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] text-[var(--gold)]">
                En attente
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Empty state */}
      {clips.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--border-gold)] p-12 text-center">
          <div className="text-4xl mb-3">{"\uD83C\uDFAC"}</div>
          <p className="text-lg text-[var(--text-muted)]">Aucun clip soumis pour le moment</p>
          <p className="mt-2 text-sm text-[var(--text-disabled)]">Sois le premier &agrave; partager ton edit KC !</p>
        </div>
      )}
    </div>
  );
}
