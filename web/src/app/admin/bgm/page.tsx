import { BgmEditor } from "./bgm-editor";
import { DEFAULT_PLAYLIST } from "@/lib/scroll/bgm-playlist";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "BGM Playlist — Admin",
  robots: { index: false, follow: false },
};

export default async function BgmPage() {
  // Read current playlist via the existing /api/bgm route (or fall back to default)
  let initial = DEFAULT_PLAYLIST;
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/bgm`, { cache: "no-store" });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) initial = data;
    }
  } catch {
    // fall through to default
  }
  return <BgmEditor initial={initial} />;
}
