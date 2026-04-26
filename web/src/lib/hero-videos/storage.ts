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
 *      `web/.cache/hero-videos.json` metadata list. Mirrors the
 *      `/api/admin/playlists` pattern (single-operator, no concurrent
 *      writes — Mehdi-only for now).
 *
 * Future upgrade : promote the metadata to a `hero_videos` Supabase table
 * once multi-operator concurrent edits matter.
 */

import "server-only";

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  type HeroVideo,
  isHeroVideoList,
  MAX_HERO_VIDEOS,
} from "./types";

const STORAGE_PATH = path.join(process.cwd(), ".cache", "hero-videos.json");

interface StoredShape {
  videos: HeroVideo[];
  updatedAt: string;
}

// ─── R2 client ──────────────────────────────────────────────────────────

/** Lazily instantiated so the module can be imported in environments that
 *  don't have R2 configured (e.g. local dev without credentials).
 *  Throws a friendly error at first use if env vars are missing. */
let _s3Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (_s3Client) return _s3Client;

  // Accept both naming schemes :
  //   • Worker scheme (CLAUDE.md spec)  : R2_ACCOUNT_ID
  //   • Web scheme (web/.env.example)  : R2_ENDPOINT (full URL)
  const accountId = process.env.R2_ACCOUNT_ID;
  const explicitEndpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if ((!accountId && !explicitEndpoint) || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 storage non configuré — définis R2_ACCOUNT_ID (ou R2_ENDPOINT) + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY côté serveur.",
    );
  }

  const endpoint = explicitEndpoint
    ?? `https://${accountId}.r2.cloudflarestorage.com`;

  _s3Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: accessKeyId, secretAccessKey: secretAccessKey },
  });
  return _s3Client;
}

function getR2Bucket(): string {
  // Worker uses R2_BUCKET_NAME, web/.env.example uses R2_BUCKET — accept both.
  const bucket = process.env.R2_BUCKET_NAME ?? process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME (ou R2_BUCKET) non défini.");
  }
  return bucket;
}

function getR2PublicUrl(): string {
  // Worker uses R2_PUBLIC_URL ; web exposes the same value as
  // NEXT_PUBLIC_R2_PUBLIC_URL for client consumption — accept both.
  const url = process.env.R2_PUBLIC_URL ?? process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!url) {
    throw new Error("R2_PUBLIC_URL non défini (custom domain de R2, ex. https://clips.kckills.com).");
  }
  return url.replace(/\/+$/, "");
}

// ─── Slug helper ────────────────────────────────────────────────────────

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
  try {
    const raw = await readFile(STORAGE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as StoredShape;
    if (parsed?.videos && isHeroVideoList(parsed.videos)) {
      return [...parsed.videos].sort((a, b) => a.order - b.order);
    }
  } catch {
    // File missing or malformed — return empty list.
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

  // Normalise order to a contiguous 0..N-1 sequence.
  const sorted = [...videos]
    .sort((a, b) => a.order - b.order)
    .map((v, i) => ({ ...v, order: i }));

  await mkdir(path.dirname(STORAGE_PATH), { recursive: true });
  await writeFile(
    STORAGE_PATH,
    JSON.stringify(
      { videos: sorted, updatedAt: new Date().toISOString() } satisfies StoredShape,
      null,
      2,
    ),
    "utf-8",
  );

  return sorted;
}
