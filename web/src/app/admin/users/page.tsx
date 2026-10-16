import type { Metadata } from "next";
import { adminPageDb } from "@/lib/admin/db";
import { fetchAll } from "@/lib/admin/paginate";
import { UserRow } from "./user-row";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Utilisateurs — Admin", robots: { index: false, follow: false } };

interface Profile {
  id: string;
  discord_username: string | null;
  discord_avatar_url: string | null;
  riot_summoner_name: string | null;
  total_ratings: number | null;
  total_comments: number | null;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * /admin/users — comptes du site (connexion Discord). Pour une demande RGPD
 * reçue hors du site : export JSON ou effacement complet. Le site ne
 * stocke ni e-mail ni IP (CLAUDE.md §7.1) : on n'affiche que le pseudo.
 */
export default async function UsersPage() {
  const sb = await adminPageDb();
  const profiles = await fetchAll<Profile>((from, to) =>
    sb
      .from("profiles")
      .select("id, discord_username, discord_avatar_url, riot_summoner_name, total_ratings, total_comments, created_at, last_seen_at")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Utilisateurs</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          {profiles.length} compte(s). Une demande d&apos;accès ou d&apos;effacement reçue par Discord ou e-mail se traite ici ; les
          utilisateurs peuvent aussi le faire eux-mêmes dans leurs réglages.
        </p>
      </header>
      <div className="overflow-x-auto rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              <th className="px-3 py-2 font-normal">Pseudo</th>
              <th className="px-3 py-2 font-normal">Inscrit</th>
              <th className="px-3 py-2 font-normal">Vu</th>
              <th className="px-3 py-2 text-right font-normal">Notes</th>
              <th className="px-3 py-2 text-right font-normal">Commentaires</th>
              <th className="px-3 py-2 font-normal">RGPD</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <UserRow key={p.id} profile={p} />
            ))}
          </tbody>
        </table>
        {!profiles.length && <p className="p-6 text-center text-sm text-[var(--text-muted)]">Aucun compte.</p>}
      </div>
    </div>
  );
}
