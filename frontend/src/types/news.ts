/**
 * Frontend domain types for the News module.
 *
 * These mirror the backend `NewsItem` shape (see
 * `backend/src/modules/news/domain/news.entity.ts`) and the REST API
 * response envelope (see `backend/src/shared/types/index.ts`).
 *
 * Convention:
 *  - All date fields are ISO-8601 strings (e.g. `"2026-09-02T10:40:00Z"`).
 *    `Date` objects are never passed through the network — JSON has no
 *    Date type.
 *  - `coinSymbols` is in **base-asset form** (e.g. `"BTC"`, not `"BTCUSDT"`).
 *    The backend normalises this in `prisma-news.repository.ts`.
 */

/** A single news article as returned by `GET /api/news` and `GET /api/news/:id`. */
export interface NewsItem {
  id: string;
  providerId: string;
  externalId: string;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  source: string;
  author: string | null;
  /** ISO-8601 timestamp when the article was originally published. */
  publishedAt: string;
  /** ISO-8601 timestamp when we crawled it. */
  crawledAt: string;
  /** Base assets this news is tagged with, e.g. `["BTC", "ETH"]`. */
  coinSymbols: string[];
}

/** Response body for `GET /api/news`. */
export interface NewsListResponse {
  items: NewsItem[];
  total: number;
}

/** Lifecycle of a crawl job. */
export type CrawlStatus = "WAITING" | "RUNNING" | "COMPLETED" | "FAILED";

/** Single crawl job's progress — mirrors `NewsCrawlProgress` on backend. */
export interface CrawlJobProgress {
  jobId: string;
  symbols: string[];
  status: CrawlStatus;
  startedAt: string;
  finishedAt?: string;
  totalSaved: number;
  totalFetched: number;
  errors: { symbol: string; message: string }[];
}

/** Response body for `POST /api/news/crawl` (HTTP 202). */
export interface CrawlTriggerResponse {
  triggered: true;
  count: number;
}

/** Optional filters for `GET /api/news`. */
export interface FetchNewsParams {
  /** Base asset, e.g. `"BTC"` or full symbol `"BTCUSDT"` — backend normalises. */
  symbol?: string;
  page?: number;
  /** Backend caps at 100. */
  pageSize?: number;
}

/**
 * Realtime event payload broadcast over Socket.IO when a new article
 * is saved to the database. Matches the BE's `NewsCollectedPayload`.
 */
export interface NewsCollectedEvent {
  newsId: string;
  title: string;
  summary: string | null;
  content: string | null;
  source: string;
  url: string;
  publishedAt: string;
  coinSymbols: string[];
}

/**
 * Convert a `NewsCollectedEvent` (incoming over WS, may have null
 * `publishedAt` etc.) into a `NewsItem` so the FE list can render it
 * uniformly without refetching.
 *
 * - `id` is filled from `newsId`.
 * - `providerId`, `externalId`, `author`, `crawledAt` are unknown at
 *   broadcast time and filled with placeholders. The next list
 *   refresh replaces the placeholder with real values.
 */
export function newsCollectedToListItem(event: NewsCollectedEvent): NewsItem {
  const now = new Date().toISOString();
  return {
    id: event.newsId,
    // Placeholder fields — replaced on next GET /api/news.
    providerId: "",
    externalId: event.url,
    title: event.title,
    summary: event.summary,
    content: event.content,
    url: event.url,
    source: event.source,
    author: null,
    publishedAt: event.publishedAt,
    crawledAt: now,
    coinSymbols: event.coinSymbols,
  };
}
