import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/login
 *
 * Body: { token: string }
 * Sets `kc_admin` httpOnly cookie if token matches KCKILLS_ADMIN_TOKEN env.
 */
export async function POST(request: NextRequest) {
  const { token } = await request.json().catch(() => ({ token: "" }));
  const expected = process.env.KCKILLS_ADMIN_TOKEN;

  if (!expected) {
    // Dev mode — no token configured, refuse to set the cookie to avoid
    // confusing setups. Just signal success so dev users aren't stuck.
    return NextResponse.json({ ok: true, dev: true });
  }

  if (token !== expected) {
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
  return res;
}

/** DELETE /api/admin/login — logout */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("kc_admin");
  return res;
}
