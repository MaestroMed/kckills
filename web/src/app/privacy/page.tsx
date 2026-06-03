import Link from "next/link";
import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server-lang";

export const metadata: Metadata = {
  title: "Politique de confidentialit\u00e9",
  description:
    "Politique de confidentialit\u00e9 de KCKILLS \u2014 z\u00e9ro tracking, z\u00e9ro cookies tiers, z\u00e9ro collecte de donn\u00e9es personnelles.",
};

export default async function PrivacyPage() {
  const { t } = await getServerT();
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">
          {t("p_pubpages.privacy_breadcrumb_home")}
        </Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>{t("p_pubpages.privacy_breadcrumb_current")}</span>
      </nav>

      <h1 className="font-display text-3xl font-bold">
        {t("p_pubpages.privacy_title_pre")}{" "}
        <span className="text-[var(--gold)]">{t("p_pubpages.privacy_title_accent")}</span>
      </h1>

      <div className="space-y-6 text-sm text-[var(--text-secondary)] leading-relaxed">
        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            {t("p_pubpages.privacy_collected_heading")}
          </h2>
          <p>
            {t("p_pubpages.privacy_collected_lead_pre")}{" "}
            <strong>{t("p_pubpages.privacy_collected_lead_strong")}</strong>{" "}
            {t("p_pubpages.privacy_collected_lead_post")}
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>{t("p_pubpages.privacy_collected_discord_strong")}</strong>{" "}
              {t("p_pubpages.privacy_collected_discord_body")}
            </li>
            <li>
              <strong>{t("p_pubpages.privacy_collected_riot_strong")}</strong>{" "}
              {t("p_pubpages.privacy_collected_riot_body")}
            </li>
            <li>
              <strong>{t("p_pubpages.privacy_collected_ratings_strong")}</strong>{" "}
              {t("p_pubpages.privacy_collected_ratings_body")}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            {t("p_pubpages.privacy_notcollected_heading")}
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>{t("p_pubpages.privacy_notcollected_email")}</li>
            <li>{t("p_pubpages.privacy_notcollected_password")}</li>
            <li>{t("p_pubpages.privacy_notcollected_ip")}</li>
            <li>{t("p_pubpages.privacy_notcollected_location")}</li>
            <li>{t("p_pubpages.privacy_notcollected_payment")}</li>
            <li>{t("p_pubpages.privacy_notcollected_cookies")}</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            {t("p_pubpages.privacy_cookies_heading")}
          </h2>
          <p>{t("p_pubpages.privacy_cookies_body")}</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            {t("p_pubpages.privacy_rights_heading")}
          </h2>
          <p>{t("p_pubpages.privacy_rights_lead")}</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>{t("p_pubpages.privacy_rights_export_strong")}</strong>{" "}
              {t("p_pubpages.privacy_rights_export_body")}{" "}
              <Link href="/settings" className="text-[var(--gold)] underline">
                {t("p_pubpages.privacy_rights_settings_link")}
              </Link>
              .
            </li>
            <li>
              <strong>{t("p_pubpages.privacy_rights_delete_strong")}</strong>{" "}
              {t("p_pubpages.privacy_rights_delete_body")}
            </li>
            <li>
              <strong>{t("p_pubpages.privacy_rights_contact_strong")}</strong>{" "}
              {t("p_pubpages.privacy_rights_contact_body")}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            {t("p_pubpages.privacy_hosting_heading")}
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              {t("p_pubpages.privacy_hosting_vercel_pre")}{" "}
              <strong>Vercel</strong> {t("p_pubpages.privacy_hosting_vercel_post")}
            </li>
            <li>
              {t("p_pubpages.privacy_hosting_supabase_pre")}{" "}
              <strong>Supabase</strong>{" "}
              {t("p_pubpages.privacy_hosting_supabase_post")}
            </li>
            <li>
              {t("p_pubpages.privacy_hosting_r2_pre")}{" "}
              <strong>Cloudflare R2</strong>{" "}
              {t("p_pubpages.privacy_hosting_r2_post")}
            </li>
            <li>{t("p_pubpages.privacy_hosting_headers")}</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">
            {t("p_pubpages.privacy_contact_heading")}
          </h2>
          <p>{t("p_pubpages.privacy_contact_body")}</p>
        </section>
      </div>

      <div className="gold-line" />
      <p className="text-[10px] text-[var(--text-disabled)] text-center">
        {t("p_pubpages.privacy_last_updated")}
      </p>
    </div>
  );
}
