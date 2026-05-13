/**
 * POST /api/compilation/create — Compilation Builder submission endpoint.
 *
 * The builder UI (web/src/app/compilation/CompilationBuilder.tsx) calls
 * this from the client after the user finishes the 3-step wizard. We :
 *
 *   1. Validate the payload with zod (1-20 UUID kill_ids, title <= 80,
 *      description <= 400, intro/outro <= 160 each, session_hash >= 16).
 *   2. Rate-limit per IP at 12 / hour. The SQL RPC ALSO rate-limits per
 *      session_hash at 8/hour ; together they handle both casual abuse
 *      vectors.
 *   3. Hand off to `fn_create_compilation` SECURITY DEFINER. The RPC
 *      owns the short_code collision-retry loop, the per-session
 *      rate limit, the row INSERT, and the pipeline_jobs enqueue.
 *   4. Return `{ shortCode, id }` so the client redirects to
 *      /compilation/<shortCode>/status (the builder's success view) or
 *      /c/<shortCode> for sharing.
 *
 * Anon-friendly : NextRequest doesn't need an authed cookie. The
 * session_hash from the client is what identifies the author, and the
 * fn_create_compilation RPC pins it to the row.
 *
 * Notes
 * ─────
 *   • This endpoint does NOT directly write to pipeline_jobs — the RPC
 *     handles it inside the same transaction so the row + the queued
 *     job either both land or neither does. If the queue plumbing
 *     isn't fully deployed (worker still on legacy polling), the RPC
 *     silently falls back to "row only" and the worker's
 *     compilation_render.py picks up the pending row via its own scan.
 *   • If the RPC raises (rate limit, validation, etc.), we surface the
 *     message back to the user verbatim — the messages are designed to
 *     be UI-safe French strings.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createServerSupabase } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Body = z.object({
  title: z
    .string()
    .min(1, "Le titre est requis.")
    .max(80, "Le titre doit faire 80 caractères max.")
    .transform((s) => s.trim()),
  description: z
    .string()
    .max(400, "La description doit faire 400 caractères max.")
    .optional()
    .nullable()
    .transform((s) => (s ? s.trim() : undefined)),
  killIds: z
    .array(z.string().regex(UUID_RE, "kill id invalide"))
    .min(1, "Sélectionne au moins 1 clip.")
    .max(20, "Maximum 20 clips par compilation.")
    /**
     * The wizard prevents duplicates, but a tampered payload could
     * still send them. Reject up front rather than letting the worker
     * concatenate the same clip twice — that'd waste R2 storage and
     * confuse the chapter markers.
     */
    .refine(
      (arr) => new Set(arr).size === arr.length,
      "Chaque clip ne peut apparaître qu'une seule fois.",
    ),
  introText: z
    .string()
    .max(160, "Texte d'intro trop long (160 max).")
    .optional()
    .nullable()
    .transform((s) => (s ? s.trim() : undefined)),
  outroText: z
    .string()
    .max(160, "Texte d'outro trop long (160 max).")
    .optional()
    .nullable()
    .transform((s) => (s ? s.trim() : undefined)),
  sessionHash: z
    .string()
    .min(16, "session_hash trop court.")
    .max(128, "session_hash trop long."),
});

export async function POST(req: NextRequest) {
  // ── 1. Per-IP rate limit (12 / hour) ────────────────────────────
  const limit = await rateLimit(req, "compilation-create", {
    windowSec: 3600,
    max: 12,
  });
  if (limit.blocked) return limit.response!;

  // ── 2. Parse + validate ─────────────────────────────────────────
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Corps de requête invalide." },
      { status: 400 },
    );
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        ok: false,
        error: first?.message ?? "Payload invalide.",
        field: first?.path?.join("."),
      },
      { status: 400 },
    );
  }
  const payload = parsed.data;

  // ── 3. Resolve auth + RPC ───────────────────────────────────────
  const sb = await createServerSupabase();
  // auth.getUser() is null for anon — that's fine. The RPC accepts
  // a NULL user_id and falls back to auth.uid() (also NULL) so the
  // row goes in as session-owned only.
  const {
    data: { user },
  } = await sb.auth.getUser();

  const { data, error } = await sb.rpc("fn_create_compilation", {
    p_title: payload.title,
    p_description: payload.description ?? null,
    p_kill_ids: payload.killIds,
    p_intro_text: payload.introText ?? null,
    p_outro_text: payload.outroText ?? null,
    p_session_hash: payload.sessionHash,
    p_user_id: user?.id ?? null,
  });

  if (error) {
    // PostgREST surfaces RAISE EXCEPTION messages on `error.message`.
    // We keep them user-facing — they're already French in the SQL.
    const msg = error.message || "Échec de la création.";
    // Rate-limit messages come back as plain text — bump to 429 so
    // the client can show the right toast.
    const isRate = /rate limit/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isRate ? 429 : 400 },
    );
  }

  // RPC returns `TABLE (id uuid, short_code text)` — supabase-js gives
  // us either the row directly OR an array. Normalise.
  type RpcRow = { id?: string; short_code?: string };
  const row: RpcRow = Array.isArray(data)
    ? (data[0] as RpcRow | undefined) ?? {}
    : (data as RpcRow) ?? {};
  if (!row.id || !row.short_code) {
    return NextResponse.json(
      { ok: false, error: "Réponse invalide du serveur." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      id: row.id,
      shortCode: row.short_code,
      viewerUrl: `/c/${row.short_code}`,
    },
    { status: 201 },
  );
}
