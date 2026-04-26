/**
 * /admin/pipeline/jobs — Job browser entry point.
 *
 * Renders the client-side <JobsQueue /> wrapped in <Suspense> to satisfy
 * Next.js 15's requirement for routes that call useSearchParams() in a
 * client child of a server page.
 */
import { Suspense } from "react";
import { JobsQueue } from "./jobs-queue";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Job Queue — Admin",
  robots: { index: false, follow: false },
};

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-8 w-48 rounded bg-[var(--bg-elevated)] animate-pulse" />
          <div className="h-12 rounded bg-[var(--bg-elevated)] animate-pulse" />
          <div className="h-64 rounded bg-[var(--bg-elevated)] animate-pulse" />
        </div>
      }
    >
      <JobsQueue />
    </Suspense>
  );
}
