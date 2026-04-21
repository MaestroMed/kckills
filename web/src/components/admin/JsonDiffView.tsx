"use client";

interface Props {
  before: unknown;
  after: unknown;
  className?: string;
}

/**
 * JsonDiffView — side-by-side before/after with field-level highlight.
 * Shows added, changed, removed keys with color coding.
 */
export function JsonDiffView({ before, after, className = "" }: Props) {
  const beforeObj = (typeof before === "object" && before !== null ? before : {}) as Record<string, unknown>;
  const afterObj = (typeof after === "object" && after !== null ? after : {}) as Record<string, unknown>;

  const allKeys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).sort();

  return (
    <div className={`grid grid-cols-2 gap-3 text-[10px] font-mono ${className}`}>
      <div>
        <p className="text-[var(--text-muted)] uppercase tracking-widest mb-1">Before</p>
        <pre className="rounded bg-[var(--bg-elevated)] p-2 overflow-x-auto whitespace-pre-wrap break-words">
          {allKeys.length === 0 && <span className="text-[var(--text-disabled)]">(empty)</span>}
          {allKeys.map((k) => {
            const v = beforeObj[k];
            const inAfter = k in afterObj;
            const changed = inAfter && JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k]);
            return (
              <div key={k} className={!inAfter ? "text-[var(--red)]" : changed ? "text-[var(--orange)]" : ""}>
                <span className="text-[var(--text-muted)]">{k}: </span>
                <span>{JSON.stringify(v)}</span>
              </div>
            );
          })}
        </pre>
      </div>
      <div>
        <p className="text-[var(--text-muted)] uppercase tracking-widest mb-1">After</p>
        <pre className="rounded bg-[var(--bg-elevated)] p-2 overflow-x-auto whitespace-pre-wrap break-words">
          {allKeys.length === 0 && <span className="text-[var(--text-disabled)]">(empty)</span>}
          {allKeys.map((k) => {
            const v = afterObj[k];
            const inBefore = k in beforeObj;
            const changed = inBefore && JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k]);
            return (
              <div key={k} className={!inBefore ? "text-[var(--green)]" : changed ? "text-[var(--orange)]" : ""}>
                <span className="text-[var(--text-muted)]">{k}: </span>
                <span>{JSON.stringify(v)}</span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
