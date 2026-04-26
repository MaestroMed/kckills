"use client";

import Link from "next/link";
import { useState, useCallback, useEffect } from "react";
import { BadgeRow } from "@/components/BadgeChip";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { LanguageSettings } from "@/components/settings/LanguageSettings";
import { RiotLinkCard, type RiotLinkProfile } from "@/components/settings/RiotLinkCard";

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
    <div className="mx-auto max-w-lg space-y-8 py-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Param&egrave;tres</span>
      </nav>

      <h1 className="font-display text-2xl font-bold">Param&egrave;tres</h1>

      {/* Profile */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
        <h2 className="font-display font-semibold">Profil</h2>
        {userName ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--gold)] font-bold">{userName}</p>
            {userBadges.length > 0 && (
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Badges</p>
                <BadgeRow slugs={userBadges} />
              </div>
            )}
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
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
          </svg>
          Se connecter avec Discord
        </Link>
      </section>

      {/* Language preference */}
      <LanguageSettings />

      {/* Push notifications */}
      <NotificationSettings />

      {/* Riot Link (optional) */}
      <RiotLinkCard
        available={riotAvailable}
        loggedIn={loggedIn}
        profile={riotProfile}
        callbackState={callbackState}
      />

      {/* Data export (RGPD) */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
        <h2 className="font-display font-semibold">Mes donn&eacute;es</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Exporte toutes tes donn&eacute;es (votes, commentaires, profil) en JSON.
        </p>
        <button
          onClick={handleExport}
          disabled={exportStatus === "loading"}
          className="rounded-lg border border-[var(--border-gold)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--gold)]/40 disabled:opacity-50 transition-colors"
        >
          {exportStatus === "loading" ? "Export en cours..." :
           exportStatus === "done" ? "Export t\u00e9l\u00e9charg\u00e9 !" :
           exportStatus === "auth" ? "Connecte-toi d'abord" :
           exportStatus === "error" ? "Erreur, r\u00e9essaie" :
           "Exporter mes donn\u00e9es"}
        </button>
      </section>

      {/* Delete account (RGPD) */}
      <section className="rounded-xl border border-[var(--red)]/30 bg-[var(--bg-surface)] p-5 space-y-3">
        <h2 className="font-display font-semibold text-[var(--red)]">Zone dangereuse</h2>
        <p className="text-sm text-[var(--text-muted)]">
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
          <button
            onClick={handleDelete}
            disabled={deleteStatus === "deleting"}
            className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-4 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/20 disabled:opacity-50 transition-colors"
          >
            {deleteStatus === "confirming" ? "Confirmer la suppression ?" :
             deleteStatus === "deleting" ? "Suppression..." :
             deleteStatus === "error" ? "Erreur, r\u00e9essaie" :
             "Supprimer mon compte"}
          </button>
        )}
        {deleteStatus === "confirming" && (
          <button
            onClick={() => setDeleteStatus("idle")}
            className="ml-2 text-xs text-[var(--text-muted)] hover:text-white"
          >
            Annuler
          </button>
        )}
      </section>

      {/* Link to privacy */}
      <p className="text-center text-xs text-[var(--text-muted)]">
        <Link href="/privacy" className="underline hover:text-[var(--gold)]">
          Politique de confidentialit&eacute;
        </Link>
      </p>
    </div>
  );
}
