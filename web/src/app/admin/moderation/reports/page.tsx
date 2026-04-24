import { ReportsQueue } from "./reports-queue";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reports — Admin",
  robots: { index: false, follow: false },
};

/**
 * /admin/moderation/reports
 *
 * Reads from the `reports` table (migration 032), groups by
 * (target_type, target_id) so 5 reports of the same kill render as a
 * single row with "5 reports" — the operator's mental model is
 * "what target needs my attention", not "what individual report".
 *
 * All data + actions live in the client component below ; the server
 * shell just enforces force-dynamic + no-index.
 */
export default function ReportsPage() {
  return <ReportsQueue />;
}
