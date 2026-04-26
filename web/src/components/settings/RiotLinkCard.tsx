"use client";

/**
 * RiotLinkCard — settings card for the optional Riot account link.
 *
 * Two render paths :
 *
 *   NOT LINKED  -> big gold "Lier mon compte Riot" CTA. Anchor href
 *                  navigates to /api/auth/riot/start (server route
 *                  handles auth check + PKCE + redirect to Riot).
 *
 *   LINKED      -> shows the summoner name, current rank, top 5
 *                  champions (icon + level), and a "Délier" button.
 *
 * If the env vars aren't configured server-side, the parent server
 * component passes `available={false}` and we render a soft-disabled
 * card explaining the state. Mobile-first : 44px tap targets,
 * full-width on <768px.
 *
 * Reads the linked profile slice from props (resolved by the parent
 * server component via /api/me-equivalent) — keeping this component
 * client-only avoids RSC-in-client-tree complexity for now.
 */

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { track } from "@/lib/analytics/track";
import { championIconUrl } from "@/lib/constants";

interface ChampionMastery {
  champ_id: number;
  name: string;
  level: number;
  points: number;
}

export interface RiotLinkProfile {
  summonerName: string | null;
  tag: string | null;
  rank: string | null;
  topChampions: ChampionMastery[];
  linkedAt: string | null;
}

interface Props {
  /** Whether the server-side env vars (RIOT_CLIENT_ID/SECRET) are set. */
  available: boolean;
  /** Current Riot link state (null when not linked). */
  profile: RiotLinkProfile | null;
  /** Whether the visitor is logged in via Discord. */
  loggedIn: boolean;
  /** Optional banner state coming from a callback redirect (?riot_linked / ?riot_error). */
  callbackState?: { ok?: boolean; warn?: string | null; error?: string | null };
}

const ERROR_LABELS: Record<string, string> = {
  invalid_callback: "Lien invalide. Recommence le processus.",
  state_mismatch: "Session expir\u00e9e. Recommence le processus.",
  user_denied: "Tu as refus\u00e9 l\u2019autorisation Riot.",
  token_exchange: "Riot a refus\u00e9 l\u2019\u00e9change de token. R\u00e9essaie.",
  account_fetch: "Impossible de r\u00e9cup\u00e9rer ton compte Riot.",
  db_update: "Erreur de sauvegarde, r\u00e9essaie.",
  not_configured: "Connexion Riot indisponible (config manquante).",
  session_expired: "Reconnecte-toi avec Discord puis r\u00e9essaie.",
};

const WARN_LABELS: Record<string, string> = {
  no_api_key:
    "Compte li\u00e9 mais le rank et les champions favoris sont indisponibles (cl\u00e9 API Riot non configur\u00e9e).",
};

export function RiotLinkCard({ available, profile, loggedIn, callbackState }: Props) {
  const [linkedProfile, setLinkedProfile] = useState<RiotLinkProfile | null>(profile);
  const [pending, startTransition] = useTransition();
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  // Hydrate the analytics event when arriving back from /api/auth/riot/callback
  // with ?riot_linked=true. Mirror the AuthEventTracker cookie pattern but
  // we also fire here for robustness — the cookie reader is debounced by
  // the Providers tree.
  useEffect(() => {
    if (callbackState?.ok) {
      track("auth.riot_linked", { metadata: { warn: callbackState.warn ?? null } });
    }
  }, [callbackState?.ok, callbackState?.warn]);

  if (!available) {
    return (
      <Card>
        <h2 className="font-display font-semibold">Lier ton compte Riot</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Connexion Riot indisponible pour le moment. Reviens plus tard.
        </p>
      </Card>
    );
  }

  if (!loggedIn) {
    return (
      <Card>
        <h2 className="font-display font-semibold">Lier ton compte Riot</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Connecte-toi avec Discord avant de pouvoir lier ton compte Riot.
        </p>
      </Card>
    );
  }

  // ── NOT LINKED state ────────────────────────────────────────────────
  if (!linkedProfile || !linkedProfile.summonerName) {
    return (
      <Card>
        <h2 className="font-display font-semibold">Lier ton compte Riot</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Affiche ton rank et tes 5 champions favoris sur ton profil. Optionnel
          &mdash; ne change rien &agrave; l&apos;exp&eacute;rience de scroll.
        </p>

        {callbackState?.error && ERROR_LABELS[callbackState.error] && (
          <p className="text-xs text-[var(--red)]" role="status" aria-live="polite">
            {ERROR_LABELS[callbackState.error]}
          </p>
        )}

        <a
          href="/api/auth/riot/start"
          onClick={() => track("riot.link_started")}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--gold)] px-4 py-3 text-sm font-bold text-black hover:bg-[var(--gold-bright)] transition-colors min-h-[44px] md:w-auto"
        >
          <RiotIcon />
          Lier mon compte Riot
        </a>

        <p className="text-[10px] text-[var(--text-muted)] opacity-70">
          On stocke un hash SHA-256 de ton PUUID, jamais l&apos;identifiant en clair.
        </p>
      </Card>
    );
  }

  // ── LINKED state ────────────────────────────────────────────────────
  const handleUnlink = () => {
    if (!confirm("D\u00e9lier ton compte Riot ? Ton rank et tes champions ne seront plus affich\u00e9s.")) return;
    setUnlinkError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/riot/unlink", { method: "POST" });
        if (!res.ok) {
          setUnlinkError("Erreur, r\u00e9essaie.");
          return;
        }
        setLinkedProfile(null);
        track("auth.riot_unlinked");
      } catch {
        setUnlinkError("Erreur r\u00e9seau, r\u00e9essaie.");
      }
    });
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Compte Riot li&eacute;</h2>
        <span
          className="text-[10px] uppercase tracking-widest text-[var(--green)]"
          role="status"
          aria-live="polite"
        >
          {"\u25CF Li\u00e9"}
        </span>
      </div>

      {callbackState?.ok && callbackState.warn && WARN_LABELS[callbackState.warn] && (
        <p className="text-xs text-[var(--orange)]" role="status" aria-live="polite">
          {WARN_LABELS[callbackState.warn]}
        </p>
      )}

      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-display text-lg font-bold text-[var(--gold)]">
          {linkedProfile.summonerName ?? "?"}
        </span>
        {linkedProfile.tag && (
          <span className="font-data text-sm text-[var(--text-muted)]">
            #{linkedProfile.tag}
          </span>
        )}
      </div>

      {linkedProfile.rank ? (
        <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)] mb-1">
            Rank Solo/Duo
          </p>
          <p className="font-display text-xl font-black text-[var(--gold)]">
            {linkedProfile.rank}
          </p>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">
          Aucun rank Solo/Duo d&eacute;tect&eacute; cette saison.
        </p>
      )}

      {linkedProfile.topChampions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
            Top {linkedProfile.topChampions.length} champions
          </p>
          <ul className="grid grid-cols-5 gap-2">
            {linkedProfile.topChampions.map((c) => (
              <li
                key={c.champ_id}
                className="flex flex-col items-center gap-1"
                title={`${c.name} \u2014 niveau ${c.level} \u00b7 ${c.points.toLocaleString("fr-FR")} pts`}
              >
                <div className="relative h-12 w-12 rounded-full overflow-hidden border border-[var(--border-gold)] bg-[var(--bg-elevated)]">
                  <Image
                    src={championIconUrl(c.name)}
                    alt={c.name}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </div>
                <span className="text-[10px] font-data text-[var(--text-muted)]">
                  M{c.level}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={handleUnlink}
        disabled={pending}
        className="inline-flex items-center justify-center min-h-[44px] w-full md:w-auto rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/10 px-4 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/20 disabled:opacity-50 transition-colors"
      >
        {pending ? "D\u00e9liaison\u2026" : "D\u00e9lier mon compte Riot"}
      </button>
      {unlinkError && (
        <p className="text-xs text-[var(--red)]" role="status" aria-live="polite">
          {unlinkError}
        </p>
      )}

      {linkedProfile.linkedAt && (
        <p className="text-[10px] text-[var(--text-muted)] opacity-70">
          Li&eacute; le{" "}
          {new Date(linkedProfile.linkedAt).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
      {children}
    </section>
  );
}

function RiotIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 5l3 12h12l3-12-5 3-3-4-3 4-5-3zm3 14h12v2H6v-2z" />
    </svg>
  );
}
