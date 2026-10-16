import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { adminRouteDb } from "@/lib/admin/db";
import { deriveActorRole, logAdminAction } from "@/lib/admin/audit";
import { getR2Bucket, getR2Client, getR2PublicUrl } from "@/lib/r2-server";

/**
 * POST /api/admin/clips/[id]/thumbnail  (corps : image/jpeg, ≤ 2 Mo)
 * Envoie la vignette choisie sur R2 (`thumbs/<kill>/<horodatage>.jpg`, une
 * clé neuve à chaque fois : le CDN ne sert jamais l'ancienne) puis met à
 * jour kills.thumbnail_url. L'ancienne vignette reste sur R2 (annulable
 * depuis le journal).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  if (req.headers.get("content-type") !== "image/jpeg") return NextResponse.json({ error: "JPEG attendu" }, { status: 415 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return NextResponse.json({ error: "Image vide ou trop lourde (2 Mo max)" }, { status: 413 });
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return NextResponse.json({ error: "Ce n'est pas un JPEG" }, { status: 415 });

  const { data: before } = await g.sb.from("kills").select("thumbnail_url").eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Kill introuvable" }, { status: 404 });

  const key = `thumbs/${id}/${Date.now()}.jpg`;
  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
        Body: buf,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (err) {
    return NextResponse.json({ error: `Envoi sur R2 impossible : ${(err as Error).message}` }, { status: 502 });
  }
  const url = `${getR2PublicUrl()}/${key}`;
  const { error } = await g.sb.from("kills").update({ thumbnail_url: url, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    action: "kill.thumbnail",
    entityType: "kill",
    entityId: id,
    before,
    after: { thumbnail_url: url, at_seconds: Number(req.nextUrl.searchParams.get("t")) || null },
    actorRole: deriveActorRole(g.admin),
    request: req,
  });
  return NextResponse.json({ ok: true, url });
}
