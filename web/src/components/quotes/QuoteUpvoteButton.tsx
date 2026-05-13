"use client";

/**
 * Idempotent upvote heart for a single quote.
 *
 * Browser-side state :
 *   - sessionHash : a SHA-256 digest of a UUID minted once per browser,
 *     persisted in localStorage under `kckills.quote_session`. We hash
 *     before sending so we never expose a raw cookie value to the
 *     server even if logs leak — the DB only sees the hex digest.
 *   - votedSet : the set of quote IDs this browser has voted on,
 *     persisted in localStorage so we can instantly mark them as
 *     voted on next render (the server tells us too, but the local
 *     fallback avoids a flicker).
 *
 * The RPC is idempotent — calling twice from the same browser is a
 * no-op server-side. The local state is the UX layer.
 */

import { useEffect, useState, useTransition } from "react";

import { upvoteQuoteAction } from "@/lib/quotes-actions";

interface Props {
  quoteId: string;
  initialUpvotes: number;
}

const SESSION_KEY = "kckills.quote_session";
const VOTED_KEY = "kckills.quote_voted";

async function sha256Hex(input: string): Promise<string> {
  // Web Crypto. On `crypto.subtle` failures (older browsers, insecure
  // contexts) we fall back to a stable but lower-entropy hash so the
  // upvote still goes through. The migration RPC clamps anything < 8
  // chars as invalid which catches the empty case.
  const enc = new TextEncoder();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback : poor man's hex of the bytes themselves. Not secure, but
  // good enough as a stable per-browser key.
  let out = "";
  for (let i = 0; i < input.length; i++) {
    out += input.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out.padEnd(64, "0");
}

function readVotedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(VOTED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function persistVoted(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VOTED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage full / disabled — ignore, the server still has the
    // truth via the upvote_log table.
  }
}

async function ensureSessionHash(): Promise<string> {
  if (typeof window === "undefined") return "";
  try {
    let raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      // crypto.randomUUID is supported on every browser this app targets
      // (Safari 15.4+ / Chrome 92+ / Firefox 95+).
      raw =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `fallback-${Date.now()}-${Math.random()}`;
      window.localStorage.setItem(SESSION_KEY, raw);
    }
    return await sha256Hex(raw);
  } catch {
    return "";
  }
}

export function QuoteUpvoteButton({ quoteId, initialUpvotes }: Props) {
  const [count, setCount] = useState<number>(initialUpvotes);
  const [hasVoted, setHasVoted] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();

  // Restore "I voted on this" from localStorage so the UI doesn't
  // flicker between the SSR-empty state and the client truth.
  useEffect(() => {
    const set = readVotedSet();
    if (set.has(quoteId)) setHasVoted(true);
  }, [quoteId]);

  const onClick = () => {
    if (hasVoted || pending) return;
    startTransition(async () => {
      const sessionHash = await ensureSessionHash();
      if (!sessionHash) return;
      const result = await upvoteQuoteAction(quoteId, sessionHash);
      setCount(result.upvotes);
      setHasVoted(true);
      const set = readVotedSet();
      set.add(quoteId);
      persistVoted(set);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={hasVoted || pending}
      aria-label={
        hasVoted ? `Deja vote (${count})` : `Aimer cette phrase (${count})`
      }
      aria-pressed={hasVoted}
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-data font-bold transition-colors",
        "border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]",
        hasVoted
          ? "border-[var(--gold)]/70 bg-[var(--gold)]/15 text-[var(--gold-bright)] cursor-default"
          : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--gold)]/50 hover:text-[var(--gold)]",
        pending && "opacity-60",
      ].join(" ")}
    >
      <HeartIcon filled={hasVoted} />
      <span>{count}</span>
    </button>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
    >
      <path d="M8 13.5s-5.2-3.1-5.2-7c0-1.7 1.3-3 3-3 1.1 0 1.9.6 2.2 1.3.3-.7 1.1-1.3 2.2-1.3 1.7 0 3 1.3 3 3 0 3.9-5.2 7-5.2 7z" />
    </svg>
  );
}
