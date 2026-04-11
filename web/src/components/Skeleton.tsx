/**
 * Skeleton — Hextech loading placeholders.
 *
 * Applies the `skel-hextech` class (gold shimmer + cyan pulse) defined in
 * globals.css. Respects `prefers-reduced-motion` automatically.
 */

type BoxProps = {
  className?: string;
  width?: string;
  height?: string;
  rounded?: string;
};

function Box({ className = "", width, height, rounded = "rounded-md" }: BoxProps) {
  return (
    <div
      className={`skel-hextech ${rounded} ${className}`}
      style={{ width, height }}
    />
  );
}

export function SkeletonLine({ width = "100%", height = "16px" }: { width?: string; height?: string }) {
  return <Box width={width} height={height} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
      <div className="flex items-center gap-3">
        <Box className="h-10 w-10" rounded="rounded-full" />
        <div className="space-y-2 flex-1">
          <Box className="h-4 w-2/3" />
          <Box className="h-3 w-1/3" />
        </div>
      </div>
      <Box className="h-3 w-full" />
      <Box className="h-3 w-4/5" />
    </div>
  );
}

export function SkeletonMatchRow() {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center gap-4">
        <Box className="h-8 w-8" rounded="rounded-lg" />
        <Box className="h-3 w-4" />
        <Box className="h-8 w-8" rounded="rounded-lg" />
        <div className="space-y-2">
          <Box className="h-4 w-32" />
          <Box className="h-3 w-20" />
        </div>
      </div>
      <Box className="h-4 w-12" />
    </div>
  );
}

export function SkeletonPlayerCard() {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
      <Box className="h-48 w-full" rounded="rounded-none" />
      <div className="p-5 space-y-3">
        <Box className="h-5 w-1/2" />
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Box key={i} className="h-12" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkeletonScrollItem() {
  return (
    <div className="scroll-item bg-black flex flex-col justify-end">
      <div className="absolute inset-0 skel-hextech rounded-none" />
      <div className="relative z-10 px-5 pb-10 space-y-3">
        <Box className="h-4 w-20" />
        <Box className="h-6 w-48" />
        <Box className="h-3 w-36" />
        <Box className="h-12 w-full" rounded="rounded-xl" />
      </div>
    </div>
  );
}

/**
 * Kill card used in the scroll / top / player pages. 9:16 aspect,
 * gold frame and a faint play-glyph hint.
 */
export function SkeletonKillCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] aspect-[9/16]">
      <div className="absolute inset-0 skel-hextech rounded-none" />
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
        <Box className="h-4 w-16" />
        <Box className="h-4 w-10" />
      </div>
      <div className="absolute bottom-4 left-4 right-4 space-y-2">
        <Box className="h-4 w-3/4" />
        <Box className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/**
 * Leaderboard row used by /top. Rank badge on the left, stats on the right.
 */
export function SkeletonRankRow({ rank = 1 }: { rank?: number }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <Box className="h-10 w-10" rounded="rounded-lg" />
      <div className="flex-1 space-y-2">
        <Box className="h-4 w-40" />
        <Box className="h-3 w-24" />
      </div>
      <div className="flex items-center gap-3">
        <Box className="h-8 w-16" />
        <Box className="h-8 w-12" />
      </div>
    </div>
  );
}
