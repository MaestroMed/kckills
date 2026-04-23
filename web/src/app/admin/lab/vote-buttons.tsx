"use client";

import { useState, useTransition } from "react";

const VERDICTS = [
  { value: "great", label: "✦ Great", color: "var(--gold)" },
  { value: "good", label: "✓ Good", color: "var(--green)" },
  { value: "ok", label: "~ OK", color: "var(--cyan)" },
  { value: "meh", label: "▽ Meh", color: "var(--orange)" },
  { value: "bad", label: "✗ Bad", color: "var(--red)" },
] as const;

export function LabVoteButtons({
  evalId,
  currentVerdict,
  currentNote,
}: {
  evalId: string;
  currentVerdict: string | null;
  currentNote: string | null;
}) {
  const [verdict, setVerdict] = useState<string | null>(currentVerdict);
  const [note, setNote] = useState<string>(currentNote ?? "");
  const [pending, startTransition] = useTransition();
  const [showNote, setShowNote] = useState(false);

  const submit = (newVerdict: string, newNote?: string) => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/lab/vote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eval_id: evalId,
            verdict: newVerdict,
            note: newNote ?? note,
          }),
        });
        if (res.ok) {
          setVerdict(newVerdict);
        } else {
          const text = await res.text();
          alert(`Vote failed : ${text}`);
        }
      } catch (e) {
        alert(`Vote failed : ${(e as Error).message}`);
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {VERDICTS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => submit(v.value)}
            disabled={pending}
            className={`text-[10px] uppercase tracking-widest font-data font-bold px-2.5 py-1 rounded border transition-all ${
              verdict === v.value
                ? "border-current bg-current/15 ring-1 ring-current"
                : "border-current/30 bg-transparent hover:border-current/60"
            } ${pending ? "opacity-50 cursor-not-allowed" : ""}`}
            style={{ color: v.color }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowNote((s) => !s)}
        className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]"
      >
        {showNote ? "Hide note" : note ? "Edit note" : "+ Add note"}
      </button>

      {showNote && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's wrong / great about this description ?"
            className="w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-gold)] rounded p-2 text-white placeholder:text-[var(--text-disabled)]"
            rows={2}
          />
          <button
            type="button"
            onClick={() => verdict && submit(verdict, note)}
            disabled={!verdict || pending}
            className="text-[10px] uppercase tracking-widest font-bold text-[var(--gold)] hover:text-[var(--gold-bright)] disabled:opacity-30"
          >
            Save note →
          </button>
        </div>
      )}
    </div>
  );
}
