"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/use-lang";

interface ApprovedClip {
  id: string;
  external_url: string;
  title: string | null;
  platform: string;
  upvotes: number;
  created_at: string;
}

const PLATFORMS = ["youtube", "tiktok", "twitter"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  twitter: "X / Twitter",
};

export function CommunityClient() {
  const t = useT();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error" | "auth">(
    "idle",
  );
  const [approved, setApproved] = useState<ApprovedClip[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/community/submit")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ApprovedClip[]) => {
        if (!cancelled) setApproved(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setApproved([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/community/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), title: title.trim(), platform }),
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setStatus("auth");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("ok");
      setUrl("");
      setTitle("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="space-y-10">
      <header className="pt-4">
        <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
          KCKILLS
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-black">
          <span className="text-shimmer">{t("p_community.title")}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
          {t("p_community.subtitle")}
        </p>
      </header>

      {/* ── Submission form ─────────────────────────────────────── */}
      <section className="rounded-3xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 md:p-8">
        <h2 className="font-display text-xl font-bold text-[var(--gold)]">
          {t("p_community.submit_heading")}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("p_community.submit_hint")}
        </p>
        <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                {t("p_community.field_url")}
              </span>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-[var(--gold)]/60 focus:outline-none"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                  {t("p_community.field_title")}
                </span>
                <input
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white focus:border-[var(--gold)]/60 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                  {t("p_community.field_platform")}
                </span>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as Platform)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white focus:border-[var(--gold)]/60 focus:outline-none"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p} className="bg-[var(--bg-primary)]">
                      {PLATFORM_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-xl bg-[var(--gold)] px-8 py-3 font-display text-xs font-bold uppercase tracking-widest text-[var(--bg-primary)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 md:w-auto"
            >
              {t("p_community.submit_cta")}
            </button>
          </div>
        </form>
        <div aria-live="polite" className="mt-3 min-h-[1.25rem] text-sm">
          {status === "ok" && (
            <p className="text-[var(--green)]">{t("p_community.submit_success")}</p>
          )}
          {status === "error" && (
            <p className="text-[var(--red)]">{t("p_community.submit_error")}</p>
          )}
          {status === "auth" && (
            <p className="text-[var(--gold)]">
              {t("p_community.submit_auth")}{" "}
              <a href="/login" className="underline">
                Discord →
              </a>
            </p>
          )}
        </div>
      </section>

      {/* ── Approved picks ──────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-xl font-bold text-[var(--text-primary)]">
          {t("p_community.approved_heading")}
        </h2>
        {approved == null ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-2xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : approved.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            {t("p_community.approved_empty")}
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {approved.map((c) => (
              <li key={c.id}>
                <a
                  href={c.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-2xl border border-white/10 bg-[var(--bg-surface)] p-4 transition-colors hover:border-[var(--gold)]/40"
                >
                  <p className="text-[10px] uppercase tracking-widest text-[var(--gold)]/70">
                    {PLATFORM_LABELS[(c.platform as Platform) ?? "youtube"] ?? c.platform}
                  </p>
                  <p className="mt-1 truncate text-sm font-bold text-white">
                    {c.title || c.external_url}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
