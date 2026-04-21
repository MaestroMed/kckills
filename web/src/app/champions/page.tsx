import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Champions index — content moved into /clips filters */
export default function ChampionsRedirect() {
  redirect("/clips");
}
