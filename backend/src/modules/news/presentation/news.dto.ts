import { z } from "zod";

/**
 * Zod schemas for the News HTTP layer.
 *
 * Why Zod (vs. manual parsing):
 *   - Single source of truth: schema = TypeScript type + runtime validator.
 *   - Coercion: query params arrive as strings; `z.coerce` turns them into
 *     numbers with bounds checking in one place.
 *   - Errors are uniform: `parsed.error.issues` is the same shape we send
 *     back to the client, so the frontend can render structured feedback.
 *
 * Convention: see `market-data.routes.ts` for the same `safeParse` pattern.
 */

/** GET /news — list with optional filters & pagination. */
export const GetNewsQuerySchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,10}(USDT)?$/, "Invalid symbol format (e.g. BTC, ETH, BTCUSDT)")
    .optional(),
  page: z.coerce.number().int().min(1, "page must be >= 1").default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, "pageSize must be >= 1")
    .max(100, "pageSize must be <= 100")
    .default(10),
});

/** GET /news/:id — single news detail. */
export const GetNewsByIdParamsSchema = z.object({
  id: z.string().trim().min(1, "id is required"),
});

/** POST /news/crawl — body schema (used by Phase 1.3). */
export const CrawlNewsBodySchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,10}(USDT)?$/, "Invalid symbol format (e.g. BTC, ETH, BTCUSDT)")
    .optional(),
});

export type GetNewsQuery = z.infer<typeof GetNewsQuerySchema>;
export type GetNewsByIdParams = z.infer<typeof GetNewsByIdParamsSchema>;
export type CrawlNewsBody = z.infer<typeof CrawlNewsBodySchema>;