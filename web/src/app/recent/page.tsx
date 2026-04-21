import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** "Recent" was a duplicate — /clips defaults to chronological */
export default function RecentRedirect() {
  redirect("/clips?sort=recent");
}
