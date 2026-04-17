import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * OG image redirect — /api/og/[kill_id]
 *
 * Instead of generating OG images on-the-fly (Satori/Vercel edge compute),
 * the worker pre-generates them via Pillow and uploads to R2. This route
 * is a simple 302 redirect to the R2 URL.
 *
 * Zero compute cost on Vercel. CDN-cached by Cloudflare.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("kills")
    .select("og_image_url")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  if (data?.og_image_url) {
    return NextResponse.redirect(data.og_image_url, 302);
  }

  // Fallback: generic site OG image rather than 404, so social shares never
  // render a broken card while the worker backfills og_image_url.
  const origin = new URL(_request.url).origin;
  return NextResponse.redirect(`${origin}/images/hero-bg.jpg`, 302);
}
