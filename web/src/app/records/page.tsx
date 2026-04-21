import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Records page hidden until polished */
export default function RecordsRedirect() {
  redirect("/clips?sort=score");
}
