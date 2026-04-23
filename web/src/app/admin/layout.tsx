import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { HeartbeatPill } from "@/components/admin/HeartbeatPill";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * Admin layout — sidebar + top bar + activity rail.
 * Overrides the public LayoutChrome (which hides itself on /admin/*).
 *
 * SECURITY (PR-SECURITY-A) :
 *   - Calls requireAdmin() at the layout level so EVERY admin page child
 *     gets gated, even if the page itself forgets to call it. Belt &
 *     braces with the middleware cookie check.
 *   - On auth failure, redirects to /admin/login. The login page is
 *     excluded from this layout (it has its own minimal shell).
 *   - dynamic = "force-dynamic" prevents Next.js from statically
 *     pre-rendering admin pages (which would leak data to the CDN).
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Detect /admin/login via the x-pathname header set by middleware.ts
  // — the login page is the ONLY admin page that should render without
  // a valid auth context (otherwise we'd loop redirecting to itself).
  const h = await headers();
  const pathname = h.get("x-pathname") || "";
  const isLoginPage = pathname === "/admin/login" || pathname.startsWith("/admin/login/");

  if (!isLoginPage) {
    const auth = await requireAdmin();
    if (!auth.ok) {
      redirect("/admin/login");
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <AdminSidebar />

      {/* Top bar */}
      <header className="fixed top-0 left-60 right-0 xl:right-64 h-14 border-b border-[var(--border-gold)] bg-[var(--bg-surface)]/80 backdrop-blur-md z-30 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            Backoffice
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <HeartbeatPill />
        </div>
      </header>

      {/* Main content — account for sidebar (240px) + activity rail (256px on xl+) */}
      <main className="pl-60 xl:pr-64 pt-14">
        <div className="p-6 max-w-7xl">{children}</div>
      </main>

      <ActivityFeed />
    </div>
  );
}

export const metadata = {
  robots: { index: false, follow: false },
};
