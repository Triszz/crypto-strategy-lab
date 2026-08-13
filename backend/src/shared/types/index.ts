/**
 * Cross-module shared types.
 *
 * Keep this file minimal. Module-specific domain types (e.g. `Candle`,
 * `Strategy`, `NewsItem`) MUST live inside the owning module's
 * `domain/` folder. This file is only for types that genuinely span
 * more than one module: API envelopes, pagination, event envelope
 * shape, etc.
 */

/** Standard JSON envelope for every REST response. */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  meta?: ResponseMeta;
}

export interface ResponseMeta {
  requestId?: string;
  timestamp?: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Standard envelope for in-process + WebSocket events.
 * See `docs/Solution.md` § 7 (Event Catalog) for the canonical list.
 */
export interface EventEnvelope<T> {
  event: string;
  version: string;
  timestamp: number;
  payload: T;
}

/** Universal UTC ISO-8601 timestamp string. */
export type IsoTimestamp = string;