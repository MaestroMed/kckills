"use client";

import Link from "next/link";
import { useState, useCallback, useEffect } from "react";
import { Download, ShieldAlert, UserRound } from "lucide-react";
import { BadgeRow } from "@/components/BadgeChip";
import { Breadcrumb } from "@/components/Breadcrumb";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { LanguageSettings } from "@/components/settings/LanguageSettings";
import { RiotLinkCard, type RiotLinkProfile } from "@/components/settings/RiotLinkCard";
import { SettingsAchievementsRow } from "@/components/settings/SettingsAchievementsRow";

export default function SettingsPage() {
  const [exportStatus, setExportStatus] = useState<"idle" | "loading" | "done" | "error" | "auth">("idle");
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "confirming" | "deleting" | "done" | "error" | "auth">("idle");
  const [userBadges, setUserBadges] = useState<string[]>([]);
  const [userName, setUserName] = useState<string | null>(null);
  const [riotProfile, setRiotProfile] = useState<RiotLinkProfile | null>(null);
  const [riotAvailable, setRiotAvailable] = useState<boolean>(false);
  const [loggedIn, setLoggedIn] = useState<boolean>(false);
  const [callbackState, setCallbackState] = useState<{
    ok?: boolean;
    warn?: string | null;
    error?: string | null;
  }>({});

  // Read the Riot callback query params once on mount and clean the URL
  // so a refresh doesn't replay the toast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const linked = params.get("riot_linked") === "true";
      const warn = params.get("riot_warn");
      const error = params.get("riot_error");
      if (linked || warn || error) {
        setCallbackState({ ok: linked, warn: warn ?? null, error: error ?? null });
        params.delete("riot_linked");
        params.delete("riot_warn");
        params.delete("riot_error");
        const cleaned = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
        window.history.replaceState({}, "", cleaned);
      }
    } catch { /* swallow */ }
  }, []);

  // Fetch user profile on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me");
        if (res.ok) {
          const data = await res.json();
          setUserBadges((data.profile?.badges as string[]) ?? []);
          setUserName(data.profile?.discord_username ?? null);
          setLoggedIn(true);
          if (data.profile?.riot_summoner_name) {
            const champs = Array.isArray(data.profile?.riot_top_champions)
              ? data.profile.riot_top_champions
              : [];
            setRiotProfile({
              summonerName: data.profile.riot_summoner_name ?? null,
              tag: data.profile.riot_tag ?? null,
              rank: data.profile.riot_rank ?? null,
              topChampions: champs,
              linkedAt: data.profile.riot_linked_at ?? null,
            });
          }
        }
      } catch { /* not logged in */ }
    })();
  }, []);

  // Detect whether the Riot link flow is configured server-side. We hit
  // the start route HEAD-style — a 503 means env vars missing, anything
  // else (302 included) means available.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/riot/start", {
          method: "GET",
          redirect: "manual",
        });
        // 503 = explicit "not configured". 0 / opaqueredirect = a redirect
        // Riot would have served, which means the route is wired up.
        setRiotAvailable(res.status !== 503);
      } catch {
        setRiotAvailable(false);
      }
    })();
  }, []);

  const handleExport = useCallback(async () => {
    setExportStatus("loading");
    try {
      const res = await fetch("/api/me");
      if (res.status === 401) { setExportStatus("auth"); return; }
      if (!res.ok) { setExportStatus("error"); return; }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kckills-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch {
      setExportStatus("error");
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (deleteStatus !== "confirming") {
      setDeleteStatus("confirming");
      return;
    }
    setDeleteStatus("deleting");
    try {
      const res = await fetch("/api/me", { method: "DELETE" });
      if (res.status === 401) { setDeleteStatus("auth"); return; }
      if (!res.ok) { setDeleteStatus("error"); return; }
      setDeleteStatus("done");
      setTimeout(() => { window.location.href = "/"; }, 2000);
    } catch {
      setDeleteStatus("error");
    }
  }, [deleteStatus]);

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ─── CINEMATIC HERO ───────────────────────────────────────── */}
      <section
        className="relative overflow-hidden border-b border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(200,170,110,0.18) 0%, transparent 60%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
        }}
      >
        {/* Faint scanlines — matches the /vs + /players heroes */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />
        {/* Floating gold rhombus accents */}
        <span
          aria-hidden
          className="absolute left-[5%] top-10 hidden md:block"
          style={{
            width: 14,
            height: 14,
            transform: "rotate(45deg)",
            background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
            opacity: 0.55,
            boxShadow: "0 0 22px rgba(200,170,110,0.5)",
          }}
        />
        <span
          aria-hidden
          className="absolute right-[7%] top-24 hidden md:block"
          style={{
            width: 9,
            height: 9,
            transform: "rotate(45deg)",
            background: "var(--gold)",
            opacity: 0.4,
            boxShadow: "0 0 14px rgba(200,170,110,0.4)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-3xl px-5 pt-10 pb-8 md:pt-16 md:pb-12">
          <Breadcrumb
            items={[
              { label: "Accueil", href: "/" },
              { label: "Paramètres" },
            ]}
          />

          <div className="mt-8 text-center">
            <p className="font-data inline-flex items-center gap-2.5 text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-4">
              <Losange small />
              Ton compte &middot; RGPD &amp; pr&eacute;f&eacute;rences
            </p>
            <h1 className="font-display text-5xl md:text-7xl font-black leading-none">
              <span className="text-shimmer">PARAM&Egrave;TRES</span>
            </h1>
            <p className="mt-5 mx-auto max-w-xl text-base text-[var(--text-muted)] leading-relaxed">
              G&egrave;re ton profil, ta langue, tes notifications et ton compte Riot.
              Exporte ou supprime tes donn&eacute;es &agrave; tout moment.
            </p>
          </div>
        </div>
      </section>

      {/* ─── UNIFIED CONTAINER ────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        {/* Profile */}
        <HextechCard glow eyebrow="Profil" icon={<UserRound className="h-3.5 w-3.5" />}>
          {userName ? (
            <div className="space-y-3">
              <p className="font-display text-lg text-[var(--gold)] font-bold">{userName}</p>
              {userBadges.length > 0 && (
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Badges</p>
                  <BadgeRow slugs={userBadges} />
                </div>
              )}
              <SettingsAchievementsRow />
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Connecte-toi avec Discord pour voir ton profil.
            </p>
          )}
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4752C4] transition-colors"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
            </svg>
            Se connecter avec Discord
          </Link>
        </HextechCard>

        {/* Language preference (sub-component card) */}
        <LanguageSettings />

        {/* Push notifications (sub-component card) */}
        <NotificationSettings />

        {/* Riot Link (optional, sub-component card) */}
        <RiotLinkCard
          available={riotAvailable}
          loggedIn={loggedIn}
          profile={riotProfile}
          callbackState={callbackState}
        />

        {/* RGPD actions — two page-owned cards, side by side on desktop */}
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Data export (RGPD) */}
          <HextechCard glow eyebrow="Mes données" icon={<Download className="h-3.5 w-3.5" />}>
            <p className="text-sm text-[var(--text-muted)] flex-1">
              Exporte toutes tes donn&eacute;es (votes, commentaires, profil) en JSON.
            </p>
            <button
              onClick={handleExport}
              disabled={exportStatus === "loading"}
              className="self-start rounded-lg border border-[var(--border-gold)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)] disabled:opacity-50 transition-colors"
            >
              {exportStatus === "loading" ? "Export en cours..." :
               exportStatus === "done" ? "Export téléchargé !" :
               exportStatus === "auth" ? "Connecte-toi d'abord" :
               exportStatus === "error" ? "Erreur, réessaie" :
               "Exporter mes données"}
            </button>
            {/* SR-only live region — announces the export outcome to assistive tech. */}
            <span role="status" aria-live="polite" className="sr-only">
              {exportStatus === "loading" ? "Export de tes données en cours." :
               exportStatus === "done" ? "Export téléchargé." :
               exportStatus === "auth" ? "Connecte-toi d'abord pour exporter tes données." :
               exportStatus === "error" ? "Échec de l'export. Réessaie." :
               ""}
            </span>
          </HextechCard>

          {/* Delete account (RGPD) */}
          <HextechCard tone="danger" eyebrow="Zone dangereuse" icon={<ShieldAlert className="h-3.5 w-3.5" />}>
            <p className="text-sm text-[var(--text-muted)] flex-1">
              Supprimer ton compte efface ton profil, anonymise tes votes et supprime tes commentaires.
              Cette action est irr&eacute;versible.
            </p>
            {deleteStatus === "done" ? (
              <p className="text-sm text-[var(--green)]">
                Compte supprim&eacute;. Redirection...
              </p>
            ) : deleteStatus === "auth" ? (
              <p className="text-sm text-[var(--text-muted)]">
                Connecte-toi pour supprimer ton compte.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleteStatus === "deleting"}
                  className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-4 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/20 disabled:opacity-50 transition-colors"
                >
                  {deleteStatus === "confirming" ? "Confirmer la suppression ?" :
                   deleteStatus === "deleting" ? "Suppression..." :
                   deleteStatus === "error" ? "Erreur, réessaie" :
                   "Supprimer mon compte"}
                </button>
                {deleteStatus === "confirming" && (
                  <button
                    onClick={() => setDeleteStatus("idle")}
                    className="text-xs text-[var(--text-muted)] hover:text-white transition-colors"
                  >
                    Annuler
                  </button>
                )}
              </div>
            )}
            {/* SR-only live region — announces the delete-account flow,
                including the destructive confirm step, to assistive tech. */}
            <span role="status" aria-live="polite" className="sr-only">
              {deleteStatus === "confirming" ? "Confirmation requise : clique encore pour supprimer définitivement ton compte, ou annule." :
               deleteStatus === "deleting" ? "Suppression de ton compte en cours." :
               deleteStatus === "done" ? "Compte supprimé. Redirection en cours." :
               deleteStatus === "auth" ? "Connecte-toi pour supprimer ton compte." :
               deleteStatus === "error" ? "Échec de la suppression. Réessaie." :
               ""}
            </span>
          </HextechCard>
        </div>

        {/* Link to privacy */}
        <p className="text-center text-xs text-[var(--text-muted)]">
          <Link href="/privacy" className="underline hover:text-[var(--gold)] transition-colors">
            Politique de confidentialit&eacute;
          </Link>
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Hextech card — premium surface for the page-owned sections.
// .glass body + gold-line divider under the eyebrow + corner losanges.
// `glow` adds the hover gold-glow; `tone="danger"` swaps the accent red.
// ════════════════════════════════════════════════════════════════════

function HextechCard({
  eyebrow,
  icon,
  children,
  glow,
  tone = "gold",
}: {
  eyebrow: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  glow?: boolean;
  tone?: "gold" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <section
      className={`group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl glass p-5 transition-all duration-300 ${
        danger
          ? "border border-[var(--red)]/30 hover:border-[var(--red)]/50"
          : "border border-[var(--border-gold)] hover:border-[var(--gold)]/45"
      } ${glow ? "hover:gold-glow" : ""}`}
    >
      <CornerLosange position="tl" gold={!danger} danger={danger} />
      <CornerLosange position="br" gold={!danger} danger={danger} />

      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={danger ? "text-[var(--red)]" : "text-[var(--gold)]"}
        >
          {icon ?? <Losange small />}
        </span>
        <h2
          className={`font-display font-semibold ${
            danger ? "text-[var(--red)]" : "text-[var(--text-primary)]"
          }`}
        >
          {eyebrow}
        </h2>
      </div>
      <div className="gold-line opacity-60" />

      {children}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Losange / corner accents — copied from the VSRoulette hextech kit.
// ════════════════════════════════════════════════════════════════════

function Losange({ small }: { small?: boolean } = {}) {
  const size = small ? 8 : 14;
  return (
    <span
      aria-hidden
      className="inline-block"
      style={{
        width: size,
        height: size,
        transform: "rotate(45deg)",
        background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
        boxShadow: "0 0 14px rgba(200,170,110,0.5)",
      }}
    />
  );
}

function CornerLosange({
  position,
  gold,
  danger,
}: {
  position: "tl" | "tr" | "bl" | "br";
  gold?: boolean;
  danger?: boolean;
}) {
  const map: Record<string, string> = {
    tl: "top-2 left-2",
    tr: "top-2 right-2",
    bl: "bottom-2 left-2",
    br: "bottom-2 right-2",
  };
  const background = danger
    ? "linear-gradient(135deg, var(--red), #7a1f2b)"
    : gold
      ? "linear-gradient(135deg, var(--gold-bright), var(--gold))"
      : "rgba(200,170,110,0.5)";
  return (
    <span
      aria-hidden
      className={`absolute ${map[position]} transition-opacity duration-300 opacity-60 group-hover:opacity-100`}
      style={{
        width: 8,
        height: 8,
        transform: "rotate(45deg)",
        background,
        boxShadow: danger
          ? "0 0 10px rgba(232,64,87,0.5)"
          : gold
            ? "0 0 10px rgba(200,170,110,0.6)"
            : undefined,
      }}
    />
  );
}
