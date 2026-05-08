/**
 * Shared Zod schema for the {limit, offset} cursor pattern used across
 * public list endpoints (Wave 16 hardening).
 *
 * Coerces string query params to numbers, clamps to safe ranges so a
 * malicious URL can't ask for offset=999999999 or limit=10000.
 */
import { z } from "zod";

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof Pagination>;
