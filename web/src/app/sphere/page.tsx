import { redirect } from "next/navigation";

/** Sphere mode disabled — needs polish before re-enabling.
 *  Redirect to /scroll which is the core experience. */
export default function SphereDisabled() {
  redirect("/scroll");
}
