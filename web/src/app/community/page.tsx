import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Community submissions disabled until moderation pipeline lands */
export default function CommunityRedirect() {
  redirect("/clips");
}
