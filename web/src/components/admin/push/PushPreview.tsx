"use client";

/**
 * PushPreview — 3 device-mockup chips showing how a push notification
 * will render on iOS / Android / Chrome desktop.
 *
 * Owned by Agent ED. Pure CSS / no images required (we use OS-typical
 * surface colors + radii + a tiny app-icon glyph). The shapes are
 * approximations — not pixel-perfect screenshots — but they convey :
 *
 *   - iOS               → pill-shaped, white frosted, rounded 22 px,
 *                         rounded square app icon, no body image
 *   - Android lockscreen→ left-aligned, dark surface, square icon
 *                         + chevron + "now", optional preview image right
 *   - Chrome desktop    → small rectangle, square 32 px icon top-left,
 *                         site origin label, body image stretched at
 *                         the bottom
 *
 * The preview accepts the same fields the form sends to the worker so
 * the editor sees exactly what their text will look like.
 */

import Image from "next/image";

interface Props {
  title: string;
  body: string;
  iconUrl?: string;
  imageUrl?: string;
  url?: string;
  /** Chip width — keeps the row consistent in the form sidebar. */
  className?: string;
}

const DEFAULT_TITLE = "Caliste → Faker";
const DEFAULT_BODY = "Outplay 1v2 dans la jungle adverse. 🔥";
const ORIGIN_LABEL = "loltok.kc";

export function PushPreview({
  title,
  body,
  iconUrl,
  imageUrl,
  url,
  className = "",
}: Props) {
  const t = title.trim() || DEFAULT_TITLE;
  const b = body.trim() || DEFAULT_BODY;

  return (
    <div className={`grid gap-3 sm:grid-cols-3 ${className}`}>
      <PreviewChip label="iOS">
        <IosPreview title={t} body={b} iconUrl={iconUrl} />
      </PreviewChip>
      <PreviewChip label="Android">
        <AndroidPreview title={t} body={b} iconUrl={iconUrl} imageUrl={imageUrl} />
      </PreviewChip>
      <PreviewChip label="Chrome desktop">
        <ChromePreview title={t} body={b} iconUrl={iconUrl} imageUrl={imageUrl} url={url} />
      </PreviewChip>
    </div>
  );
}

function PreviewChip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mb-1.5 text-center">
        {label}
      </p>
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-primary)] p-3 flex items-center justify-center min-h-[140px]">
        {children}
      </div>
    </div>
  );
}

/* ─── iOS chip ──────────────────────────────────────────────────────── */

function IosPreview({
  title,
  body,
  iconUrl,
}: {
  title: string;
  body: string;
  iconUrl?: string;
}) {
  return (
    <div className="w-full max-w-[220px] rounded-[22px] bg-white/95 backdrop-blur p-3 shadow-lg text-black">
      <div className="flex items-start gap-2.5">
        <AppIcon url={iconUrl} size={36} radius={8} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-[12px] truncate">{ORIGIN_LABEL}</span>
            <span className="text-[10px] text-gray-500 whitespace-nowrap">à l&apos;instant</span>
          </div>
          <p className="text-[12px] font-semibold mt-0.5 line-clamp-1">{title}</p>
          <p className="text-[11px] text-gray-700 mt-0.5 line-clamp-2">{body}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Android chip ──────────────────────────────────────────────────── */

function AndroidPreview({
  title,
  body,
  iconUrl,
  imageUrl,
}: {
  title: string;
  body: string;
  iconUrl?: string;
  imageUrl?: string;
}) {
  return (
    <div className="w-full max-w-[220px] rounded-2xl bg-[#1f1f1f] p-3 shadow-lg text-white">
      <div className="flex items-start gap-2.5">
        <AppIcon url={iconUrl} size={28} radius={6} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 text-[10px] text-gray-400">
            <span className="font-semibold text-gray-200 truncate">LoLTok</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">maintenant</span>
            <span className="ml-auto" aria-hidden="true">⌄</span>
          </div>
          <p className="text-[12px] font-semibold mt-0.5 line-clamp-1">{title}</p>
          <p className="text-[11px] text-gray-300 mt-0.5 line-clamp-2">{body}</p>
        </div>
        {imageUrl && (
          <div className="relative h-10 w-10 rounded-md overflow-hidden bg-black flex-shrink-0">
            {/* next/image needs known sizes to validate — tiny preview is fine */}
            <Image src={imageUrl} alt="" fill sizes="40px" className="object-cover" unoptimized />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Chrome desktop chip ───────────────────────────────────────────── */

function ChromePreview({
  title,
  body,
  iconUrl,
  imageUrl,
  url,
}: {
  title: string;
  body: string;
  iconUrl?: string;
  imageUrl?: string;
  url?: string;
}) {
  return (
    <div className="w-full max-w-[220px] rounded-md bg-[#2b2b2b] shadow-lg text-white overflow-hidden">
      <div className="p-2.5">
        <div className="flex items-start gap-2">
          <AppIcon url={iconUrl} size={32} radius={4} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold line-clamp-1">{title}</p>
            <p className="text-[10px] text-gray-300 mt-0.5 line-clamp-2">{body}</p>
            <p className="text-[9px] text-gray-500 mt-1 truncate">
              {url ? new URL(url, "https://loltok.kc").hostname : ORIGIN_LABEL}
            </p>
          </div>
        </div>
      </div>
      {imageUrl && (
        <div className="relative h-16 w-full bg-black">
          <Image src={imageUrl} alt="" fill sizes="220px" className="object-cover" unoptimized />
        </div>
      )}
    </div>
  );
}

/* ─── App icon (shared) ─────────────────────────────────────────────── */

function AppIcon({
  url,
  size,
  radius,
}: {
  url?: string;
  size: number;
  radius: number;
}) {
  if (url) {
    return (
      <div
        className="relative flex-shrink-0 overflow-hidden bg-black"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <Image src={url} alt="" fill sizes={`${size}px`} className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center font-display text-[10px] font-black text-black"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "linear-gradient(135deg, #C89B3C, #785A28)",
      }}
      aria-hidden="true"
    >
      KC
    </div>
  );
}
