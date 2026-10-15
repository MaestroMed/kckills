/**
 * Transition de route — recréé à chaque navigation.
 *
 * Fondu + légère montée (300 ms) en CSS pur (.route-enter, globals.css) :
 * l'animation part à la première peinture, sans attendre l'hydratation
 * (l'ancienne version Motion laissait la page à opacité 0 jusqu'à ce que
 * React prenne la main, ce qui masquait aussi l'ouverture de l'accueil).
 * fill-mode backwards : aucune transformation ne reste après la fin, donc
 * les éléments `fixed` (/scroll) se positionnent toujours sur la fenêtre.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-enter">{children}</div>;
}
