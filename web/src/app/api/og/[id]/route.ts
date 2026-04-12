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

  // Fallback: return a generic OG image or 404
  return new NextResponse("Not found", { status: 404 });
}
