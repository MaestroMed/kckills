/**
 * Admin session helpers — JWT-based cookie auth (Wave 34 T1.2).
 *
 * The admin login route emits a signed HS256 JWT in the `kc_admin`
 * cookie. Everywhere we previously compared the raw cookie value to
 * `KCKILLS_ADMIN_TOKEN`, we now `jwtVerify()` it against
 * `KCKILLS_ADMIN_JWT_SECRET`. Reasoning :
 *
 *   • Cookie no longer contains the master secret in clear.
 *   • Rotation is trivial : bump KCKILLS_ADMIN_JWT_SECRET, every
 *     existing cookie becomes invalid on the next request.
 *   • Expiry is enforced by the JWT itself (`exp` claim), not just by
 *     the cookie's `maxAge` (which the client can lie about).
 *
 * The proxy runs on the edge runtime, so we use `jose` (Edge-safe)
 * instead of `jsonwebtoken` (Node-only). The same helper works from
 * RSC handlers (node runtime) and from proxy.ts (edge).
 */

import { jwtVerify } from "jose";

let cachedSecret: Uint8Array | null = null;
let cachedSecretSource: string | null = null;

function getSecretKey(): Uint8Array | null {
  const raw = process.env.KCKILLS_ADMIN_JWT_SECRET;
  if (!raw || raw.length < 32) return null;
  if (cachedSecret && cachedSecretSource === raw) return cachedSecret;
  cachedSecret = new TextEncoder().encode(raw);
  cachedSecretSource = raw;
  return cachedSecret;
}

/**
 * Verify a JWT from the `kc_admin` cookie. Returns true ONLY when :
 *   • the JWT is well-formed,
 *   • the signature matches the configured secret,
 *   • the `exp` claim is in the future,
 *   • the `role` claim is "admin".
 *
 * Any failure (missing secret, malformed JWT, expired, bad sig)
 * returns false. The function never throws — callers can just check
 * the boolean and redirect to /admin/login on false.
 */
export async function verifyAdminCookie(value: string | undefined | null): Promise<boolean> {
  if (!value) return false;
  const secret = getSecretKey();
  if (!secret) return false;
  try {
    const { payload } = await jwtVerify(value, secret, { algorithms: ["HS256"] });
    return payload?.role === "admin";
  } catch {
    return false;
  }
}
