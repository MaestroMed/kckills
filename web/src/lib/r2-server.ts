/**
 * Client Cloudflare R2 côté serveur (S3v4). SERVER-ONLY.
 *
 * Variables : R2_ENDPOINT (ou R2_ACCOUNT_ID), R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET (ou R2_BUCKET_NAME), et l'URL publique
 * R2_PUBLIC_URL / NEXT_PUBLIC_R2_PUBLIC_URL (ex. https://clips.kckills.com).
 */
import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | null = null;

export function r2Configured(): boolean {
  return Boolean(
    (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID)
      && process.env.R2_ACCESS_KEY_ID
      && process.env.R2_SECRET_ACCESS_KEY
      && (process.env.R2_BUCKET || process.env.R2_BUCKET_NAME),
  );
}

export function getR2Client(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 non configuré — définis R2_ENDPOINT (ou R2_ACCOUNT_ID), R2_ACCESS_KEY_ID et R2_SECRET_ACCESS_KEY côté serveur.",
    );
  }
  client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
  return client;
}

export function getR2Bucket(): string {
  const bucket = process.env.R2_BUCKET_NAME ?? process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET (ou R2_BUCKET_NAME) non défini.");
  return bucket;
}

export function getR2PublicUrl(): string {
  const url = process.env.R2_PUBLIC_URL ?? process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!url) throw new Error("R2_PUBLIC_URL non défini (domaine public de R2, ex. https://clips.kckills.com).");
  return url.replace(/\/+$/, "");
}
