"use client";

/**
 * MatchDayHero — l'affiche du hero quand le thème d'accueil a un match
 * (lib/home-themes : `spotlight`). Remplace le titre KCKILLS de la colonne
 * gauche le temps de la journée :
 *
 *   pastille du thème → KC  VS  ADVERSAIRE → compétition · phase · format
 *   → heure du coup d'envoi (Paris) + compte à rebours vivant → CTA
 *
 * États : à venir → bientôt (< 1 h) → en direct → terminé (4 h après le
 * coup d'envoi : on renvoie vers les kills du match). L'heure réelle vient de
 * /api/next-match (calendrier officiel, cache 5 min) quand l'adversaire
 * correspond ; sinon l'heure prévue dans le thème.
 *
 * Rien n'est rendu côté serveur pour le compte à rebours (pas de « maintenant »
 * faux à l'hydratation) : la ligne garde sa hauteur, aucun saut de mise en page.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useT } from "@/lib/i18n/use-lang";
import type { HomeTheme } from "@/lib/home-themes";

const KC_LOGO = "https://static.lolesports.com/teams/1704714951336_KC.png";
const AFTER_MS = 4 * 3600_000;

type Phase = "upcoming" | "soon" | "live" | "after";

export function MatchDayHero({ theme }: { theme: HomeTheme }) {
  const t = useT();
  const s = theme.spotlight!;
  const [now, setNow] = useState<number | null>(null);
  const [kickoff, setKickoff] = useState(() => Date.parse(s.kickoffISO));
  const [apiLive, setApiLive] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const pull = async () => {
      try {
        const r = await fetch("/api/next-match", { signal: ac.signal });
        if (!r.ok) return;
        const d = await r.json();
        const n = d?.next;
        if (n?.opponentCode === s.opponentCode && n.kickoffISO) {
          setKickoff(Date.parse(n.kickoffISO));
          setApiLive(Boolean(n.isLive));
        }
      } catch {
        /* heure prévue du thème */
      }
    };
    pull();
    const id = window.setInterval(pull, 60_000);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [s.opponentCode]);

  const ms = now === null ? null : kickoff - now;
  let phase: Phase | null = null;
  if (ms !== null) {
    if (apiLive) phase = "live";
    else if (ms <= -AFTER_MS) phase = "after";
    else if (ms <= 0) phase = "live";
    else if (ms <= 3600_000) phase = "soon";
    else phase = "upcoming";
  }

  const kickoffLocal = new Date(kickoff).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const dayLocal = new Date(kickoff).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

  return (
    <div className="matchday flex flex-col items-center md:items-start text-center md:text-left">
      {/* pastille du thème */}
      <span className="matchday-kicker inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em]">
        <span aria-hidden className="matchday-diamond" />
        {theme.kicker}
      </span>

      {/* KC  VS  ADVERSAIRE */}
      <h1 className="sr-only">
        Karmine Corp contre {s.opponentName} — {s.competition}, {s.stage}, {s.format}
      </h1>
      <div aria-hidden className="matchday-versus mt-7 flex items-center gap-5 md:gap-8">
        <TeamMark src={KC_LOGO} code="KC" name="Karmine Corp" home />
        <span className="matchday-vs font-display font-black">VS</span>
        <TeamMark src={s.opponentLogo} code={s.opponentCode} name={s.opponentName} />
      </div>

      <p className="mt-6 font-data text-[11px] md:text-xs uppercase tracking-[0.32em] text-white/75">
        {s.competition} · {s.stage} · {s.format}
      </p>

      {/* coup d'envoi + compte à rebours */}
      <div className="mt-5 flex items-end gap-5">
        <div>
          <p className="matchday-time font-display font-black leading-none">{kickoffLocal}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/55">
            {dayLocal} · {t("p_home_matchday.paris_time")}
          </p>
        </div>
        <div className="matchday-status min-h-[44px] min-w-[150px] pb-1" aria-live="polite">
          {phase && <Status phase={phase} ms={ms ?? 0} />}
        </div>
      </div>

      {/* actions */}
      <div className="mt-8 flex flex-wrap items-center gap-3 justify-center md:justify-start">
        {phase === "after" ? (
          <Link href="/scroll" className="matchday-cta-primary">
            {t("p_home_matchday.cta_relive")}
          </Link>
        ) : (
          <Link href="/live" className="matchday-cta-primary">
            {phase === "live" ? t("p_home_matchday.cta_follow_live") : t("p_home_matchday.cta_follow")}
          </Link>
        )}
        <Link href="/scroll" className="matchday-cta-ghost">
          {t("p_home.cta_scroll_kills")}
        </Link>
      </div>
    </div>
  );
}

function TeamMark({ src, code, name, home = false }: { src: string; code: string; name: string; home?: boolean }) {
  return (
    <div className={`matchday-team ${home ? "matchday-team--home" : ""} flex flex-col items-center`}>
      <div className="matchday-crest relative grid place-items-center">
        <Image src={src} alt={name} width={160} height={160} className="matchday-logo object-contain" priority />
      </div>
      <span className="mt-3 font-display text-lg md:text-xl font-black tracking-[0.12em]">{code}</span>
    </div>
  );
}

function Status({ phase, ms }: { phase: Phase; ms: number }) {
  const t = useT();
  if (phase === "live") {
    return (
      <span className="inline-flex items-center gap-2 font-data text-xs font-bold uppercase tracking-[0.28em] text-[var(--red)]">
        <span className="matchday-live-dot" /> {t("p_home_matchday.live")}
      </span>
    );
  }
  if (phase === "after") {
    return <span className="font-data text-xs uppercase tracking-[0.24em] text-white/60">{t("p_home_matchday.over")}</span>;
  }
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="flex flex-col">
      <span className="font-data text-[10px] uppercase tracking-[0.28em] text-white/55">
        {phase === "soon" ? t("p_home_matchday.soon") : t("p_home_matchday.countdown")}
      </span>
      <span className="matchday-countdown font-data text-2xl md:text-3xl font-bold tabular-nums">
        {pad(h)}:{pad(m)}:{pad(sec)}
      </span>
    </span>
  );
}
