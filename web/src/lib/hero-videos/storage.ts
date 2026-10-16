/**
 * Hero videos — server-side R2 + local-file persistence helpers.
 *
 * SERVER-ONLY. Imports `@aws-sdk/client-s3` and reads R2_* env vars; never
 * exposed to the client bundle.
 *
 * Two responsibilities :
 *   1. `uploadHeroVideo(...)` — pipes a Buffer to Cloudflare R2 (S3v4
 *      compatible) and returns the public URL on success. Used by
 *      /api/admin/hero-videos/upload (path A — direct multipart).
 *   2. `loadHeroVideos()` / `saveHeroVideos()` — reads/writes the
 *      metadata list on R2 (`config/hero-videos.json`, lib/admin/config-store). Mirrors the
 *      `/api/admin/playlists` pattern (single-operator, no concurrent
 *      writes — Mehdi-only for now).
 *
 * Future upgrade : promote the metadata to a `hero_videos` Supabase table
 * once multi-operator concurrent edits matter.
 */

import "server-only";

import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getR2Bucket, getR2Client, getR2PublicUrl } from "@/lib/r2-server";
import { readConfig, writeConfig } from "@/lib/admin/config-store";
import {
  type HeroVideo,
  isHeroVideoList,
  MAX_HERO_VIDEOS,
} from "./types";


interface StoredShape {
  videos: HeroVideo[];
  updatedAt: string;
}

// ─── R2 client ──────────────────────────────────────────────────────────

/** Slugify a filename — keep extension, ASCII only, lowercased, hyphenated.
 *  Falls back to "video.mp4" if the input is empty after sanitisation. */
function slugifyFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "mp4";
  const slug = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const safeSlug = slug || "video";
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "mp4";
  return `${safeSlug}.${safeExt}`;
}

// ─── R2 upload ──────────────────────────────────────────────────────────

/**
 * Upload a hero video buffer to Cloudflare R2.
 *
 * Layout : `hero/{uuid}/{slugified-filename}` so each video has its own
 * prefix and we can later co-locate a poster image (`hero/{uuid}/poster.jpg`).
 *
 * Cache-Control : `public, max-age=31536000, immutable` — videos never
 * change after upload (a new upload gets a new UUID). Long TTL = best CDN
 * behaviour, zero re-validation traffic.
 *
 * @param file       — raw bytes of the video
 * @param contentType— MIME (must be in ALLOWED_HERO_VIDEO_MIMES, validated by caller)
 * @param filename   — original filename, used for the slug
 * @returns the public URL of the uploaded asset
 */
export async function uploadHeroVideo(
  file: Buffer,
  contentType: string,
  filename: string,
): Promise<{ url: string; key: string; uuid: string }> {
  const client = getR2Client();
  const bucket = getR2Bucket();
  const publicUrl = getR2PublicUrl();

  const uuid = randomUUID();
  const slug = slugifyFilename(filename);
  const key = `hero/${uuid}/${slug}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return {
    url: `${publicUrl}/${key}`,
    key,
    uuid,
  };
}

/**
 * Generate a presigned PUT URL so the client can upload directly to R2,
 * bypassing the Vercel proxy 100 MB limit. Returned URL is single-use,
 * expires in 5 minutes.
 *
 * Path B of the upload route — heavier setup but supports >100 MB files.
 */
export async function presignHeroVideoUpload(
  contentType: string,
  filename: string,
): Promise<{ uploadUrl: string; publicUrl: string; key: string; uuid: string }> {
  const client = getR2Client();
  const bucket = getR2Bucket();
  const publicUrl = getR2PublicUrl();

  const uuid = randomUUID();
  const slug = slugifyFilename(filename);
  const key = `hero/${uuid}/${slug}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });

  return {
    uploadUrl,
    publicUrl: `${publicUrl}/${key}`,
    key,
    uuid,
  };
}

/**
 * Best-effort delete of an R2 object. Silent-fail — if the asset is
 * already gone or the credentials don't have delete perms, we still
 * remove the metadata entry. Never block the admin operation on this.
 */
export async function deleteHeroVideoAsset(videoUrl: string): Promise<void> {
  try {
    const publicUrl = getR2PublicUrl();
    if (!videoUrl.startsWith(publicUrl)) {
      // Not one of ours (legacy / external) — skip the delete.
      return;
    }
    const key = videoUrl.slice(publicUrl.length + 1); // strip leading "/"
    const client = getR2Client();
    const bucket = getR2Bucket();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    // Silent-fail — orphan blobs are cheaper than a broken admin flow.
  }
}

// ─── Local-file metadata persistence ────────────────────────────────────

/**
 * Read the metadata list from disk. Returns an empty list on first-run
 * (file missing) or if the file is malformed (defensive parse).
 *
 * The list is always returned sorted by `order` ascending so callers
 * don't have to repeat the sort.
 */
export async function loadHeroVideos(): Promise<HeroVideo[]> {
  const parsed = await readConfig<StoredShape>("hero-videos");
  if (parsed?.videos && isHeroVideoList(parsed.videos)) {
    return [...parsed.videos].sort((a, b) => a.order - b.order);
  }
  return [];
}

/**
 * Write the metadata list to disk. Validates + caps the list, normalises
 * the `order` field to a contiguous 0..N-1 sequence so the UI never has
 * to deal with floating-point fudge.
 *
 * Throws on validation failure — caller (route handler) should catch and
 * return a 400.
 */
export async function saveHeroVideos(videos: HeroVideo[]): Promise<HeroVideo[]> {
  if (!isHeroVideoList(videos)) {
    throw new Error("Liste de hero videos invalide (validation échouée).");
  }
  if (videos.length > MAX_HERO_VIDEOS) {
    throw new Error(`Trop de hero videos — maximum ${MAX_HERO_VIDEOS}.`);
  }
  // Vidéos et posters servis par notre R2 uniquement : le hero de l'accueil
  // ne doit jamais charger un média d'un domaine tiers.
  const r2 = getR2PublicUrl();
  const ours = (u: string | undefined) => !u || u.startsWith(`${r2}/`);
  const foreign = videos.find((v) => !ours(v.videoUrl) || !ours(v.posterUrl));
  if (foreign) {
    throw new Error(`« ${foreign.title} » : la vidéo et le poster doivent être hébergés sur ${r2}.`);
  }

  // Normalise order to a contiguous 0..N-1 sequence.
  const sorted = [...videos]
    .sort((a, b) => a.order - b.order)
    .map((v, i) => ({ ...v, order: i }));

  await writeConfig("hero-videos", { videos: sorted, updatedAt: new Date().toISOString() } satisfies StoredShape);

  return sorted;
}
