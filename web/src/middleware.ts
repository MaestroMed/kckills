import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware — protects /admin/* and /api/admin/*.
 *
 * Two acceptance paths:
 *   1. Cookie `kc_admin` matches `KCKILLS_ADMIN_TOKEN` env var
 *   2. (Server-side checked via requireAdmin() in route handlers)
 *      Discord OAuth user in KCKILLS_ADMIN_DISCORD_IDS allowlist
 *
 * If KCKILLS_ADMIN_TOKEN env var is unset, middleware lets everything
 * through (dev mode). Set it on Vercel to lock down the backoffice.
 *
 * To get an admin cookie:
 *   - Visit /admin/login?token=<KCKILLS_ADMIN_TOKEN>
 *   - The login route sets the kc_admin cookie (httpOnly, secure)
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only gate /admin/* and /api/admin/*
  const needsAuth =
    pathname.startsWith("/admin") &&
    pathname !== "/admin/login";

  if (!needsAuth) return NextResponse.next();

  const expectedToken = process.env.KCKILLS_ADMIN_TOKEN;
  // Dev mode: no env var set → allow all
  if (!expectedToken) return NextResponse.next();

  const cookie = request.cookies.get("kc_admin")?.value;
  if (cookie === expectedToken) return NextResponse.next();

  // Redirect to login (preserves intended destination)
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
