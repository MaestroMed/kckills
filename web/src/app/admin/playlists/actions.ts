"use server";

/**
 * Server Actions for /admin/playlists (Wave 18 — migrate fetch POST →
 * Server Action). Saves both wolf-player playlists (homepage + scroll)
 * to R2 (lib/audio/playlists-store) and audits the change.
 *
 * The legacy /api/admin/playlists POST/GET is KEPT — the GET hydrates
 * the editor on first load (still a fetch from the client, fine as
 * read-only) and external callers may still POST. Internal save now
 * skips the HTTP round-trip via direct action invocation.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";
import type { BgmTrack, EditablePlaylistId, PlaylistId } from "@/lib/audio/playlists";
import {
  isValidEditablePlaylists,
  loadPlaylists,
  savePlaylistsToStore,
} from "@/lib/audio/playlists-store";

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
  playlists:
    | Record<EditablePlaylistId, BgmTrack[]>
    | Record<PlaylistId, BgmTrack[]>,
): Promise<SavePlaylistsResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  if (!isValidEditablePlaylists(playlists)) {
    return {
      ok: false,
      error:
        "Body must be { homepage: BgmTrack[], scroll: BgmTrack[] } where each track has id/title/artist/youtubeId(11ch)/durationSeconds/genre.",
    };
  }

  const before = await loadPlaylists();
  let next;
  try {
    next = await savePlaylistsToStore(playlists as Record<EditablePlaylistId, BgmTrack[]>);
  } catch (err) {
    return { ok: false, error: `Enregistrement impossible : ${(err as Error).message}` };
  }

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
  revalidatePath("/api/playlists");
  // The wolf player reads playlists at request time so no extra path to
  // revalidate here, but homepage/scroll might cache the response.
  revalidatePath("/");
  revalidatePath("/scroll");
  return { ok: true, updatedAt: next.updatedAt };
}
