/**
 * /admin/pipeline/run — One-click trigger panel for whitelisted backfills.
 *
 * Each button enqueues a `pipeline_jobs` row of kind 'worker.backfill'
 * with payload {script, args}. The worker-side admin_job_runner module
 * (modules/admin_job_runner.py) claims the job, validates the script
 * against its whitelist, and shells out via subprocess.run.
 *
 * The whitelist enforcement is SERVER-SIDE on the worker AND on the
 * API endpoint — the UI is a convenience layer. See the route handlers
 * under api/admin/pipeline/run/* for the per-endpoint validation.
 *
 * Distinct from /admin/pipeline/trigger which queues per-kill ad-hoc
 * actions (reanalyze_kill, regen_og, etc.) into the legacy worker_jobs
 * table. /run is for orchestration-level operator commands.
 */
import { RunPanel } from "./run-panel";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pipeline Run — Admin",
  robots: { index: false, follow: false },
};

export default function RunPage() {
  return <RunPanel />;
}
