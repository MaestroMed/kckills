import "server-only";

/**
 * PostgREST plafonne chaque SELECT à 1 000 lignes (max-rows de Supabase),
 * sans erreur : un `.select()` sur une grosse table renvoie silencieusement
 * les 1 000 premières. C'est ce qui affichait « 171 clips KC publiés »
 * (au lieu de 5 587) et des compteurs de kills faux sur le roster.
 *
 * `fetchAll` relit la requête par pages de 1 000 jusqu'à la fin. Réservé à
 * l'admin (pages à faible trafic) : pour un simple total, préférer
 * `.select("id", { count: "exact", head: true })`.
 *
 *   const rows = await fetchAll((from, to) =>
 *     sb.from("kills").select("killer_player_id").order("id").range(from, to));
 *
 * La requête DOIT avoir un ordre stable (`.order("id")`), sinon des lignes
 * peuvent être lues deux fois ou sautées d'une page à l'autre.
 */
const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
