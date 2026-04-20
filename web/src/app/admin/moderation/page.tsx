import { ModerationQueue } from "./moderation-queue";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Moderation — Admin",
  robots: { index: false, follow: false },
};

export default function ModerationPage() {
  return <ModerationQueue />;
}
