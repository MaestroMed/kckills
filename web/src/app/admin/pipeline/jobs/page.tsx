import { JobsQueue } from "./jobs-queue";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Job Queue — Admin",
  robots: { index: false, follow: false },
};

export default function JobsPage() {
  return <JobsQueue />;
}
