import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Blue Wall game minigame — disabled */
export default function GameRedirect() {
  redirect("/scroll");
}
