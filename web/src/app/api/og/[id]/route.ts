import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  pickAssetUrl,
  type KillAssetsManifest,
} from "@/lib/kill-assets";

/** Subset of the kills row this route projects. Mirrors the columns
 *  in the SELECT below — Supabase returns `unknown`, so we narrow
 *  here to keep `pickAssetUrl` calls type-safe. */
interface OgRow {
  og_image_url: string | null;
  thumbnail_url: string | null;
  assets_manifest: KillAssetsManifest | null;
}

/**
 * OG image redirect — /api/og/[kill_id]
 *
 * Instead of generating OG images on-the-fly (Satori/Vercel edge compute),
 * the worker pre-generates them via Pillow and uploads to R2. This route
 * is a simple 302 redirect to the R2 URL.
 *
 * Resolution chain (manifest-aware, migration 026) :
 *   1. assets_manifest.og_image.url  ← preferred, versioned
 *   2. og_image_url                  ← legacy column
 *   3. assets_manifest.thumbnail.url ← graceful degrade : Discord shows
 *                                      the clip thumbnail at least
 *   4. thumbnail_url                 ← legacy thumbnail column
 *   5. /images/hero-bg.jpg           ← generic site image, never 404s
 *
 * Steps 1 and 3 use `pickAssetUrl`, which also walks the legacy
 * columns internally — keeping the chain explicit here makes the
 * fallback hierarchy auditable.
 *
 * Zero compute cost on Vercel. CDN-cached by Cloudflare.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // Pull every column the resolution chain might need in one round-
  // trip. og_image_url + thumbnail_url back the legacy fallback,
  // assets_manifest backs the manifest-first path.
  const { data } = await supabase
    .from("kills")
    .select("og_image_url, thumbnail_url, assets_manifest")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  const origin = new URL(request.url).origin;

  if (data) {
    const row = data as unknown as OgRow;
    const ogUrl = pickAssetUrl(row, "og_image");
    if (ogUrl) {
      return NextResponse.redirect(ogUrl, 302);
    }
    // Step 3 — manifest may have a thumbnail even when the OG image
    // hasn't been generated yet. Better than burning a fallback when
    // we have a real frame from the clip.
    const thumbUrl = pickAssetUrl(row, "thumbnail");
    if (thumbUrl) {
      return NextResponse.redirect(thumbUrl, 302);
    }
  }

  // Step 5 — generic site OG fallback so social shares never render
  // a broken card while the worker backfills og_image_url. The
  // existing /images/hero-bg.jpg ships in /public — kept as the
  // canonical fallback (no synthetic og-fallback.png in the bundle).
  return NextResponse.redirect(`${origin}/images/hero-bg.jpg`, 302);
}
