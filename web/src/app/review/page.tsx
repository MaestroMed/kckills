import { redirect } from "next/navigation";

/** /review → /admin/clips (Phase 1 swap to new backoffice) */
export default function ReviewRedirect() {
  redirect("/admin/clips");
}
