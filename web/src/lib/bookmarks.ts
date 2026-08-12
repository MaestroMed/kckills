"use client";

/**
 * Client bookmark helper — single source of truth for the save flows.
 *
 * Audit 2026-07-02 (Vague 1) : the feed's save buttons wrote ONLY to
 * localStorage while /api/bookmarks + the kill_bookmarks table (057)
 * sat fully implemented — saves silently vanished across devices.
 * This helper wires both worlds :
 *
 *   - anonymous     → localStorage (`kc_bookmarks_v1`), same as before
 *   - authenticated → POST /api/bookmarks (toggle) + localStorage kept
 *                     in sync as the instant-read cache
 *   - first authed page view → one-time merge of the anonymous
 *     localStorage saves into the DB (the TODO documented in the route)
 *
 * All functions are best-effort : storage or network failures never
 * throw to the caller.
 *
 * Bruit API (audit 2026-08-12) : chaque page déclenchait un GET
 * /api/bookmarks → 401 pour les visiteurs anonymes (merge au montage
 * via LayoutChrome). Toute sollicitation de l'API est désormais gatée
 * par hasSupabaseSession() — lecture LOCALE de la session, zéro réseau
 * pour un anonyme, qui reste 100 % localStorage.
 */

const LS_KEY = "kc_bookmarks_v1";
const MERGED_FLAG = "kc_bookmarks_merged_v1";
const CHANGE_EVENT = "kc:bookmarks-changed";

/**
 * True quand une session Supabase existe côté navigateur.
 *
 * `auth.getSession()` lit le storage local (cookies) — AUCUN appel
 * réseau pour un visiteur anonyme — donc on peut court-circuiter avant
 * de solliciter /api/bookmarks. Import dynamique pour garder le client
 * Supabase hors du graphe synchrone (même précédent que la navbar).
 */
export async function hasSupabaseSession(): Promise<boolean> {
  try {
    const { createSupabaseBrowser } = await import("@/lib/supabase-browser");
    const { data } = await createSupabaseBrowser().auth.getSession();
    return data.session != null;
  } catch {
    return false; // Supabase non configuré — traité comme anonyme
  }
}

export function readLocalBookmarks(): Set<string> {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeLocalBookmarks(set: Set<string>): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify([...set].slice(-200)));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* storage disabled — best-effort */
  }
}

/**
 * Set a bookmark to a desired state. Updates localStorage immediately
 * (optimistic, works for anonymous users) then mirrors to the DB when
 * a session exists. The API is a TOGGLE, so we only call it when the
 * local state actually changes — after the one-time merge, local and
 * DB stay in lockstep.
 */
export function setBookmark(killId: string, on: boolean): void {
  const set = readLocalBookmarks();
  const had = set.has(killId);
  if (had === on) return; // no-op — also avoids mis-toggling the DB
  if (on) set.add(killId);
  else set.delete(killId);
  writeLocalBookmarks(set);

  // Miroir DB seulement quand une session existe — l'anonyme reste
  // 100 % localStorage (zéro requête, zéro 401 en console).
  void (async () => {
    try {
      if (!(await hasSupabaseSession())) return;
      await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kill_id: killId }),
        credentials: "same-origin",
      });
    } catch {
      /* offline — localStorage already updated */
    }
  })();
}

/**
 * One-time merge of anonymous localStorage saves into the DB after
 * sign-in. GETs the server list first (the POST is a toggle — blindly
 * POSTing an id that's already bookmarked would DELETE it), then
 * pushes only the missing ids. Flagged per-browser so it runs once.
 */
export async function mergeLocalBookmarksOnce(): Promise<void> {
  try {
    if (window.localStorage.getItem(MERGED_FLAG) === "1") return;
    // Session locale d'abord (lecture storage, pas de réseau) — un
    // anonyme ne sollicite JAMAIS l'API ; on retentera après login.
    if (!(await hasSupabaseSession())) return;
    const local = readLocalBookmarks();

    const res = await fetch("/api/bookmarks", { credentials: "same-origin" });
    if (res.status === 401) return; // session périmée côté serveur — retry next visit
    if (!res.ok) return;
    const body = (await res.json()) as { rows?: { kill_id: string }[] };
    const remote = new Set((body.rows ?? []).map((r) => r.kill_id));

    const missing = [...local].filter((id) => !remote.has(id));
    for (const kill_id of missing) {
      const r = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kill_id }),
        credentials: "same-origin",
      });
      if (!r.ok) return; // abort — retry the whole merge next visit
    }

    // Pull the merged truth back into the local cache so both
    // surfaces (long-press + sidebar) read a consistent state.
    const merged = new Set([...local, ...remote]);
    writeLocalBookmarks(merged);
    window.localStorage.setItem(MERGED_FLAG, "1");
  } catch {
    /* best-effort — next visit retries */
  }
}
