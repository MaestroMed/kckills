import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique de confidentialit\u00e9",
  description:
    "Politique de confidentialit\u00e9 de KCKILLS \u2014 z\u00e9ro tracking, z\u00e9ro cookies tiers, z\u00e9ro collecte de donn\u00e9es personnelles.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">
          Accueil
        </Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>Confidentialit&eacute;</span>
      </nav>

      <h1 className="font-display text-3xl font-bold">
        Politique de <span className="text-[var(--gold)]">confidentialit&eacute;</span>
      </h1>

      <div className="space-y-6 text-sm text-[var(--text-secondary)] leading-relaxed">
        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            Donn&eacute;es collect&eacute;es
          </h2>
          <p>
            KCKILLS collecte le <strong>minimum absolu</strong> de donn&eacute;es
            n&eacute;cessaires au fonctionnement du site :
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>Connexion Discord</strong> : nom d&apos;utilisateur et avatar
              Discord (publics). Votre Discord ID est hash&eacute; SHA-256 et jamais
              stock&eacute; en clair.
            </li>
            <li>
              <strong>Connexion Riot (optionnelle)</strong> : PUUID hash&eacute;
              SHA-256, nom d&apos;invocateur et rang (publics).
            </li>
            <li>
              <strong>Ratings et commentaires</strong> : stock&eacute;s avec votre
              ID utilisateur pour &eacute;viter les doublons.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            Ce que nous ne collectons PAS
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Adresse email</li>
            <li>Mot de passe (authentification OAuth uniquement)</li>
            <li>Adresse IP</li>
            <li>Localisation g&eacute;ographique</li>
            <li>Donn&eacute;es de paiement</li>
            <li>Cookies tiers ou trackers publicitaires</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            Cookies
          </h2>
          <p>
            KCKILLS utilise uniquement un cookie de session Supabase Auth pour
            maintenir votre connexion Discord. Aucun cookie tiers, aucun tracker
            publicitaire, aucun analytics tiers.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            Vos droits (RGPD)
          </h2>
          <p>Vous pouvez &agrave; tout moment :</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>Exporter vos donn&eacute;es</strong> : depuis la page{" "}
              <Link href="/settings" className="text-[var(--gold)] underline">
                Param&egrave;tres
              </Link>
              .
            </li>
            <li>
              <strong>Supprimer votre compte</strong> : depuis la page
              Param&egrave;tres. Vos ratings sont anonymis&eacute;s, vos
              commentaires supprim&eacute;s.
            </li>
            <li>
              <strong>Nous contacter</strong> : par Discord ou &agrave;
              l&apos;adresse indiqu&eacute;e en bas de page.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            H&eacute;bergement et s&eacute;curit&eacute;
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Site h&eacute;berg&eacute; sur <strong>Vercel</strong> (HTTPS obligatoire)</li>
            <li>Base de donn&eacute;es sur <strong>Supabase</strong> (PostgreSQL + RLS)</li>
            <li>Clips vid&eacute;o sur <strong>Cloudflare R2</strong> (CDN mondial)</li>
            <li>
              Headers de s&eacute;curit&eacute; : CSP, HSTS, X-Frame-Options,
              X-Content-Type-Options
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            Contact
          </h2>
          <p>
            Pour toute question relative &agrave; vos donn&eacute;es personnelles,
            contactez-nous sur Discord ou via le site.
          </p>
        </section>
      </div>

      <div className="gold-line" />
      <p className="text-[10px] text-[var(--text-disabled)] text-center">
        Derni&egrave;re mise &agrave; jour : avril 2026
      </p>
    </div>
  );
}
