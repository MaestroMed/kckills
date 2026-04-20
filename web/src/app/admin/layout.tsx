import type { ReactNode } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { HeartbeatPill } from "@/components/admin/HeartbeatPill";
import { ActivityFeed } from "@/components/admin/ActivityFeed";

/**
 * Admin layout — sidebar + top bar + activity rail.
 * Overrides the public LayoutChrome (which hides itself on /admin/*).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
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
