/**
 * Playlists du lecteur (accueil + scroll) éditées dans /admin/playlists.
 * Stockage : lib/admin/config-store (R2 `config/playlists.json`).
 * La playlist `bcc` (l'Antre) n'est pas éditable : elle vient toujours du code.
 */
import "server-only";
import { readConfig, writeConfig } from "@/lib/admin/config-store";
import {
  DEFAULT_PLAYLISTS,
  type BgmTrack,
  type EditablePlaylistId,
  type PlaylistId,
} from "@/lib/audio/playlists";

export interface StoredPlaylists {
  playlists: Record<PlaylistId, BgmTrack[]>;
  updatedAt: string;
}

export function isValidTrack(t: unknown): t is BgmTrack {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.id === "string"
    && typeof o.title === "string"
    && typeof o.artist === "string"
    && typeof o.youtubeId === "string"
    && /^[A-Za-z0-9_-]{11}$/.test(o.youtubeId)
    && typeof o.durationSeconds === "number"
    && o.durationSeconds > 0
    && typeof o.genre === "string"
  );
}

export function isValidEditablePlaylists(obj: unknown): obj is Record<EditablePlaylistId, BgmTrack[]> {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  for (const id of ["homepage", "scroll"] as EditablePlaylistId[]) {
    const list = o[id];
    if (!Array.isArray(list) || list.length > 100 || !list.every(isValidTrack)) return false;
  }
  return true;
}

/** Playlists enregistrées, sinon celles du code. */
export async function loadPlaylists(): Promise<StoredPlaylists> {
  const stored = await readConfig<StoredPlaylists>("playlists");
  if (stored?.playlists && isValidEditablePlaylists(stored.playlists)) {
    return {
      playlists: { ...DEFAULT_PLAYLISTS, ...stored.playlists, bcc: DEFAULT_PLAYLISTS.bcc },
      updatedAt: stored.updatedAt,
    };
  }
  return { playlists: { ...DEFAULT_PLAYLISTS }, updatedAt: new Date(0).toISOString() };
}

export async function savePlaylistsToStore(
  editable: Record<EditablePlaylistId, BgmTrack[]>,
): Promise<StoredPlaylists> {
  const next: StoredPlaylists = {
    playlists: { homepage: editable.homepage, scroll: editable.scroll, bcc: DEFAULT_PLAYLISTS.bcc },
    updatedAt: new Date().toISOString(),
  };
  await writeConfig("playlists", next);
  return next;
}
