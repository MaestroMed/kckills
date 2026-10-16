/**
 * Réglages éditables depuis l'admin (playlists, vidéos du hero…), stockés
 * en JSON sur R2 sous `config/<nom>.json`.
 *
 * Avant : fichiers dans `web/.cache/` écrits par writeFile. Sur Vercel le
 * système de fichiers est en lecture seule (sauf /tmp, éphémère et propre à
 * chaque instance) : les enregistrements de l'admin échouaient ou
 * disparaissaient au déploiement suivant.
 *
 * R2 plutôt qu'une table Supabase : zéro migration, zéro egress Supabase,
 * et ces réglages sont de toute façon publics (lus par le site).
 * Sans R2 configuré (dev local), repli sur `web/.cache/<nom>.json`.
 */
import "server-only";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { getR2Bucket, getR2Client, r2Configured } from "@/lib/r2-server";

export type ConfigName = "playlists" | "hero-videos" | "dedup-ignored" | "home-theme";

const key = (name: ConfigName) => `config/${name}.json`;
const localPath = (name: ConfigName) => path.join(process.cwd(), ".cache", `${name}.json`);

/** Lit un réglage ; `null` s'il n'a jamais été enregistré ou s'il est illisible. */
export async function readConfig<T>(name: ConfigName): Promise<T | null> {
  try {
    if (!r2Configured()) {
      return JSON.parse(await readFile(localPath(name), "utf-8")) as T;
    }
    const res = await getR2Client().send(new GetObjectCommand({ Bucket: getR2Bucket(), Key: key(name) }));
    const body = await res.Body?.transformToString("utf-8");
    return body ? (JSON.parse(body) as T) : null;
  } catch (err) {
    const code = (err as { name?: string; Code?: string })?.name ?? (err as { Code?: string })?.Code;
    if (code !== "NoSuchKey" && (err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`[config-store] lecture ${name} échouée :`, err);
    }
    return null;
  }
}

/** Enregistre un réglage (lève en cas d'échec : l'admin doit voir l'erreur). */
export async function writeConfig<T>(name: ConfigName, value: T): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  if (!r2Configured()) {
    await mkdir(path.dirname(localPath(name)), { recursive: true });
    await writeFile(localPath(name), json, "utf-8");
    return;
  }
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: key(name),
      Body: json,
      ContentType: "application/json; charset=utf-8",
      // Lu par le serveur, jamais servi tel quel par le CDN : pas de cache.
      CacheControl: "no-store",
    }),
  );
}
