/**
 * POST /api/admin/hero-videos/upload — direct multipart MP4 upload.
 *
 * Two paths :
 *   • Default — `multipart/form-data` with `file` + `title` + optional
 *     `context`/`tag`/`durationMs`/`audioVolume`. Server pipes to R2 via
 *     `uploadHeroVideo()` and registers the new HeroVideo. File size is
 *     capped at MAX_HERO_VIDEO_BYTES (60 MB) to stay well under the
 *     Vercel 100 MB request body limit.
 *
 *   • Presigned URL — append `?presign=1` and POST `{filename, contentType}`
 *     as JSON. Server returns `{uploadUrl, publicUrl, key, uuid}` so the
 *     client can PUT the file directly to R2 (bypasses the proxy limit ;
 *     handles videos >100 MB). Then the client POSTs the metadata back
 *     here without `?presign=1` and without a `file` field, supplying
 *     `videoUrl` directly.
 *
 * Every successful upload is logged to admin_actions with action
 * `hero.videos.upload` so we have a trail of who pushed which clip and
 * when.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";
import {
  loadHeroVideos,
  presignHeroVideoUpload,
  saveHeroVideos,
  uploadHeroVideo,
} from "@/lib/hero-videos/storage";
import {
  ALLOWED_HERO_VIDEO_MIMES,
  MAX_HERO_VIDEO_BYTES,
  MAX_HERO_VIDEOS,
  type HeroVideo,
  type HeroVideoTag,
} from "@/lib/hero-videos/types";

export const runtime = "nodejs";
// Allow up to 5 min for big uploads (Vercel default 10s isn't enough).
export const maxDuration = 300;

function clampVolume(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.8;
  return Math.max(0, Math.min(1, n));
}

function clampDuration(value: unknown, fallbackMs: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return Math.min(5 * 60 * 1000, Math.max(1000, Math.round(n)));
}

function normalizeTag(value: unknown): HeroVideoTag | undefined {
  if (typeof value !== "string") return undefined;
  if (["montage", "edit", "behind-scenes", "hype"].includes(value)) {
    return value as HeroVideoTag;
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const url = new URL(request.url);
  const isPresignRequest = url.searchParams.get("presign") === "1";

  // ── Path B : presigned URL ───────────────────────────────────────────
  if (isPresignRequest) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
    }
    const { filename, contentType } = (body ?? {}) as {
      filename?: unknown;
      contentType?: unknown;
    };
    if (
      typeof filename !== "string"
      || typeof contentType !== "string"
      || !ALLOWED_HERO_VIDEO_MIMES.includes(contentType as (typeof ALLOWED_HERO_VIDEO_MIMES)[number])
    ) {
      return NextResponse.json(
        {
          error: `filename et contentType requis (mp4 / quicktime). Types acceptés : ${ALLOWED_HERO_VIDEO_MIMES.join(", ")}.`,
        },
        { status: 400 },
      );
    }
    try {
      const result = await presignHeroVideoUpload(contentType, filename);
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Échec génération URL signée." },
        { status: 500 },
      );
    }
  }

  // ── Cap check before parsing the body (cheap early exit) ─────────────
  const existing = await loadHeroVideos();
  if (existing.length >= MAX_HERO_VIDEOS) {
    return NextResponse.json(
      {
        error: `Maximum ${MAX_HERO_VIDEOS} hero videos. Supprime-en une avant d'en ajouter.`,
      },
      { status: 400 },
    );
  }

  // ── Path A : multipart upload ────────────────────────────────────────
  const contentTypeHeader = request.headers.get("content-type") ?? "";
  if (!contentTypeHeader.startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "Content-Type doit être multipart/form-data." },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Body multipart illisible." },
      { status: 400 },
    );
  }

  const title = String(form.get("title") ?? "").trim();
  const context = String(form.get("context") ?? "").trim() || undefined;
  const tag = normalizeTag(form.get("tag"));
  const audioVolume = clampVolume(form.get("audioVolume"));
  // We accept either a real MP4 upload (file) OR a pre-uploaded videoUrl
  // (path B finalisation). At least one must be present.
  const file = form.get("file");
  const videoUrlField = form.get("videoUrl");
  const posterUrlField = form.get("posterUrl");
  const explicitDurationMs = clampDuration(form.get("durationMs"), 15000);

  if (!title) {
    return NextResponse.json({ error: "Titre requis." }, { status: 400 });
  }

  let videoUrl: string;
  let uploadedSize = 0;
  let uploadedContentType = "";
  let posterUrl: string | undefined =
    typeof posterUrlField === "string" && posterUrlField.length > 0
      ? posterUrlField
      : undefined;

  if (file && typeof file === "object" && "arrayBuffer" in file) {
    // Multipart upload — pipe to R2.
    const blob = file as Blob & { name?: string };
    const fileType = blob.type || "video/mp4";

    if (
      !ALLOWED_HERO_VIDEO_MIMES.includes(fileType as (typeof ALLOWED_HERO_VIDEO_MIMES)[number])
    ) {
      return NextResponse.json(
        {
          error: `Type de fichier non supporté (${fileType}). Accepté : ${ALLOWED_HERO_VIDEO_MIMES.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    if (blob.size > MAX_HERO_VIDEO_BYTES) {
      const cap = Math.round(MAX_HERO_VIDEO_BYTES / (1024 * 1024));
      return NextResponse.json(
        {
          error: `Fichier trop volumineux (${Math.round(blob.size / (1024 * 1024))} MB). Max ${cap} MB en upload direct — utilise l'URL signée pour les fichiers plus gros.`,
        },
        { status: 413 },
      );
    }

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    uploadedSize = buffer.byteLength;
    uploadedContentType = fileType;

    try {
      const filename = blob.name ?? "hero.mp4";
      const result = await uploadHeroVideo(buffer, fileType, filename);
      videoUrl = result.url;
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "Échec de l'upload vers R2.",
        },
        { status: 500 },
      );
    }
  } else if (typeof videoUrlField === "string" && /^https?:\/\//.test(videoUrlField)) {
    // Path B finalisation — file already pushed via presigned URL.
    videoUrl = videoUrlField;
    uploadedSize = Number(form.get("size") ?? 0) || 0;
    uploadedContentType = String(form.get("uploadedContentType") ?? "video/mp4");
  } else {
    return NextResponse.json(
      {
        error:
          "Aucun fichier fourni — envoie soit un champ multipart `file`, soit un `videoUrl` (après upload direct via presigned URL).",
      },
      { status: 400 },
    );
  }

  // Register the new HeroVideo at the END of the list (admin can re-order
  // afterwards via the editor).
  const now = new Date().toISOString();
  const newVideo: HeroVideo = {
    id: randomUUID(),
    title: title.slice(0, 200),
    context: context?.slice(0, 200),
    videoUrl,
    posterUrl,
    durationMs: explicitDurationMs,
    audioVolume,
    order: existing.length,
    tag,
    createdAt: now,
  };

  let saved: HeroVideo[];
  try {
    saved = await saveHeroVideos([...existing, newVideo]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Échec sauvegarde métadonnées." },
      { status: 500 },
    );
  }

  await logAdminAction({
    action: "hero.videos.upload",
    entityType: "hero_videos",
    entityId: newVideo.id,
    before: null,
    after: {
      id: newVideo.id,
      title: newVideo.title,
      videoUrl: newVideo.videoUrl,
      sizeBytes: uploadedSize,
      contentType: uploadedContentType,
    },
    notes: `${title} (${Math.round(uploadedSize / 1024)} KB)`,
    actorRole: deriveActorRole(admin),
    request,
  });

  return NextResponse.json({ ok: true, video: saved.find((v) => v.id === newVideo.id) });
}
