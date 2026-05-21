import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";
import { logAdminAction } from "@/lib/admin/audit";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/admin/login
 *
 * Body: { token: string }
 * Sets `kc_admin` httpOnly cookie containing a signed JWT (HS256) when the
 * submitted token matches `KCKILLS_ADMIN_TOKEN`. The cookie value is NOT
 * the master secret anymore — losing the cookie no longer leaks the env var.
 *
 * Hardening (Wave 34 T1.2) :
 *   (a) Per-IP rate limit : 5 attempts / 60s. Stops brute-force trickle.
 *   (b) `crypto.timingSafeEqual` on equal-length buffers. The previous
 *       `token !== expected` was vulnerable to remote timing attacks
 *       (early-exit string compare leaks the matching prefix length).
 *   (c) Cookie payload = HS256 JWT signed with KCKILLS_ADMIN_JWT_SECRET.
 *       Rotation = bump the secret, every existing cookie becomes invalid.
 *
 * Logs every attempt (success or failure) to admin_actions so we have
 * a forensic trail. Failed attempts use actor_label="anonymous" because
 * we don't know who they are yet.
 */

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Constant-time equality on two strings. Returns false when lengths
 * differ instead of feeding mismatched buffers to `timingSafeEqual`
 * (which throws on length mismatch — and the throw itself would be
 * a timing oracle).
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(request: NextRequest) {
  // (a) Rate-limit FIRST — before any token comparison or DB call.
  // 5 attempts / 60s / IP is generous for legitimate fat-finger
  // password retries and crushes any brute-force attempt.
  const limit = await rateLimit(request, "admin-login", { windowSec: 60, max: 5 });
  if (limit.blocked) return limit.response!;

  const { token } = await request.json().catch(() => ({ token: "" }));
  const expected = process.env.KCKILLS_ADMIN_TOKEN;
  const jwtSecret = process.env.KCKILLS_ADMIN_JWT_SECRET;

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

  // (b) Constant-time compare — guards against remote timing attacks.
  const submitted = typeof token === "string" ? token : "";
  if (!constantTimeEqual(submitted, expected)) {
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

  // (c) Sign a short JWT instead of echoing the master secret back as
  // a cookie. Without the JWT secret env, we can't issue a session —
  // refuse rather than fall back to the legacy plaintext cookie.
  if (!jwtSecret || jwtSecret.length < 32) {
    await logAdminAction({
      action: "auth.login.attempt",
      entityType: "auth",
      after: { success: false, reason: "jwt_secret_missing" },
      actorLabel: "anonymous",
      actorRole: "unknown",
      request,
    });
    return NextResponse.json(
      { error: "Server misconfigured — KCKILLS_ADMIN_JWT_SECRET missing or too short (need ≥32 chars)" },
      { status: 503 },
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + COOKIE_MAX_AGE_SECONDS)
    .sign(new TextEncoder().encode(jwtSecret));

  const res = NextResponse.json({ ok: true });
  res.cookies.set("kc_admin", jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
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
