import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** "Best" was a duplicate of /clips sorted by score */
export default function BestRedirect() {
  redirect("/clips?sort=score");
}
