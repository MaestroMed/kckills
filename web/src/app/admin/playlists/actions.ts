"use server";

/**
 * Server Actions for /admin/playlists (Wave 18 — migrate fetch POST →
 * Server Action). Saves both wolf-player playlists (homepage + scroll)
 * to the project-root JSON file and audits the change.
 *
 * The legacy /api/admin/playlists POST/GET is KEPT — the GET hydrates
 * the editor on first load (still a fetch from the client, fine as
 * read-only) and external callers may still POST. Internal save now
 * skips the HTTP round-trip via direct action invocation.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";
import {
  DEFAULT_PLAYLISTS,
  type BgmTrack,
  type PlaylistId,
} from "@/lib/audio/playlists";

const STORAGE_PATH = path.join(process.cwd(), ".cache", "playlists.json");

interface StoredShape {
  playlists: Record<PlaylistId, BgmTrack[]>;
  updatedAt: string;
}

function isValidTrack(t: unknown): t is BgmTrack {
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

function isValidPlaylists(obj: unknown): obj is Record<PlaylistId, BgmTrack[]> {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  for (const id of ["homepage", "scroll"] as PlaylistId[]) {
    if (!Array.isArray(o[id])) return false;
    if (!o[id].every(isValidTrack)) return false;
    if (o[id].length > 100) return false;
  }
  return true;
}

async function loadStored(): Promise<StoredShape> {
  try {
    const raw = await readFile(STORAGE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.playlists && isValidPlaylists(parsed.playlists)) {
      return parsed as StoredShape;
    }
  } catch {
    /* fall back to defaults */
  }
  return {
    playlists: { ...DEFAULT_PLAYLISTS },
    updatedAt: new Date(0).toISOString(),
  };
}

async function buildAuditRequest(): Promise<Request> {
  const h = await headers();
  const init: HeadersInit = {};
  const xff = h.get("x-forwarded-for");
  const xRealIp = h.get("x-real-ip");
  const ua = h.get("user-agent");
  if (xff) init["x-forwarded-for"] = xff;
  if (xRealIp) init["x-real-ip"] = xRealIp;
  if (ua) init["user-agent"] = ua;
  return new Request("https://kckills.com/admin/playlists", { headers: init });
}

export interface SavePlaylistsResult {
  ok: boolean;
  updatedAt?: string;
  error?: string;
}

export async function savePlaylists(
  playlists: Record<PlaylistId, BgmTrack[]>,
): Promise<SavePlaylistsResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  if (!isValidPlaylists(playlists)) {
    return {
      ok: false,
      error:
        "Body must be { homepage: BgmTrack[], scroll: BgmTrack[] } where each track has id/title/artist/youtubeId(11ch)/durationSeconds/genre.",
    };
  }

  const before = await loadStored();
  const next: StoredShape = {
    playlists,
    updatedAt: new Date().toISOString(),
  };

  try {
    await mkdir(path.dirname(STORAGE_PATH), { recursive: true });
  } catch {
    /* may already exist */
  }
  await writeFile(STORAGE_PATH, JSON.stringify(next, null, 2), "utf-8");

  const auditReq = await buildAuditRequest();
  await logAdminAction({
    action: "playlists.update",
    entityType: "audio_playlists",
    entityId: "default",
    before: before.playlists,
    after: next.playlists,
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath("/admin/playlists");
  // The wolf player reads playlists at request time so no extra path to
  // revalidate here, but homepage/scroll might cache the response.
  revalidatePath("/");
  revalidatePath("/scroll");
  return { ok: true, updatedAt: next.updatedAt };
}
