import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware — protects /admin/* and /api/admin/*.
 *
 * Two acceptance paths:
 *   1. Cookie `kc_admin` matches `KCKILLS_ADMIN_TOKEN` env var
 *   2. (Server-side checked via requireAdmin() in route handlers)
 *      Discord OAuth user in KCKILLS_ADMIN_DISCORD_IDS allowlist
 *
 * Fail-closed in production : if neither KCKILLS_ADMIN_TOKEN nor
 * KCKILLS_ADMIN_DISCORD_IDS is set in a production environment, the
 * middleware DENIES every admin request. This prevents a misconfigured
 * Vercel deployment from silently exposing the backoffice.
 *
 * Local dev : NODE_ENV=development with no env vars = open access (the
 * historical behaviour that lets `pnpm dev` work without setup).
 *
 * To get an admin cookie:
 *   - Visit /admin/login?token=<KCKILLS_ADMIN_TOKEN>
 *   - The login route sets the kc_admin cookie (httpOnly, secure)
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only gate /admin/* and /api/admin/*
  const needsAuth =
    (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) &&
    pathname !== "/admin/login" &&
    pathname !== "/api/admin/login";

  // Always pass the pathname downstream so layouts can detect it
  // (used by the admin layout to skip the auth redirect on /admin/login).
  const passthroughHeaders = new Headers(request.headers);
  passthroughHeaders.set("x-pathname", pathname);

  if (!needsAuth) {
    return NextResponse.next({ request: { headers: passthroughHeaders } });
  }

  // Cache-Control: no-store on admin responses prevents the CDN from
  // ever serving an admin page from cache to an unauthenticated visitor.
  // Belt-and-braces with the per-page `dynamic = "force-dynamic"`.
  const noStore = (resp: NextResponse) => {
    resp.headers.set("Cache-Control", "no-store, max-age=0");
    return resp;
  };

  const expectedToken = process.env.KCKILLS_ADMIN_TOKEN;
  const allowedDiscordIds = (process.env.KCKILLS_ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isProduction = process.env.NODE_ENV === "production";

  // Production fail-closed : if no auth path is configured at all, refuse.
  // The handler-level requireAdmin() also checks Discord, so cookie-only
  // misconfig still allows Discord-OAuth admins through to the route
  // handler. But if BOTH are unset and we're in prod, deny every admin
  // request flat — better a broken backoffice than an open one.
  if (isProduction && !expectedToken && allowedDiscordIds.length === 0) {
    // Always deny — no redirect (no usable login path either).
    return new NextResponse("Admin access not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Dev fallback : no env vars, NODE_ENV != production -> allow.
  if (!expectedToken && allowedDiscordIds.length === 0) {
    return NextResponse.next({ request: { headers: passthroughHeaders } });
  }

  // Cookie token check — if the env is set and matches, allow.
  if (expectedToken) {
    const cookie = request.cookies.get("kc_admin")?.value;
    if (cookie === expectedToken) {
      return noStore(NextResponse.next({ request: { headers: passthroughHeaders } }));
    }
  }

  // For Discord OAuth path, the cookie is `sb-access-token` from Supabase
  // — we can't validate it in middleware (no DB call), so we let the
  // request through and rely on the per-handler requireAdmin() to block
  // unauthorised users. The handler check is THE security boundary
  // for Discord-only admins ; middleware is just the cookie short-circuit.
  if (allowedDiscordIds.length > 0) {
    return noStore(NextResponse.next({ request: { headers: passthroughHeaders } }));
  }

  // Cookie was set but no match, no Discord path configured — redirect
  // to login (preserves intended destination).
  if (pathname.startsWith("/api/admin")) {
    // API routes get a 401 with no-store header.
    return new NextResponse("Forbidden", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // PR-SECURITY-A : matcher now also covers /api/kills/edit + /api/bgm
  // — these were intentionally outside /api/admin/* but mutate sensitive
  // data and need the same gate.
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/kills/:id/edit",
    "/api/bgm",
  ],
};
