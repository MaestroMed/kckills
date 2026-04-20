import { redirect } from "next/navigation";

/** /scroll-v2 → /scroll (post-Phase 7 swap) */
export default function ScrollV2Redirect() {
  redirect("/scroll");
}
