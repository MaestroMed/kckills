import { ClipsLibrary } from "./clips-library";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Clip Library — Admin",
  robots: { index: false, follow: false },
};

export default function ClipsPage() {
  // Client component does the fetching for instant filter updates
  return <ClipsLibrary />;
}
