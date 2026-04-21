import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Compare page hidden until polished */
export default function CompareRedirect() {
  redirect("/players");
}
