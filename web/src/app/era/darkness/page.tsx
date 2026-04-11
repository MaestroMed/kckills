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

export const metadata: Metadata = {
  title: "L'ere sombre \u2014 KCKILLS",
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

export default function DarknessPage() {
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
            Page non referencee &middot; robots: noindex
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
            L&rsquo;ere
            <br />
            sombre
          </h1>
          <p className="mt-8 font-display text-xs md:text-sm uppercase tracking-[0.35em] text-[#9a3a3a]">
            Le chapitre qu&rsquo;on prefere oublier
          </p>
          <div className="mt-12 h-px w-40 bg-gradient-to-r from-transparent via-[#e84057]/40 to-transparent mx-auto" />
        </section>

        {/* OPENING */}
        <section className="space-y-6 text-lg md:text-xl leading-relaxed text-[#c4b0b0]">
          <p>
            En 2023, la Karmine Corp achetait le slot LEC d&rsquo;Astralis pour{" "}
            <strong className="text-[#e8bfa5]">129 millions de couronnes danoises</strong>,
            soit environ 15 millions d&rsquo;euros.
            <br />
            Kameto, devant les cameras, prononcait une phrase qui allait hanter le club :{" "}
            <em>&laquo; On vise le Championnat du Monde dans 5 a 10 ans. &raquo;</em>
          </p>
          <p>
            La KC Army retenait son souffle. Le slot venait d&rsquo;etre achete, le roster se construisait,
            le merchandising partait en rupture de stock. <strong className="text-[#e8bfa5]">Berlin</strong> attendait.
          </p>
          <p className="text-[#e84057] text-xl md:text-2xl font-display font-bold uppercase tracking-wide">
            Berlin n&rsquo;a pas ete clemente.
          </p>
        </section>

        {/* WINTER 2024 */}
        <DarkChapter
          ordinal="I."
          period="Winter 2024"
          title="Le choc culturel"
          subtitle="10e sur 10"
          result={WINTER?.result ?? "10e place"}
        >
          <p>
            Premier split LEC. Bo et Upset arrivent de Vitality et Fnatic, Cabochard tient le top lane,
            Saken reste au mid, Targamas au support. Caliste, pourtant present dans le pipeline, n&rsquo;a
            que 17 ans \u2014 la LEC exige 18. Il va dominer la LFL sur KCB pendant ce temps, en silence.
          </p>
          <p>
            Sur la scene principale, c&rsquo;est une leçon d&rsquo;humilite. KC termine{" "}
            <strong className="text-[#e84057]">dernier</strong>. Aucun playoff. Aucun momentum.
            Les casters francais parlent de &laquo; choc culturel &raquo; et de &laquo; temps
            d&rsquo;adaptation &raquo;. Les supporters veulent y croire.
          </p>
          <blockquote className="border-l-2 border-[#e84057]/40 pl-5 italic text-[#9a8080]">
            &laquo; On savait que ca serait dur. On ne savait pas que ca serait <em>ca</em>. &raquo;
          </blockquote>
        </DarkChapter>

        {/* SPRING 2024 */}
        <DarkChapter
          ordinal="II."
          period="Spring 2024"
          title="Le reverse sweep reverse"
          subtitle="Deux derniers rangs consecutifs"
          result={SPRING?.result ?? "10e place"}
        >
          <p>
            Le deuxieme split arrive avec la meme equipe, les memes espoirs, le meme discours sur
            &laquo; le temps qu&rsquo;il faut &raquo;. Puis, le meme verdict :{" "}
            <strong className="text-[#e84057]">dernier, encore</strong>. Deux splits, deux 10e places.
            Une premiere pour un club de cette taille.
          </p>
          <p>
            En playoffs, la KC Army retient son souffle une derniere fois. KC bat GIANTX, et accroche
            G2 en BO5. Menes <strong>0-2</strong>, les joueurs sortent de leurs tripes pour remonter a{" "}
            <strong>2-2</strong>. L&rsquo;atmosphere dans les live stream est electrique. On y croit.
            Vraiment, cette fois.
          </p>
          <p className="text-[#e84057] text-xl font-display font-bold">
            Game 5. KC s&rsquo;effondre.
          </p>
          <p>
            Reverse sweep reverse. Prime time, diffusion officielle, Kameto en larmes a la fin du match.
            Un message public aux fans, reconnaissant la profondeur de l&rsquo;echec. Ce soir-la,
            tout le monde comprend. Le statu quo est fini. La reconstruction doit etre totale.
          </p>
          <blockquote className="border-l-2 border-[#e84057]/40 pl-5 italic text-[#9a8080]">
            &laquo; Je vous demande pardon. On va tout changer. &raquo;
          </blockquote>
        </DarkChapter>

        {/* THE TURNING POINT */}
        <DarkChapter
          ordinal="III."
          period="2 mai 2024"
          title="La remise a zero"
          subtitle="Clean slate"
          result="Roster dissous"
        >
          <p>
            <strong className="text-[#e8bfa5]">Cabochard. Bo. Saken.</strong> Trois noms sur la bench
            list. Le communique KC tombe en debut de matinee, sec, sans fioritures. En l&rsquo;espace
            d&rsquo;un week-end, le roster qui portait la plus grosse fanbase d&rsquo;Europe est dissous.
          </p>
          <p>
            Trois semaines plus tard, une annonce fait trembler toute la scene LEC :{" "}
            <strong className="text-[#e8bfa5]">Canna</strong>, champion du monde 2020 avec T1,
            signe chez Karmine Corp. C&rsquo;est le premier import LCK majeur de l&rsquo;histoire du club,
            et l&rsquo;un des plus gros transferts de la LEC. <strong className="text-[#e8bfa5]">Closer</strong>{" "}
            suit depuis 100 Thieves. <strong className="text-[#e8bfa5]">Vladi</strong>, qui vient de
            remporter la LFL Spring sur KCB, est promu au mid.
          </p>
          <p>
            Summer 2024 : KC passe de dernier a <strong className="text-[#e8bfa5]">4e</strong> en un
            seul split. Premier playoff LEC gagne dans l&rsquo;histoire du club.
            L&rsquo;ombre recule, sans disparaitre tout a fait.
          </p>
        </DarkChapter>

        {/* FADE TO LIGHT */}
        <section className="space-y-10 text-center pt-16">
          <div className="h-px w-40 bg-gradient-to-r from-transparent via-[#e84057]/40 to-transparent mx-auto" />
          <p className="font-display text-sm uppercase tracking-[0.3em] text-[#7c5a3a]">
            Ce que l&rsquo;ere sombre a prepare
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
            Moins d&rsquo;un an plus tard, KC remportait sa premiere finale LEC{" "}
            <strong className="text-[#c8aa6e]">3-0 contre G2</strong>, devant 801 369 viewers.
            L&rsquo;ere sombre avait un sens.
          </p>
          {SACRE && (
            <Link
              href={`/era/${SACRE.id}`}
              className="inline-flex items-center gap-3 rounded-xl border border-[#c8aa6e]/50 bg-gradient-to-br from-[#c8aa6e]/10 to-[#785a28]/5 px-8 py-4 font-display text-sm font-bold uppercase tracking-[0.2em] text-[#c8aa6e] transition-all hover:border-[#c8aa6e] hover:shadow-[0_0_40px_rgba(200,170,110,0.2)]"
            >
              Retrouver la lumiere
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          <p className="pt-10 font-data text-[10px] uppercase tracking-[0.3em] text-[#4a2424]">
            La KC Army n&rsquo;oublie jamais
          </p>
        </section>

        {/* Subtle back-to-timeline */}
        <div className="text-center pt-12">
          <Link
            href="/#timeline"
            className="font-data text-[11px] uppercase tracking-widest text-[#5a3030] hover:text-[#9a5050] transition-colors"
          >
            &laquo; retour a la timeline officielle
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
