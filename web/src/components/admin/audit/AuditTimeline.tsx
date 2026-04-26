"use client";

/**
 * AuditTimeline — vertical chronological view of admin actions
 * (PR-loltok EE).
 *
 * Time axis on the left (HH:MM grouped by hour), events on the right
 * with actor + action + entity. Events that land within the same
 * 5-minute bucket collapse into a single "burst" with a count badge so
 * a rapid bulk-edit doesn't drown the timeline.
 *
 * Burst grouping algorithm :
 *   1. Sort events ascending by created_at within each hour bucket.
 *   2. Walk the list ; if (current.created_at - last.created_at) < 5min
 *      AND (actor + action_category) match, merge into the previous
 *      burst (count++, latest_at update).
 *   3. Otherwise start a new burst.
 *
 * The 5-minute window is small enough to keep "logged in then opened
 * pipeline" as separate beats, big enough to fold "approved 30 comments
 * in a row" into a single line.
 *
 * Action categories (colour-coded) :
 *   publish / approve / unhide → green
 *   hide / flag / pause        → yellow
 *   delete / reject / ban      → red
 *   login / logout / view      → neutral
 *   edit / update              → gold
 */

import { useMemo } from "react";

interface AuditAction {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_label: string | null;
  actor_role: string | null;
  created_at: string;
}

type ActionCategory = "good" | "warn" | "bad" | "neutral" | "edit";

const CATEGORY_RULES: { match: RegExp; category: ActionCategory }[] = [
  { match: /^(publish|approve|unhide|restore|trigger\.run)/, category: "good" },
  { match: /^(hide|flag|pause|throttle|gemini\.skip)/, category: "warn" },
  { match: /^(delete|reject|ban|purge|dlq\.delete)/, category: "bad" },
  { match: /^(login|logout|view|export|audit\.|read)/, category: "neutral" },
  { match: /\.edit$|\.update$|\.set$|\.bulk$/, category: "edit" },
];

const CATEGORY_COLOURS: Record<ActionCategory, { bg: string; text: string; border: string }> = {
  good: { bg: "var(--green)", text: "var(--green)", border: "var(--green)" },
  warn: { bg: "var(--orange)", text: "var(--orange)", border: "var(--orange)" },
  bad: { bg: "var(--red)", text: "var(--red)", border: "var(--red)" },
  neutral: { bg: "var(--text-muted)", text: "var(--text-muted)", border: "var(--text-muted)" },
  edit: { bg: "var(--gold)", text: "var(--gold)", border: "var(--gold)" },
};

function categorize(action: string): ActionCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(action)) return rule.category;
  }
  return "neutral";
}

interface Burst {
  key: string;
  start_at: string;
  latest_at: string;
  actor_label: string | null;
  actor_role: string | null;
  action: string;
  category: ActionCategory;
  entity_type: string;
  count: number;
  ids: string[];
  /** First entity_id in the burst — for the link/href. */
  sample_entity_id: string | null;
}

const BURST_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function buildBursts(actions: AuditAction[]): Burst[] {
  // Sort ascending so we walk the timeline in temporal order.
  const sorted = [...actions].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const bursts: Burst[] = [];
  for (const a of sorted) {
    const cat = categorize(a.action);
    const last = bursts[bursts.length - 1];
    const sameKey =
      last &&
      last.actor_label === a.actor_label &&
      last.action === a.action &&
      last.category === cat;
    const within =
      last &&
      new Date(a.created_at).getTime() -
        new Date(last.latest_at).getTime() <
        BURST_WINDOW_MS;
    if (last && sameKey && within) {
      last.count += 1;
      last.latest_at = a.created_at;
      last.ids.push(a.id);
    } else {
      bursts.push({
        key: a.id,
        start_at: a.created_at,
        latest_at: a.created_at,
        actor_label: a.actor_label,
        actor_role: a.actor_role,
        action: a.action,
        category: cat,
        entity_type: a.entity_type,
        count: 1,
        ids: [a.id],
        sample_entity_id: a.entity_id,
      });
    }
  }
  // Reverse to show most recent first (matches the flat table convention).
  return bursts.reverse();
}

interface HourBucket {
  hour: string; // "14:00"
  date: string; // "26/04/2026"
  bursts: Burst[];
}

function bucketByHour(bursts: Burst[]): HourBucket[] {
  const buckets = new Map<string, HourBucket>();
  for (const b of bursts) {
    const d = new Date(b.start_at);
    const hour = `${String(d.getHours()).padStart(2, "0")}:00`;
    const date = d.toLocaleDateString("fr-FR");
    const key = `${date} ${hour}`;
    if (!buckets.has(key)) {
      buckets.set(key, { hour, date, bursts: [] });
    }
    buckets.get(key)!.bursts.push(b);
  }
  return Array.from(buckets.values());
}

function actorInitials(label: string | null): string {
  if (!label) return "?";
  return label
    .split(/[\s.\-_@]+/)
    .map((p) => p.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface Props {
  actions: AuditAction[];
}

export function AuditTimeline({ actions }: Props) {
  const bursts = useMemo(() => buildBursts(actions), [actions]);
  const buckets = useMemo(() => bucketByHour(bursts), [bursts]);

  if (buckets.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--text-muted)]">
        Aucune action à afficher dans la timeline.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <ol className="space-y-6">
        {buckets.map((bucket) => (
          <li key={`${bucket.date} ${bucket.hour}`} className="relative">
            {/* Hour header */}
            <div className="mb-2 flex items-baseline gap-3">
              <span className="font-data text-xs font-bold uppercase tracking-widest text-[var(--gold)]">
                {bucket.hour}
              </span>
              <span className="text-[10px] text-[var(--text-disabled)]">
                {bucket.date} ·{" "}
                {bucket.bursts.reduce((acc, b) => acc + b.count, 0)} action
                {bucket.bursts.reduce((acc, b) => acc + b.count, 0) > 1
                  ? "s"
                  : ""}
              </span>
            </div>

            <ul className="space-y-2 border-l-2 border-[var(--border-gold)]/40 pl-4">
              {bucket.bursts.map((b) => {
                const c = CATEGORY_COLOURS[b.category];
                const time = new Date(b.start_at).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                return (
                  <li key={b.key} className="relative">
                    {/* Dot anchor on the spine */}
                    <span
                      aria-hidden="true"
                      className="absolute -left-[22px] top-1.5 inline-block h-3 w-3 rounded-full border-2 bg-[var(--bg-surface)]"
                      style={{ borderColor: c.border }}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <time
                        className="font-mono text-[10px] text-[var(--text-disabled)]"
                        dateTime={b.start_at}
                        title={new Date(b.start_at).toISOString()}
                      >
                        {time}
                      </time>
                      {/* Actor avatar */}
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-[9px] font-bold"
                        style={{
                          borderColor: `${c.border}80`,
                          color: c.text,
                        }}
                        title={b.actor_label ?? "Inconnu"}
                      >
                        {actorInitials(b.actor_label)}
                      </span>
                      <span className="font-bold text-[var(--text-secondary)]">
                        {b.actor_label ?? "?"}
                      </span>
                      {b.actor_role && b.actor_role !== "unknown" && (
                        <span className="text-[10px] text-[var(--text-disabled)]">
                          ({b.actor_role})
                        </span>
                      )}
                      <span
                        className="rounded-full border px-2 py-0.5 font-mono text-[10px]"
                        style={{
                          borderColor: `${c.border}60`,
                          backgroundColor: `${c.bg}15`,
                          color: c.text,
                        }}
                      >
                        {b.action}
                      </span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                        {b.entity_type}
                      </span>
                      {b.sample_entity_id && (
                        <span className="font-mono text-[10px] text-[var(--text-disabled)]">
                          {b.sample_entity_id.slice(0, 12)}…
                        </span>
                      )}
                      {b.count > 1 && (
                        <span
                          className="ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold"
                          style={{
                            borderColor: `${c.border}60`,
                            backgroundColor: `${c.bg}15`,
                            color: c.text,
                          }}
                          title={`${b.count} actions du même type en ${Math.round((new Date(b.latest_at).getTime() - new Date(b.start_at).getTime()) / 1000)}s`}
                        >
                          ×{b.count}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
