import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** "Top" was a duplicate of /clips sorted by impressions */
export default function TopRedirect() {
  redirect("/clips?sort=impressions");
}
