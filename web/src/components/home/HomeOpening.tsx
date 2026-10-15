/**
 * Ouverture de l'accueil — 2,3 s, une fois par session.
 *
 *   nuit KC → un filet d'or s'ouvre au centre → les blasons glissent l'un vers
 *   l'autre (KC à gauche, l'adversaire à droite un jour de match ; KC seul et
 *   le mot KCKILLS sinon) → éclat → le rideau se fend le long du filet et
 *   découvre le hero, dont les éléments entrent en cascade.
 *
 * Tout est en CSS (transform, opacity, clip-path) : l'animation part dès la
 * première peinture, sans attendre React. Le script INTRO_SCRIPT (posé dans
 * <head> par app/layout.tsx, avant la page) règle <html data-intro> :
 *   · déjà vue dans la session, ou mouvement réduit demandé → "seen" (rien) ;
 *   · première arrivée sur l'accueil → "play" (rideau + cascade du hero).
 * OpeningControl (client) gère le passage (clic, touche) et la fin (2,6 s).
 * Sans JavaScript, le rideau joue quand même et s'efface seul (fill-mode).
 */
import type { HomeTheme } from "@/lib/home-themes";
import { OpeningControl } from "./OpeningControl";

/** Script de <head> (app/layout.tsx, next/script beforeInteractive). */
export const INTRO_SCRIPT = `(function(){var d=document.documentElement,k="kc-intro";try{if(sessionStorage.getItem(k)||matchMedia("(prefers-reduced-motion: reduce)").matches){d.dataset.intro="seen";return}if(location.pathname==="/"){sessionStorage.setItem(k,"1");d.dataset.intro="play"}}catch(e){}})();`;


export function HomeOpening({ theme }: { theme: HomeTheme }) {
  const s = theme.spotlight;
  return (
    <>
      <div
        id="kc-opening"
        aria-hidden
        className={s ? "op op--match" : "op op--home"}
        style={{
          ["--op-primary" as string]: theme.palette.primary,
          ["--op-accent" as string]: theme.palette.accent,
          ["--op-rival" as string]: theme.palette.rival ?? theme.palette.accent,
        }}
      >
        <div className="op-half op-half--top" />
        <div className="op-half op-half--bottom" />
        <div className="op-line" />
        <div className="op-flash" />
        <div className="op-stage">
          {s ? (
            <>
              <div className="op-row">
                <span className="op-crest op-crest--home">
                  {/* eslint-disable-next-line @next/next/no-img-element -- peint avant React, pas de next/image ici */}
                  <img src="/images/teams/KC.png" alt="" width={84} height={84} />
                </span>
                <span className="op-vs">VS</span>
                <span className="op-crest op-crest--away">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.opponentLogo} alt="" width={84} height={84} />
                </span>
              </div>
              <p className="op-meta">
                {s.competition} · {s.stage}
              </p>
            </>
          ) : (
            <>
              <span className="op-crest op-crest--home op-crest--solo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/teams/KC.png" alt="" width={84} height={84} />
              </span>
              <p className="op-word">KCKILLS</p>
            </>
          )}
        </div>
      </div>
      <OpeningControl />
    </>
  );
}
