/**
 * /c/[shortCode] — public Compilation viewer.
 *
 * Renders the finished MP4 in a 16:9 player + chapter markers list +
 * share buttons. Status path :
 *
 *   • not_found          → notFound() (404)
 *   • pending/rendering  → "still rendering" splash with auto-refresh
 *                          via meta refresh (every 20 s) so the user
 *                          who lands fresh from a Discord/Twitter share
 *                          eventually sees the final video.
 *   • done               → full viewer
 *   • failed             → "render failed" splash with render_error
 *                          surfaced + "Recréer une compilation" CTA.
 *
 * Anon-safe : reads via the fn_get_compilation_by_short_code RPC
 * (SECURITY DEFINER, public grant) — the kills RLS public read policy
 * handles the chapter markers query.
 *
 * Author alias : the row carries an `author_hash` (SHA-256 prefix of
 * the session_hash). We feed it into visitorNameFromHash() — same
 * function the BCC registre uses — to render a stable, vaguely-
 * aristocratic alias instead of leaking the raw session id.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

import {
  getCompilationByShortCode,
  getKillsForCompilation,
  recordCompilationView,
} from "@/lib/supabase/compilations";
import { championIconUrl } from "@/lib/constants";
import { visitorNameFromHash } from "@/components/bcc/visitor-names";
import { CompilationPlayer } from "./CompilationPlayer";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://kckills.com");

// Short URLs are user-generated — we can't pre-render at build time.
// Server-render on first hit, then cache for 60 s. Done compilations
// won't change ; pending ones do, but the wizard's polling already
// covers that case.
export const revalidate = 60;

interface Props {
  params: Promise<{ shortCode: string }>;
}

// ─── Metadata ──────────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shortCode } = await params;
  const row = await getCompilationByShortCode(shortCode, { buildTime: true });
  if (!row) {
    return {
      title: "Compilation introuvable — KCKILLS",
      robots: { index: false, follow: false },
    };
  }
  const title = `${row.title} — Compilation KC`;
  const description =
    row.description ??
    `Best-of Karmine Corp en ${row.killIds.length} clips. Rendu communauté.`;
  return {
    title,
    description,
    alternates: { canonical: `/c/${row.shortCode}` },
    openGraph: {
      title,
      description,
      type: row.status === "done" ? "video.other" : "website",
      url: `/c/${row.shortCode}`,
      siteName: "KCKILLS",
      locale: "fr_FR",
      videos:
        row.status === "done" && row.outputUrl
          ? [{ url: row.outputUrl, type: "video/mp4" }]
          : undefined,
    },
    twitter: {
      card: "player",
      title,
      description,
    },
  };
}

// ─── Format helpers ────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—:—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Round-and-floor each chapter to where it starts in the final MP4.
// The actual offset depends on whether the worker added an intro card
// (2 s by spec — see worker/compilation_render.py). We approximate from
// the chapter index using a 13 s nominal per-clip duration as the
// default ; the worker writes the exact offsets into the kill_assets
// rows but the page doesn't depend on that — it's a marker, not a seek
// target requirement.
function estimateChapterOffset(
  index: number,
  introOffset: number,
  durationPerClip: number,
): number {
  return Math.max(0, introOffset + index * durationPerClip);
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function CompilationViewerPage({ params }: Props) {
  const { shortCode } = await params;
  if (!/^[0-9A-Za-z]{6,12}$/.test(shortCode)) notFound();

  const row = await getCompilationByShortCode(shortCode);
  if (!row) notFound();

  // Fire-and-forget view bump for done compilations only.
  if (row.status === "done") {
    // We don't await — the user shouldn't pay a round-trip just to bump
    // a counter. recordCompilationView is best-effort.
    void recordCompilationView(shortCode);
  }

  const kills = await getKillsForCompilation(row.killIds);
  const introOffset = row.introText ? 2 : 0;
  const nominalPerClip = row.outputDurationSeconds
    ? Math.max(
        4,
        Math.floor(
          (row.outputDurationSeconds - introOffset - (row.outroText ? 2 : 0)) /
            Math.max(1, kills.length),
        ),
      )
    : 13;

  const authorAlias = row.authorHash
    ? visitorNameFromHash(row.authorHash)
    : "BCC anonyme";

  const fullShareUrl = `${SITE_URL}/c/${row.shortCode}`;

  // ── Status-specific renderers ──────────────────────────────────
  if (row.status === "pending" || row.status === "rendering") {
    return (
      <RenderingSplash
        status={row.status}
        title={row.title}
        clipCount={kills.length}
        author={authorAlias}
      />
    );
  }
  if (row.status === "failed") {
    return (
      <FailedSplash
        title={row.title}
        renderError={row.renderError}
        author={authorAlias}
      />
    );
  }

  // ── Done : full viewer ─────────────────────────────────────────
  return (
    <article className="-mx-4 -mt-6 px-4 pb-16">
      {/* Hero — title + author */}
      <header className="mx-auto max-w-5xl pt-6 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
          <span className="text-[var(--gold)]">Compilation</span>
          <span aria-hidden>•</span>
          <span>{kills.length} clips</span>
          <span aria-hidden>•</span>
          <span>{formatDuration(row.outputDurationSeconds)}</span>
          <span aria-hidden>•</span>
          <span>
            {row.viewCount.toLocaleString("fr-FR")} vue
            {row.viewCount === 1 ? "" : "s"}
          </span>
        </div>
        <h1 className="mt-2 font-display text-3xl font-black tracking-tight text-[var(--text-primary)] sm:text-5xl">
          {row.title}
        </h1>
        {row.description ? (
          <p className="mt-3 max-w-2xl text-sm text-[var(--text-secondary)] sm:text-base">
            {row.description}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Par <span className="text-[var(--gold)]">{authorAlias}</span>
        </p>
      </header>

      {/* Player */}
      <div className="mx-auto max-w-5xl">
        <CompilationPlayer
          videoUrl={row.outputUrl!}
          poster={kills[0]?.thumbnailUrl ?? null}
          chapters={kills.map((k, i) => ({
            id: k.id,
            label: `${k.killerChampion ?? "?"} → ${k.victimChampion ?? "?"}`,
            offsetSeconds: estimateChapterOffset(i, introOffset, nominalPerClip),
          }))}
        />
      </div>

      {/* Share */}
      <section
        aria-label="Partager cette compilation"
        className="mx-auto mt-6 flex max-w-5xl flex-wrap items-center gap-2"
      >
        <span className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
          Partager
        </span>
        <ShareLink
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
            `${row.title} — KCKILLS`,
          )}&url=${encodeURIComponent(fullShareUrl)}`}
          label="Twitter"
        />
        <ShareLink
          href={`https://discord.com/channels/@me?content=${encodeURIComponent(fullShareUrl)}`}
          label="Discord"
        />
        <CopyLinkButton url={fullShareUrl} />
      </section>

      {/* Chapter markers */}
      <section
        aria-label="Sommaire des clips"
        className="mx-auto mt-8 max-w-5xl"
      >
        <h2 className="font-display text-sm uppercase tracking-[0.24em] text-[var(--gold)]">
          Sommaire
        </h2>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Cette compil contient {kills.length} clip{kills.length === 1 ? "" : "s"}
          {row.outputDurationSeconds
            ? ` · durée ${formatDuration(row.outputDurationSeconds)}`
            : ""}
          . Clique pour sauter au chapitre.
        </p>

        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kills.map((k, i) => (
            <li key={k.id}>
              <a
                href={`#chapter-${i}`}
                data-chapter-index={i}
                data-chapter-offset={estimateChapterOffset(
                  i,
                  introOffset,
                  nominalPerClip,
                )}
                className="group block overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 transition hover:border-[var(--gold)]/40"
              >
                <div className="relative aspect-video">
                  {k.thumbnailUrl ? (
                    <Image
                      src={k.thumbnailUrl}
                      alt={`${k.killerChampion ?? "?"} → ${k.victimChampion ?? "?"}`}
                      fill
                      sizes="(min-width: 1024px) 22rem, (min-width: 640px) 50vw, 100vw"
                      className="object-cover transition group-hover:scale-105"
                    />
                  ) : k.killerChampion ? (
                    <Image
                      src={championIconUrl(k.killerChampion)}
                      alt={k.killerChampion}
                      fill
                      sizes="22rem"
                      className="object-contain"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                  <span className="absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-[var(--gold)] font-mono text-xs font-bold text-black">
                    {i + 1}
                  </span>
                  {k.multiKill ? (
                    <span className="absolute right-2 top-2 rounded-md bg-[var(--red)]/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
                      {k.multiKill}
                    </span>
                  ) : k.isFirstBlood ? (
                    <span className="absolute right-2 top-2 rounded-md bg-[var(--gold)]/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--gold-bright)]">
                      FB
                    </span>
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="font-display text-sm font-bold text-[var(--text-primary)]">
                    <span className="text-[var(--gold)]">{k.killerChampion}</span>{" "}
                    <span className="text-[var(--text-muted)]">→</span>{" "}
                    <span>{k.victimChampion}</span>
                  </p>
                  {k.killerName ? (
                    <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      {k.killerName.replace(/^[A-Z]{1,4} /, "")} —{" "}
                      <span className="text-[var(--text-muted)]">
                        {k.matchStage ?? "LEC"}
                      </span>
                    </p>
                  ) : null}
                  {k.aiDescription ? (
                    <p className="mt-2 line-clamp-2 text-[11px] text-[var(--text-muted)]">
                      {k.aiDescription}
                    </p>
                  ) : null}
                </div>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section className="mx-auto mt-12 max-w-5xl rounded-3xl border border-[var(--border-gold)] bg-gradient-to-br from-[var(--bg-elevated)]/30 to-[var(--bg-surface)]/20 p-6 text-center sm:p-10">
        <p className="text-[11px] uppercase tracking-[0.32em] text-[var(--gold)]">
          À toi
        </p>
        <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
          Crée ta propre compilation.
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Pick 3 à 10 clips, donne-leur un ordre, ajoute ta signature. Lien
          partageable en moins de 5 minutes.
        </p>
        <Link
          href="/compilation"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--gold)] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--gold-bright)]"
        >
          Lancer le builder →
        </Link>
      </section>
    </article>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function ShareLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
    >
      {label}
    </a>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  // Server-rendered : we attach a tiny inline script that wires the
  // click handler. Keeps this page free of client-component overhead
  // for one button.
  const buttonId = `copy-link-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <>
      <button
        id={buttonId}
        type="button"
        data-url={url}
        className="rounded-full border border-[var(--gold)]/40 px-3 py-1 text-xs text-[var(--gold)] transition hover:bg-[var(--gold)]/10"
      >
        Copier le lien
      </button>
      <script
        dangerouslySetInnerHTML={{
          __html: `(() => {
            const b = document.getElementById(${JSON.stringify(buttonId)});
            if (!b) return;
            b.addEventListener("click", async () => {
              const url = b.getAttribute("data-url") || "";
              try {
                if (navigator.clipboard) await navigator.clipboard.writeText(url);
                const t = b.textContent;
                b.textContent = "Copié ✓";
                setTimeout(() => { b.textContent = t; }, 2000);
              } catch (_) {}
            });
          })();`,
        }}
      />
    </>
  );
}

// ─── Status splashes ───────────────────────────────────────────────────

function RenderingSplash({
  status,
  title,
  clipCount,
  author,
}: {
  status: "pending" | "rendering";
  title: string;
  clipCount: number;
  author: string;
}) {
  return (
    <>
      {/* Auto-refresh every 20 s so a fresh share-link visitor sees the
          finished page when ready, without keeping JS in memory. */}
      <meta httpEquiv="refresh" content="20" />
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
        <span
          aria-hidden
          className="inline-block size-2 animate-pulse rounded-full bg-[var(--cyan)]"
        />
        <p className="mt-3 text-[11px] uppercase tracking-[0.32em] text-[var(--cyan)]">
          {status === "pending" ? "En file d'attente" : "Rendu en cours"}
        </p>
        <h1 className="mt-3 font-display text-2xl font-black text-[var(--text-primary)] sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {clipCount} clips · environ 2 à 5 minutes selon la longueur totale. Tu
          peux fermer cet onglet — le lien restera valide.
        </p>
        <p className="mt-6 text-[11px] text-[var(--text-muted)]">
          Par <span className="text-[var(--gold)]">{author}</span>
        </p>
        <Link
          href="/compilation"
          className="mt-8 text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
        >
          ← Retour au builder
        </Link>
      </div>
    </>
  );
}

function FailedSplash({
  title,
  renderError,
  author,
}: {
  title: string;
  renderError: string | null;
  author: string;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
      <span aria-hidden className="text-3xl text-[var(--red)]">
        ✕
      </span>
      <p className="mt-2 text-[11px] uppercase tracking-[0.32em] text-[var(--red)]">
        Échec du rendu
      </p>
      <h1 className="mt-3 font-display text-2xl font-black text-[var(--text-primary)] sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-sm text-[var(--text-secondary)]">
        Notre worker n&apos;a pas réussi à assembler cette compilation.{" "}
        {renderError ? <span className="text-[var(--text-muted)]">({renderError})</span> : null}
      </p>
      <p className="mt-6 text-[11px] text-[var(--text-muted)]">
        Par <span className="text-[var(--gold)]">{author}</span>
      </p>
      <Link
        href="/compilation"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--gold)] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--gold-bright)]"
      >
        Recommencer
      </Link>
    </div>
  );
}
