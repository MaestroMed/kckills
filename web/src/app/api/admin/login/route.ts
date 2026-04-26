import { NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin/audit";

/**
 * POST /api/admin/login
 *
 * Body: { token: string }
 * Sets `kc_admin` httpOnly cookie if token matches KCKILLS_ADMIN_TOKEN env.
 *
 * Logs every attempt (success or failure) to admin_actions so we have
 * a forensic trail of who tried to log in. Failed attempts use
 * actor_label="anonymous" because we don't know who they are yet.
 */
export async function POST(request: NextRequest) {
  const { token } = await request.json().catch(() => ({ token: "" }));
  const expected = process.env.KCKILLS_ADMIN_TOKEN;

  if (!expected) {
    // Dev mode — no token configured, refuse to set the cookie to avoid
    // confusing setups. Just signal success so dev users aren't stuck.
    await logAdminAction({
      action: "auth.login.attempt",
      entityType: "auth",
      after: { success: true, mode: "dev" },
      actorLabel: "dev",
      actorRole: "unknown",
      request,
    });
    return NextResponse.json({ ok: true, dev: true });
  }

  if (token !== expected) {
    await logAdminAction({
      action: "auth.login.attempt",
      entityType: "auth",
      after: { success: false, reason: "invalid_token" },
      actorLabel: "anonymous",
      actorRole: "unknown",
      request,
    });
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("kc_admin", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  await logAdminAction({
    action: "auth.login.attempt",
    entityType: "auth",
    after: { success: true, mode: "token" },
    actorLabel: "admin",
    actorRole: "token",
    request,
  });

  return res;
}

/** DELETE /api/admin/login — logout */
export async function DELETE(request: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("kc_admin");
  await logAdminAction({
    action: "auth.logout",
    entityType: "auth",
    actorLabel: "admin",
    actorRole: "token",
    request,
  });
  return res;
}
