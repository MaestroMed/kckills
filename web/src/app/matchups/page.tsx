import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Matchups index — needs polish */
export default function MatchupsRedirect() {
  redirect("/clips");
}
