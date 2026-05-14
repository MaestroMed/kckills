import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

/**
 * /api/admin/quotes/[id] — Wave 31d caster-quote moderation actions.
 *
 * Body :
 *   { action: 'hide' }                       → is_hidden = true
 *   { action: 'show' }                       → is_hidden = false
 *   { action: 'delete' }                     → DELETE FROM kill_quotes
 *   { action: 'edit', text: string }         → quote_text = text (trimmed)
 *   { action: 'set_memetic', value: bool }   → is_memetic = value
 *
 * Every action emits an admin_actions audit row.
 *
 * No "approve" verb because the AI quote extractor doesn't have a
 * moderation pipeline ; quotes are visible by default until hidden.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    text?: string;
    value?: boolean;
  };
  const action = body.action;

  const sb = await createServerSupabase();
  const { data: before } = await sb
    .from("kill_quotes")
    .select("id,quote_text,is_hidden,is_memetic,kill_id")
    .eq("id", id)
    .single();

  if (!before) {
    return NextResponse.json({ error: "quote not found" }, { status: 404 });
  }

  let patch: Record<string, unknown> | null = null;
  let isDelete = false;

  switch (action) {
    case "hide":
      patch = { is_hidden: true };
      break;
    case "show":
      patch = { is_hidden: false };
      break;
    case "delete":
      isDelete = true;
      break;
    case "edit": {
      const text = (body.text ?? "").toString().trim();
      if (text.length === 0) {
        return NextResponse.json(
          { error: "text must be non-empty" },
          { status: 400 },
        );
      }
      if (text.length > 500) {
        return NextResponse.json(
          { error: "text too long (max 500 chars)" },
          { status: 400 },
        );
      }
      patch = { quote_text: text };
      break;
    }
    case "set_memetic":
      if (typeof body.value !== "boolean") {
        return NextResponse.json(
          { error: "value must be boolean" },
          { status: 400 },
        );
      }
      patch = { is_memetic: body.value };
      break;
    default:
      return NextResponse.json(
        { error: `invalid action: ${action}` },
        { status: 400 },
      );
  }

  if (isDelete) {
    const { error } = await sb.from("kill_quotes").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logAdminAction({
      action: "quote.delete",
      entityType: "kill_quote",
      entityId: id,
      before,
      after: null,
      actorRole: deriveActorRole(admin),
      request: req,
    });
    return NextResponse.json({ ok: true });
  }

  const { error } = await sb.from("kill_quotes").update(patch!).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    action: `quote.${action}`,
    entityType: "kill_quote",
    entityId: id,
    before,
    after: patch,
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true });
}
