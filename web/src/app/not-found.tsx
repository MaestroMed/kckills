import Image from "next/image";
import Link from "next/link";
import { championSplashUrl } from "@/lib/constants";
import { getServerT } from "@/lib/i18n/getServerLang";

// Metadata uses the FR canonical strings — Next.js generates static
// metadata at build time, before per-request locale resolution. The
// in-page body still flips to the active locale at request time via
// getServerT() below.
export const metadata = {
  title: "404 — Page introuvable",
  description: "Cette page n'existe pas dans l'univers de la Karmine Corp.",
};

// Pick a random champion each time the page is deployed (stable per build)
const NOT_FOUND_CHAMPS = ["Jhin", "Yasuo", "Aphelios", "Kaisa", "Zed", "Ahri"];
const randomChamp = NOT_FOUND_CHAMPS[Math.floor(Math.random() * NOT_FOUND_CHAMPS.length)];

export default async function NotFound() {
  const { t } = await getServerT();
  return (
    <div className="-mx-4 -mt-6 relative min-h-[85vh] overflow-hidden flex items-center justify-center">
      {/* Full-screen champion splash background */}
      <Image
        src={championSplashUrl(randomChamp)}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-30 scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/70 to-[var(--bg-primary)]/40" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)]/60 via-transparent to-[var(--bg-primary)]/60" />

      {/* Scanline texture */}
      <div
        className="absolute inset-0 opacity-15 mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
        }}
      />

      {/* Gold accent radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 40% 30% at 50% 50%, rgba(200,170,110,0.15) 0%, transparent 60%)",
        }}
      />

      <div className="relative z-10 max-w-3xl w-full px-6 text-center">
        {/* Massive 404 */}
        <h1
          className="font-display font-black leading-none text-[10rem] md:text-[16rem] text-[var(--gold)]"
          style={{
            textShadow:
              "0 0 60px rgba(200,170,110,0.35), 0 4px 30px rgba(0,0,0,0.9)",
            letterSpacing: "-0.04em",
          }}
        >
          404
        </h1>

        {/* Subtitle */}
        <p className="font-display text-2xl md:text-4xl font-bold text-white mt-2 uppercase tracking-tight">
          {t("errors.not_found_title")}
        </p>

        <p className="text-base md:text-lg text-[var(--text-muted)] mt-6 max-w-xl mx-auto leading-relaxed">
          {t("errors.not_found_body")}
        </p>

        {/* CTAs */}
        <div className="mt-12 flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/"
            className="rounded-xl bg-[var(--gold)] px-8 py-4 font-display text-sm font-bold uppercase tracking-widest text-[var(--bg-primary)] transition-all hover:bg-[var(--gold-bright)] hover:shadow-2xl hover:shadow-[var(--gold)]/30 hover:scale-105 active:scale-95"
          >
            {t("errors.back_home")}
          </Link>
          <Link
            href="/scroll"
            className="rounded-xl border border-[var(--border-gold)] px-8 py-4 font-display text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)] transition-all hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
          >
            {t("errors.not_found_cta_clips")}
          </Link>
        </div>

        {/* Fun fact */}
        <p className="mt-16 text-xs text-[var(--text-disabled)] uppercase tracking-[0.25em]">
          GG WP &mdash; reconnect to base
        </p>
      </div>
    </div>
  );
}
