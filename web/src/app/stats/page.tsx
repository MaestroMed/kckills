import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Stats page hidden until polished — admin/analytics serves data needs */
export default function StatsRedirect() {
  redirect("/players");
}
