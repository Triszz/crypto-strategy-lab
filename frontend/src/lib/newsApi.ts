/**
 * News module REST client.
 *
 * Thin wrappers around `http.get` / `http.post` for the 4 News
 * endpoints documented in `Knowledge/specs/01-news-module.md`.
 * Each function maps the backend envelope (`{ success, data }`) to
 * a typed return value, throwing `HttpError` on failure.
 *
 * Endpoints (see `backend/src/modules/news/presentation/news.routes.ts`):
 *  - GET  /api/news?symbol=&page=&pageSize=          → NewsListResponse
 *  - GET  /api/news/:id                              → NewsItem
 *  - POST /api/news/crawl       body: { symbol? }    → CrawlTriggerResponse (202)
 *  - GET  /api/news/crawl/:jobId/status              → CrawlJobProgress
 */

import { http } from "./http";
import type {
  CrawlJobProgress,
  CrawlTriggerResponse,
  ExtractionTemplate,
  FetchNewsParams,
  NewsItem,
  NewsListResponse,
} from "../types/news";

/**
 * List news with optional filters + pagination.
 *
 * @example
 *   const { items, total } = await fetchNews({ symbol: "BTC", pageSize: 20 });
 */
export async function fetchNews(
  params: FetchNewsParams = {},
): Promise<NewsListResponse> {
  const qs = new URLSearchParams();
  if (params.symbol) qs.set("symbol", params.symbol);
  if (params.page !== undefined) qs.set("page", String(params.page));
  if (params.pageSize !== undefined) qs.set("pageSize", String(params.pageSize));
  const suffix = qs.toString() ? `?${qs}` : "";
  return http.get<NewsListResponse>(`/api/news${suffix}`);
}

/** Fetch a single news item by ID. Throws `HttpError(404)` if missing. */
export async function fetchNewsById(id: string): Promise<NewsItem> {
  return http.get<NewsItem>(`/api/news/${encodeURIComponent(id)}`);
}

/**
 * Trigger a manual crawl. Backend responds HTTP 202 with
 * `{ triggered: true, count }` — `count` is the number of new items
 * saved by this crawl. The crawl runs synchronously inside the POST,
 * so by the time this resolves the DB is already updated.
 *
 * Throttled by `NEWS_CRAWL_INTERVAL_MS` server-side to prevent abuse.
 *
 * Payload shape: the body is sent ONLY when a symbol was selected
 * (e.g. `"BTC"`). For "ALL / no filter" we send an empty object so the
 * request stays a clean `POST {}` rather than `POST { symbol: null }`,
 * which historically tripped Zod's `.optional()` validator (only
 * allowed `undefined`, not `null`).
 */
export async function triggerCrawl(
  symbol?: string,
): Promise<CrawlTriggerResponse> {
  const body: { symbol?: string } = {};
  if (symbol !== undefined) body.symbol = symbol;
  return http.post<CrawlTriggerResponse>("/api/news/crawl", body);
}

/**
 * Poll the status of a background crawl job (queued by the periodic
 * cron, not by `triggerCrawl`). Returns `null` if the job id is
 * unknown.
 */
export async function fetchCrawlJobStatus(
  jobId: string,
): Promise<CrawlJobProgress | null> {
  try {
    return await http.get<CrawlJobProgress>(
      `/api/news/crawl/${encodeURIComponent(jobId)}/status`,
    );
  } catch (err) {
    // Backend returns 404 for unknown jobId — treat as `null` rather
    // than letting the error propagate to UI consumers.
    if (err instanceof Error && /NOT_FOUND/.test(err.message)) {
      return null;
    }
    throw err;
  }
}

/** Fetch current active LLM extraction template from backend */
export async function fetchExtractionTemplate(): Promise<ExtractionTemplate> {
  return http.get<ExtractionTemplate>("/api/news/templates");
}

/** Toggle self-healing mode on/off in backend */
export async function toggleSelfHealing(enabled: boolean): Promise<{ selfHealingActive: boolean }> {
  return http.post<{ selfHealingActive: boolean }>("/api/news/self-healing/toggle", { enabled });
}

