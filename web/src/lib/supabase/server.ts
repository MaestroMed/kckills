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
