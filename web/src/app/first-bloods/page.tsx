import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** First bloods now lives as a filter on /clips */
export default function FirstBloodsRedirect() {
  redirect("/clips?fb=1");
}
