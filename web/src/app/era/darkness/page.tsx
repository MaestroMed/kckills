/**
 * /era/darkness — Hidden easter egg page.
 *
 * The "inverted" mirror of the timeline. Only reachable by typing the URL
 * directly or via the hint at the bottom of the 2024 Spring era card. Not
 * linked from the navbar, not in the sitemap, noindex/nofollow for crawlers.
 *
 * Narrative: the 2024 Dark Era — Winter 10th, Spring 10th, the G2 reverse
 * sweep reverse, the clean slate, then fade-to-light link to Le Sacre 2025.
 *
 * Design: inverted Hextech palette (blood red, rust, char black, ember orange)
 * instead of gold + cyan. Typography heavier, text-shadow for a horror tone.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getEraById } from "@/lib/eras";
import { getServerT } from "@/lib/i18n/server-lang";

export const metadata: Metadata = {
  title: "L'ere sombre",
  description: "Le chapitre qu'on prefere oublier. 2024. Les deux derniers rangs consecutifs. La reverse sweep reverse. La redemption commence ici.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  alternates: {
    canonical: "/era/darkness",
  },
};

const WINTER = getEraById("lec-2024-winter");
const SPRING = getEraById("lec-2024-spring");
const SUMMER = getEraById("lec-2024-summer");
const SACRE = getEraById("lec-2025-winter");

export default async function DarknessPage() {
  const { t } = await getServerT();
  return (
    <div className="darkness-root relative -mx-4 -my-6 min-h-[calc(100vh+200px)] overflow-hidden">
      {/* ── Background layers ───────────────────────────────────── */}
      <div className="absolute inset-0 bg-[#0a0203]" aria-hidden />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, rgba(232, 64, 87, 0.2) 0%, transparent 50%), radial-gradient(ellipse at 80% 40%, rgba(120, 40, 20, 0.35) 0%, transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(232, 64, 87, 0.15) 0%, transparent 50%)",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.4) 0px, rgba(255,255,255,0.4) 1px, transparent 1px, transparent 3px)",
        }}
        aria-hidden
      />

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto max-w-3xl px-6 py-24 md:py-32 space-y-24 md:space-y-32">

        {/* HERO — massive inverted title */}
        <section className="text-center">
          <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[#7c2424] mb-6">
            {t("p_darkness.hero_eyebrow")}
          </p>
          <h1
            className="font-display text-5xl md:text-7xl lg:text-8xl font-black uppercase leading-none tracking-tight"
            style={{
              color: "#e84057",
              textShadow:
                "0 0 40px rgba(232, 64, 87, 0.3), 0 0 12px rgba(232, 64, 87, 0.5), 2px 2px 0 #1a0508",
              letterSpacing: "-0.02em",
            }}
          >
            {t("p_darkness.hero_title_l1")}
            <br />
            {t("p_darkness.hero_title_l2")}
          </h1>
          <p className="mt-8 font-display text-xs md:text-sm uppercase tracking-[0.35em] text-[#9a3a3a]">
            {t("p_darkness.hero_tagline")}
          </p>
          <div className="mt-12 h-px w-40 bg-gradient-to-r from-transparent via-[#e84057]/40 to-transparent mx-auto" />
        </section>

        {/* OPENING */}
        <section className="space-y-6 text-lg md:text-xl leading-relaxed text-[#c4b0b0]">
          <p>
            {t("p_darkness.open_p1_pre")}{" "}
            <strong className="text-[#e8bfa5]">{t("p_darkness.open_p1_amount")}</strong>
            {t("p_darkness.open_p1_mid")}
            <br />
            {t("p_darkness.open_p1_kameto")}{" "}
            <em>{t("p_darkness.open_p1_quote")}</em>
          </p>
          <p>
            {t("p_darkness.open_p2_pre")} <strong className="text-[#e8bfa5]">{t("p_darkness.open_p2_berlin")}</strong> {t("p_darkness.open_p2_post")}
          </p>
          <p className="text-[#e84057] text-xl md:text-2xl font-display font-bold uppercase tracking-wide">
            {t("p_darkness.open_berlin_verdict")}
          </p>
        </section>

        {/* WINTER 2024 */}
        <DarkChapter
          ordinal="I."
          period="Winter 2024"
          title={t("p_darkness.ch1_title")}
          subtitle={t("p_darkness.ch1_subtitle")}
          result={WINTER?.result ?? t("p_darkness.result_10th")}
        >
          <p>
            {t("p_darkness.ch1_p1")}
          </p>
          <p>
            {t("p_darkness.ch1_p2_pre")}{" "}
            <strong className="text-[#e84057]">{t("p_darkness.ch1_p2_last")}</strong>{t("p_darkness.ch1_p2_post")}
          </p>
          <blockquote className="border-l-2 border-[#e84057]/40 pl-5 italic text-[#9a8080]">
            {t("p_darkness.ch1_quote_pre")}<em>{t("p_darkness.ch1_quote_em")}</em>{t("p_darkness.ch1_quote_post")}
          </blockquote>
        </DarkChapter>

        {/* SPRING 2024 */}
        <DarkChapter
          ordinal="II."
          period="Spring 2024"
          title={t("p_darkness.ch2_title")}
          subtitle={t("p_darkness.ch2_subtitle")}
          result={SPRING?.result ?? t("p_darkness.result_10th")}
        >
          <p>
            {t("p_darkness.ch2_p1_pre")}{" "}
            <strong className="text-[#e84057]">{t("p_darkness.ch2_p1_last")}</strong>{t("p_darkness.ch2_p1_post")}
          </p>
          <p>
            {t("p_darkness.ch2_p2_pre")} <strong>{t("p_darkness.ch2_p2_02")}</strong>{t("p_darkness.ch2_p2_mid")}{" "}
            <strong>{t("p_darkness.ch2_p2_22")}</strong>{t("p_darkness.ch2_p2_post")}
          </p>
          <p className="text-[#e84057] text-xl font-display font-bold">
            {t("p_darkness.ch2_game5")}
          </p>
          <p>
            {t("p_darkness.ch2_p3")}
          </p>
          <blockquote className="border-l-2 border-[#e84057]/40 pl-5 italic text-[#9a8080]">
            {t("p_darkness.ch2_quote")}
          </blockquote>
        </DarkChapter>

        {/* THE TURNING POINT */}
        <DarkChapter
          ordinal="III."
          period="2 mai 2024"
          title={t("p_darkness.ch3_title")}
          subtitle={t("p_darkness.ch3_subtitle")}
          result={t("p_darkness.ch3_result")}
        >
          <p>
            <strong className="text-[#e8bfa5]">{t("p_darkness.ch3_p1_names")}</strong> {t("p_darkness.ch3_p1_post")}
          </p>
          <p>
            {t("p_darkness.ch3_p2_pre")}{" "}
            <strong className="text-[#e8bfa5]">Canna</strong>{t("p_darkness.ch3_p2_canna")}{" "}
            <strong className="text-[#e8bfa5]">Closer</strong>{" "}
            {t("p_darkness.ch3_p2_closer")} <strong className="text-[#e8bfa5]">Vladi</strong>{t("p_darkness.ch3_p2_vladi")}
          </p>
          <p>
            {t("p_darkness.ch3_p3_pre")} <strong className="text-[#e8bfa5]">{t("p_darkness.ch3_p3_4th")}</strong> {t("p_darkness.ch3_p3_post")}
          </p>
        </DarkChapter>

        {/* FADE TO LIGHT */}
        <section className="space-y-10 text-center pt-16">
          <div className="h-px w-40 bg-gradient-to-r from-transparent via-[#e84057]/40 to-transparent mx-auto" />
          <p className="font-display text-sm uppercase tracking-[0.3em] text-[#7c5a3a]">
            {t("p_darkness.fade_eyebrow")}
          </p>
          <h2
            className="font-display text-4xl md:text-5xl lg:text-6xl font-black uppercase"
            style={{
              background: "linear-gradient(135deg, #785a28 0%, #c8aa6e 40%, #f0e6d2 60%, #c8aa6e 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              letterSpacing: "-0.01em",
            }}
          >
            Le Sacre
          </h2>
          <p className="text-[#9a8080] max-w-xl mx-auto">
            {t("p_darkness.fade_p_pre")}{" "}
            <strong className="text-[#c8aa6e]">{t("p_darkness.fade_p_score")}</strong>{t("p_darkness.fade_p_post")}
          </p>
          {SACRE && (
            <Link
              href={`/era/${SACRE.id}`}
              className="inline-flex items-center gap-3 rounded-xl border border-[#c8aa6e]/50 bg-gradient-to-br from-[#c8aa6e]/10 to-[#785a28]/5 px-8 py-4 font-display text-sm font-bold uppercase tracking-[0.2em] text-[#c8aa6e] transition-all hover:border-[#c8aa6e] hover:shadow-[0_0_40px_rgba(200,170,110,0.2)]"
            >
              {t("p_darkness.cta_light")}
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          <p className="pt-10 font-data text-[10px] uppercase tracking-[0.3em] text-[#4a2424]">
            {t("p_darkness.never_forget")}
          </p>
        </section>

        {/* Subtle back-to-timeline */}
        <div className="text-center pt-12">
          <Link
            href="/#timeline"
            className="font-data text-[11px] uppercase tracking-widest text-[#5a3030] hover:text-[#9a5050] transition-colors"
          >
            {t("p_darkness.back_timeline")}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function DarkChapter({
  ordinal,
  period,
  title,
  subtitle,
  result,
  children,
}: {
  ordinal: string;
  period: string;
  title: string;
  subtitle: string;
  result: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline gap-4">
          <span
            className="font-display text-5xl md:text-6xl font-black text-[#2a0a10]"
            style={{ textShadow: "0 0 20px rgba(232, 64, 87, 0.2)" }}
          >
            {ordinal}
          </span>
          <span className="font-data text-[10px] uppercase tracking-[0.3em] text-[#7c5a3a]">
            {period}
          </span>
        </div>
        <h3 className="font-display text-3xl md:text-4xl font-black uppercase text-[#e8bfa5]">
          {title}
        </h3>
        <p className="font-display text-sm uppercase tracking-[0.25em] text-[#9a5050]">
          {subtitle} &middot;{" "}
          <span className="text-[#e84057]">{result}</span>
        </p>
      </header>
      <div className="space-y-5 text-base md:text-lg leading-relaxed text-[#a89090]">
        {children}
      </div>
    </section>
  );
}
