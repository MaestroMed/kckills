"use client";

/**
 * PageViewTracker — fire-and-forget client component that emits a single
 * `page.viewed` event on mount.
 *
 * Designed to be placed inside an otherwise server-rendered page : it
 * adds no UI, no layout shift, no bundle weight beyond the tracker
 * library itself (which is shared with the rest of the app).
 *
 * Usage in a server component :
 *
 *     <PageViewTracker pageId="home" />
 *
 * Optional `metadata` lets a page enrich the event with safe context
 * (e.g. {locale: "fr"} on the homepage). The `/api/track` sanitiser
 * still strips PII server-side regardless of what's passed.
 */

import { useEffect } from "react";
import { track, type TrackMetadata } from "@/lib/analytics/track";

interface Props {
  pageId: string;
  metadata?: TrackMetadata;
}

export function PageViewTracker({ pageId, metadata }: Props) {
  useEffect(() => {
    track("page.viewed", {
      entityType: "page",
      entityId: pageId,
      metadata,
    });
    // Fire-and-forget — only on mount per page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
