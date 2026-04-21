import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Hall of fame hidden until polished — alumni page covers it */
export default function HallRedirect() {
  redirect("/alumni");
}
