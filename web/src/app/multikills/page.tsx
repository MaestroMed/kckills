import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Multi-kills now lives as a filter on /clips */
export default function MultikillsRedirect() {
  redirect("/clips?multi=1");
}
