import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * When `cookies()` (and other dynamic-only APIs) are called during static
 * generation, Next.js throws a sentinel error tagged with this digest. We
 * MUST re-throw it instead of swallowing it in a catch — otherwise Next
 * can't detect the dynamic dependency and the route ends up half-rendered
 * statically with stale/missing data.
 *
 * Use in every server-side data-fetcher's catch:
 *   } catch (err) {
 *     rethrowIfDynamic(err);
 *     console.warn("[scope] foo threw:", err);
 *     return [];
 *   }
 */
export function rethrowIfDynamic(err: unknown): void {
  if (typeof err === "object" && err !== null && "digest" in err) {
    const digest = (err as { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith("DYNAMIC_SERVER_USAGE")) {
      throw err;
    }
    if (typeof digest === "string" && digest === "NEXT_REDIRECT") {
      throw err;
    }
    if (typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
      throw err;
    }
  }
}

/**
 * Cookie-less Supabase client safe to call from `generateStaticParams`,
 * sitemap.ts, and any other place that runs OUTSIDE a request scope.
 * Uses the anon key only — RLS still applies, so we can only read what
 * `Public kills` allows.
 */
export function createAnonSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

/**
 * Anon Supabase client whose GET/HEAD requests ride the Next.js Data
 * Cache (`next: { revalidate }`).
 *
 * Audit 2026-07-02 — the Wave 36 i18n rollout made every public page
 * dynamic (`getServerLang()` reads cookies()), which silently disabled
 * ISR sitewide: each visit re-ran every Supabase query. With thousands
 * of concurrent viewers during a stream, that alone can burn the 5 GB
 * egress free tier in minutes.
 *
 * This client restores the amortization at the DATA layer instead of
 * the page layer: identical PostgREST GETs are served from the shared
 * Data Cache for `revalidateSeconds`, so N visitors in the window cost
 * ONE Supabase read. Pages stay dynamic (i18n keeps working) but the
 * DB pressure returns to ~pre-Wave-36 levels.
 *
 * Only meaningful for PUBLIC reads (RLS `published`): for an anonymous
 * visitor this client is equivalent to `createServerSupabase()`, and
 * the rows it can see are identical for logged-in users too. Never use
 * it for user-scoped queries (comments by user, profiles, etc.).
 */
export function createCachedAnonSupabase(revalidateSeconds = 300) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const method = (init?.method ?? "GET").toUpperCase();
          if (method === "GET" || method === "HEAD") {
            return fetch(input, {
              ...init,
              next: { revalidate: revalidateSeconds },
            } as RequestInit);
          }
          return fetch(input, init);
        },
      },
    },
  );
}

/**
 * Service-role client — BYPASSES RLS. Server-only, never expose to the
 * client bundle. Returns null when the key isn't provisioned so callers
 * can degrade explicitly instead of crashing.
 *
 * Introduced by migration 083: user_events + reports no longer have
 * public INSERT policies, so /api/track and /api/report write through
 * this client (they already validate/sanitise inputs themselves).
 */
export function createServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component — can't set cookies
          }
        },
      },
    }
  );
}
