/**
 * GET / POST / DELETE /api/admin/hero-videos
 *
 * Backoffice CRUD for the homepage hero video rotation. Mirrors the
 * `/api/admin/playlists` pattern (file-stored metadata, requireAdmin gate,
 * audit log on mutations).
 *
 * GET    — full list, no cache.
 * POST   — replace the whole list (used by the editor's "Sauvegarder l'ordre"
 *          button). Body : `{videos: HeroVideo[]}`. Validated strict.
 * DELETE — `?id=…` removes a single video from the list AND attempts to
 *          delete the underlying R2 object. Silent-fail on R2 (orphan
 *          blobs are cheaper than a broken admin flow).
 *
 * Every mutation logs to `admin_actions` with action `hero.videos.*` so
 * we can later replay who pushed which clip live.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";
import {
  deleteHeroVideoAsset,
  loadHeroVideos,
  saveHeroVideos,
} from "@/lib/hero-videos/storage";
import { isHeroVideoList, type HeroVideo } from "@/lib/hero-videos/types";

export const runtime = "nodejs";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const videos = await loadHeroVideos();
  return NextResponse.json(
    { videos },
    { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
  );
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const videosRaw = (body as { videos?: unknown }).videos;
  if (!isHeroVideoList(videosRaw)) {
    return NextResponse.json(
      {
        error:
          "Le body doit avoir la forme { videos: HeroVideo[] } avec id (uuid), title, videoUrl (https), durationMs (>0), audioVolume (0..1), order (number).",
      },
      { status: 400 },
    );
  }

  const before = await loadHeroVideos();

  let saved: HeroVideo[];
  try {
    saved = await saveHeroVideos(videosRaw);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur de sauvegarde." },
      { status: 400 },
    );
  }

  await logAdminAction({
    action: "hero.videos.update",
    entityType: "hero_videos",
    entityId: "default",
    before: before.map((v) => ({ id: v.id, order: v.order, title: v.title })),
    after: saved.map((v) => ({ id: v.id, order: v.order, title: v.title })),
    notes: `${saved.length} videos`,
    actorRole: deriveActorRole(admin),
    request,
  });

  return NextResponse.json({ ok: true, videos: saved });
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Le paramètre ?id=… est requis." },
      { status: 400 },
    );
  }

  const before = await loadHeroVideos();
  const target = before.find((v) => v.id === id);
  if (!target) {
    return NextResponse.json(
      { error: "Hero video introuvable." },
      { status: 404 },
    );
  }

  // Best-effort R2 delete — if it fails, we still drop the metadata entry.
  await deleteHeroVideoAsset(target.videoUrl);
  if (target.posterUrl) {
    await deleteHeroVideoAsset(target.posterUrl);
  }

  const next = before.filter((v) => v.id !== id);
  await saveHeroVideos(next);

  await logAdminAction({
    action: "hero.videos.delete",
    entityType: "hero_videos",
    entityId: id,
    before: { id: target.id, title: target.title, videoUrl: target.videoUrl },
    after: null,
    actorRole: deriveActorRole(admin),
    request,
  });

  return NextResponse.json({ ok: true });
}
