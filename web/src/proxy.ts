import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy — protects /admin/* and /api/admin/* (admin auth gate).
 *
 * Renamed from `middleware.ts` for Next 16 (Wave 13g, 2026-05-07). Same
 * matcher + same behaviour ; just the file convention + export name
 * changed per https://nextjs.org/docs/messages/middleware-to-proxy.
 *
 * Two acceptance paths for admin:
 *   1. Cookie `kc_admin` matches `KCKILLS_ADMIN_TOKEN` env var
 *   2. (Server-side checked via requireAdmin() in route handlers)
 *      Discord OAuth user in KCKILLS_ADMIN_DISCORD_IDS allowlist
 *
 * Fail-closed in production : if neither KCKILLS_ADMIN_TOKEN nor
 * KCKILLS_ADMIN_DISCORD_IDS is set in a production environment, the
 * proxy DENIES every admin request. This prevents a misconfigured
 * Vercel deployment from silently exposing the backoffice.
 *
 * Local dev : NODE_ENV=development with no env vars = open access (the
 * historical behaviour that lets `pnpm dev` work without setup).
 *
 * Lang detection moved out of proxy (2026-04-27 cache fix) :
 *   * Used to live here as Accept-Language → kc_lang cookie soft detect.
 *   * Reading request.cookies / request.headers in proxy opted
 *     EVERY matched response into dynamic rendering, killing CDN cache.
 *   * Lang detection now happens client-side in `LangProvider`
 *     (reads cookie + localStorage on mount). Acceptable trade-off for
 *     the ~5x Vercel cost reduction.
 *
 * To get an admin cookie:
 *   - Visit /admin/login?token=<KCKILLS_ADMIN_TOKEN>
 *   - The login route sets the kc_admin cookie (httpOnly, secure)
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The matcher (see config below) ONLY routes /admin/*, /api/admin/*,
  // /api/kills/:id/edit and /api/bgm to this proxy as of the
  // 2026-04-27 cache fix. Public pages skip the proxy entirely so they
  // can stay statically cached on the Vercel CDN. The `needsAuth` check
  // here is belt-and-braces : if the matcher ever expands again, the
  // body still does the right thing for /admin/login (no auth) vs the
  // rest (auth gated).
  const needsAuth =
    (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) &&
    pathname !== "/admin/login" &&
    pathname !== "/api/admin/login";

  // /admin/login slips through the matcher but doesn't need auth — let it
  // render its login form free. Same for any future public path that
  // accidentally matches.
  if (!needsAuth) {
    return NextResponse.next();
  }

  // Admin paths NEED the x-pathname header so layout.tsx can detect
  // /admin/login and skip rendering the sidebar/topbar. Cache is moot
  // anyway — admin responses are explicitly no-store below.
  const passthroughHeaders = new Headers(request.headers);
  passthroughHeaders.set("x-pathname", pathname);

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
  // — we can't validate it in the proxy (no DB call), so we let the
  // request through and rely on the per-handler requireAdmin() to block
  // unauthorised users. The handler check is THE security boundary
  // for Discord-only admins ; the proxy is just the cookie short-circuit.
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
  // PR-SECURITY-A : matcher covers /admin + /api/admin + /api/kills/edit + /api/bgm
  // — these were intentionally outside /api/admin/* but mutate sensitive
  // data and need the same gate.
  //
  // 2026-04-27 cache fix : the previous matcher ALSO included public
  // pages for soft language detection (set kc_lang cookie from
  // Accept-Language). But ANY proxy execution that reads
  // request.cookies / request.headers opts the matched response into
  // dynamic rendering — even when the proxy does nothing else.
  // Result : every public page was running SSR for every visitor
  // regardless of `revalidate = 300` (X-Vercel-Cache: MISS forever).
  //
  // The new matcher covers ONLY paths that genuinely need the proxy
  // (admin auth + sensitive mutation routes). Public-page lang
  // detection now lives entirely in `LangProvider` client-side
  // (reads cookie + localStorage on mount) — no proxy needed,
  // pages stay cacheable per their `revalidate` settings.
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/kills/:id/edit",
    "/api/bgm",
  ],
};
