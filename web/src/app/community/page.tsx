"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";

interface Clip {
  id: string;
  external_url: string;
  title: string | null;
  platform: string;
  upvotes: number;
  created_at: string;
  pending?: boolean;
}

function detectPlatform(url: string): string {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("twitter.com") || url.includes("x.com")) return "twitter";
  return "youtube";
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
  const [pendingClips, setPendingClips] = useState<Clip[]>([]);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "auth" | "error">("idle");
  const [loading, setLoading] = useState(true);

  // Load approved clips on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/community/submit");
        if (res.ok) {
          const data = await res.json();
          setClips(Array.isArray(data) ? data : []);
        }
      } catch {
        // Supabase/schema error — show empty state
      }
      setLoading(false);
    })();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!url.trim()) return;
    setStatus("submitting");
    const platform = detectPlatform(url);

    try {
      const res = await fetch("/api/community/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), title: title.trim(), platform }),
      });

      if (res.status === 401) {
        setStatus("auth");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }

      const data = await res.json();
      setPendingClips((prev) => [
        { ...data, pending: true },
        ...prev,
      ]);
      setUrl("");
      setTitle("");
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
    }
  }, [url, title]);

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

      {/* Auth prompt */}
      {status === "auth" && (
        <div className="rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-4 text-center">
          <p className="text-sm text-[var(--gold)] mb-2">Connecte-toi pour soumettre un clip</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4752C4] transition-colors"
          >
            Connexion Discord
          </Link>
        </div>
      )}

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
            maxLength={200}
            className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)]"
          />
          <button
            onClick={handleSubmit}
            disabled={!url.trim() || status === "submitting"}
            className="rounded-lg bg-[var(--gold)] px-6 py-3 text-sm font-semibold text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] disabled:opacity-40 transition-all"
          >
            {status === "submitting" ? "Envoi..." : "Soumettre"}
          </button>
        </div>
        {status === "success" && (
          <p className="text-sm text-[var(--green)]">
            Clip soumis ! Il sera visible apr&egrave;s mod&eacute;ration.
          </p>
        )}
        {status === "error" && (
          <p className="text-sm text-[var(--red)]">
            Erreur lors de la soumission. R&eacute;essaie.
          </p>
        )}
        <p className="text-[10px] text-[var(--text-disabled)]">
          Les clips sont mod&eacute;r&eacute;s avant publication. Contenu KC uniquement.
        </p>
      </div>

      {/* Pending clips (just submitted by this user) */}
      {pendingClips.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display font-semibold text-[var(--text-muted)]">
            Tes soumissions ({pendingClips.length})
          </h2>
          {pendingClips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </div>
      )}

      {/* Approved clips from Supabase */}
      {!loading && clips.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display font-semibold">
            Clips approuv&eacute;s ({clips.length})
          </h2>
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-8 text-center">
          <span className="inline-block h-5 w-5 rounded-full border-2 border-[var(--gold)] border-t-transparent animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && clips.length === 0 && pendingClips.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--border-gold)] p-12 text-center">
          <div className="text-4xl mb-3">{"\uD83C\uDFAC"}</div>
          <p className="text-lg text-[var(--text-muted)]">Aucun clip approuv&eacute; pour le moment</p>
          <p className="mt-2 text-sm text-[var(--text-disabled)]">Sois le premier &agrave; partager ton edit KC !</p>
        </div>
      )}
    </div>
  );
}

function ClipCard({ clip }: { clip: Clip }) {
  return (
    <a
      href={clip.external_url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--gold)]/40"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-lg">
        {PLATFORM_ICONS[clip.platform] || PLATFORM_ICONS.link}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{clip.title || "Sans titre"}</p>
        <p className="text-[10px] text-[var(--text-muted)] truncate">{clip.external_url}</p>
      </div>
      {clip.pending ? (
        <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] text-[var(--gold)]">
          En attente
        </span>
      ) : (
        <span className="rounded-md bg-[var(--green)]/10 border border-[var(--green)]/20 px-2 py-1 text-[10px] text-[var(--green)]">
          Approuv&eacute;
        </span>
      )}
    </a>
  );
}
