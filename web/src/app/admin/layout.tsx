import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
import { AdminQuickActions } from "@/components/admin/AdminQuickActions";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * Admin layout — sidebar + topbar + main + activity rail.
 *
 * Server component shell that wraps every /admin/* route. Single auth
 * check at this layer so child pages don't have to remember to gate
 * themselves (defence-in-depth still keeps per-page requireAdmin()
 * calls in place — they're a no-op once we've already passed here).
 *
 * Layout structure :
 *   ┌─────────────┬───────────────────────────────────┐
 *   │             │ AdminTopbar (sticky)              │
 *   │ AdminSidebar├───────────────────────────────────┤
 *   │  (sticky)   │                                   │
 *   │             │ <children>                        │
 *   │             │                                   │
 *   └─────────────┴───────────────────────────────────┘
 *
 *   On mobile (<md) the sidebar is hidden ; AdminMobileNav renders the
 *   drawer that opens from the topbar hamburger.
 *
 * /admin/login is the ONE child that should NOT receive the chrome —
 * it has its own minimal centered shell. We detect it via the
 * `x-pathname` header set by middleware.ts (route group `(auth)/`
 * would also work but would require moving the existing login page
 * directory, which is gratuitous — header-based detection is one-line
 * and matches the pattern already used by the previous layout).
 *
 * SECURITY :
 *   - dynamic = "force-dynamic" : never cached at the CDN
 *   - fetchCache = "force-no-store" : same, applied to nested fetches
 *   - requireAdmin() at the top of the tree gates every sub-page
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const pathname = h.get("x-pathname") || "";
  const isLoginPage = pathname === "/admin/login" || pathname.startsWith("/admin/login/");

  // Login page renders without the admin chrome (so unauth users can
  // actually reach the login form). Returning a fragment lets the
  // login page own its own min-h-screen layout.
  if (isLoginPage) {
    return <>{children}</>;
  }

  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex">
      {/* Desktop sidebar — hidden on mobile (<md). The drawer below
          handles narrow screens. */}
      <AdminSidebar />

      {/* Main column — flex-col so topbar stays at the top and main
          flexes the rest. min-w-0 prevents long content from forcing
          a horizontal scroll on the whole layout. xl:pr-64 reserves
          space for the (fixed) ActivityFeed rail on xl+ screens. */}
      <div className="flex-1 min-w-0 flex flex-col xl:pr-64">
        <AdminTopbar />
        <main className="flex-1 overflow-x-hidden">
          <div className="p-4 md:p-6 max-w-7xl">{children}</div>
        </main>
      </div>

      {/* Right rail — desktop only (xl+). Activity feed is conditionally
          rendered ; on smaller screens it disappears entirely. */}
      <ActivityFeed />

      {/* Modal-ish overlays. Both are client components that mount
          window listeners ; rendering them at the layout level means
          they're available from every admin page. */}
      <AdminMobileNav />
      <AdminQuickActions />
    </div>
  );
}

export const metadata = {
  robots: { index: false, follow: false },
};
