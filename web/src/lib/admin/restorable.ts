/**
 * Colonnes qu'une ligne du journal admin peut rejouer ou annuler.
 *
 * Les `before` / `after` du journal contiennent parfois des clés qui ne
 * sont pas des colonnes (job mis en file, date de mise en avant…) ou des
 * colonnes qu'il ne faut pas réécrire à la main : `status` déclenche le
 * recalcul de publication_status par trigger et peut dépublier un clip.
 */
export const RESTORABLE = {
  kills: [
    "ai_description", "fight_type", "ai_tags", "highlight_score", "kill_visible",
    "needs_reclip", "reclip_reason", "publication_status", "qc_status",
  ],
  players: ["ign", "real_name", "nationality", "image_url", "team_id", "role", "display_order"],
} as const;

export type RestorableTable = keyof typeof RESTORABLE;

export function tableForAction(action: string): RestorableTable | null {
  if (action.startsWith("kill.") && !action.startsWith("kill.bulk")) return "kills";
  if (action.startsWith("player.")) return "players";
  return null;
}

/**
 * Exception : annuler « marquer comme doublon » doit remettre `status` (et
 * le lien vers le kill conservé) ; le trigger republie alors le clip.
 */
const EXTRA_BY_ACTION: Record<string, string[]> = { "kill.mark_duplicate": ["status", "is_duplicate_of"] };

export function pickRestorable(table: RestorableTable, obj: unknown, action?: string): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {};
  const allowed = new Set<string>([...RESTORABLE[table], ...(action ? EXTRA_BY_ACTION[action] ?? [] : [])]);
  return Object.fromEntries(Object.entries(obj as Record<string, unknown>).filter(([k]) => allowed.has(k)));
}
