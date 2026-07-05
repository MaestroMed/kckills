import type { Metadata } from "next";
import { CommunityClient } from "./community-client";

/**
 * /community — fan-submitted edits (Vague 2, audit 2026-07-05).
 *
 * This page redirected to /clips "until moderation pipeline lands" —
 * but /api/community/submit + the community_clips table + the
 * /admin/community moderation view have all existed for waves. The
 * only missing piece was this form (the API had ZERO callers).
 */
export const metadata: Metadata = {
  title: "Communauté",
  description:
    "Propose les meilleurs edits YouTube / TikTok de la communauté Karmine Corp.",
  alternates: { canonical: "/community" },
};

export default function CommunityPage() {
  return <CommunityClient />;
}
