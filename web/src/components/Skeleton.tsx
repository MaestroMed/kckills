"use client";

export function SkeletonLine({ width = "100%", height = "16px" }: { width?: string; height?: string }) {
  return (
    <div
      className="rounded-md bg-[var(--bg-elevated)] animate-pulse"
      style={{ width, height }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[var(--bg-elevated)]" />
        <div className="space-y-2 flex-1">
          <div className="h-4 w-2/3 rounded bg-[var(--bg-elevated)]" />
          <div className="h-3 w-1/3 rounded bg-[var(--bg-elevated)]" />
        </div>
      </div>
      <div className="h-3 w-full rounded bg-[var(--bg-elevated)]" />
      <div className="h-3 w-4/5 rounded bg-[var(--bg-elevated)]" />
    </div>
  );
}

export function SkeletonMatchRow() {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-8 w-8 rounded-lg bg-[var(--bg-elevated)]" />
        <div className="h-3 w-4 rounded bg-[var(--bg-elevated)]" />
        <div className="h-8 w-8 rounded-lg bg-[var(--bg-elevated)]" />
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-[var(--bg-elevated)]" />
          <div className="h-3 w-20 rounded bg-[var(--bg-elevated)]" />
        </div>
      </div>
      <div className="h-4 w-12 rounded bg-[var(--bg-elevated)]" />
    </div>
  );
}

export function SkeletonPlayerCard() {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden animate-pulse">
      <div className="h-48 bg-[var(--bg-elevated)]" />
      <div className="p-5 space-y-3">
        <div className="h-5 w-1/2 rounded bg-[var(--bg-elevated)]" />
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded bg-[var(--bg-elevated)]" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkeletonScrollItem() {
  return (
    <div className="scroll-item bg-black flex flex-col justify-end animate-pulse">
      <div className="absolute inset-0 bg-[var(--bg-elevated)]/20" />
      <div className="relative z-10 px-5 pb-10 space-y-3">
        <div className="h-4 w-20 rounded bg-white/10" />
        <div className="h-6 w-48 rounded bg-white/10" />
        <div className="h-3 w-36 rounded bg-white/10" />
        <div className="h-12 w-full rounded-xl bg-white/5" />
      </div>
    </div>
  );
}
