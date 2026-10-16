import { redirect } from "next/navigation";

/** Le clip du jour se gère maintenant dans /admin/editorial (v20). */
export default function FeaturedPage() {
  redirect("/admin/editorial#clip-du-jour");
}
