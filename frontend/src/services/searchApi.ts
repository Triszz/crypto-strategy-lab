/**
 * Search API client.
 * All calls go to the backend on the same origin (Vite dev server proxies /api).
 *
 * Endpoints consumed:
 *   GET  /api/search/algorithms    → list available SearchAlgorithm rows
 *   GET  /api/search/symbols       → list active Symbol rows
 *   POST /api/search/start         → create + immediately start a SearchRun
 *   GET  /api/search/:id           → SearchRun summary (status, ids, timestamps)
 */

// ─── API Response Wrappers ────────────────────────────────────────────────────

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: string;
  details?: unknown[];
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Domain DTO Types ─────────────────────────────────────────────────────────

/**
 * Mirrors `SearchAlgorithm` Prisma model (id, code, name, implementationRef).
 * Returned by GET /api/search/algorithms.
 */
export interface SearchAlgorithmItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly implementationRef: string;
}

/**
 * Mirrors a subset of the `Symbol` Prisma model used for Search input.
 * Returned by GET /api/search/symbols.
 */
export interface SymbolItem {
  readonly id: string;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
}

/**
 * Status values returned by the Search API. Mirrors the backend's
 * `SearchStatus` Prisma enum.
 */
export type SearchStatus = "PENDING" | "RUNNING" | "DONE" | "STOPPED" | "FAILED";

/**
 * Reason the search stopped. Mirrors `StopReason` from the Search domain.
 */
export type StopReason = "MAX_CANDIDATES" | "BACK_PRESSURE" | "COMPLETED" | "PARTIAL" | "NO_VALID_STRATEGIES" | string;

/**
 * SearchRun summary returned by GET /api/search/:id.
 * Mirrors exactly the response shape documented in search.routes.ts.
 */
export interface SearchRunSummary {
  readonly id: string;
  readonly algorithmId: string;
  readonly symbolId: string;
  readonly timeframe: string;
  readonly maxCandidates: number;
  readonly status: SearchStatus;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly createdAt: string;
}

/**
 * Immediate response from POST /api/search/start.
 *
 * NOTE: As of the current backend implementation, POST /api/search/start
 * executes synchronously and returns final counts. status is "DONE" or
 * "STOPPED" depending on whether maxCandidates was reached. The frontend
 * still calls GET /api/search/:id afterwards to confirm the persisted
 * row matches.
 */
export interface StartSearchResponse {
  readonly searchRunId: string;
  readonly algorithm: string;
  readonly status: SearchStatus;
  readonly totalGenerated: number;
  readonly totalQueued: number;
  readonly totalRejected: number;
  readonly stopReason: StopReason;
  readonly generationMs: number;
}

/**
 * Request body for POST /api/search/start.
 *
 * Mirrors the backend's Zod schema `StartSearchSchema`:
 *   - algorithmId: required UUID
 *   - symbolId:    required UUID
 *   - timeframe:   required string (>= 1 char)
 *   - maxCandidates: required positive int <= 10000
 *   - fromTime / toTime: optional ms timestamps
 *   - createdBy:   optional short string
 *   - generatorConfig: optional record
 */
export interface StartSearchRequest {
  readonly algorithmId: string;
  readonly symbolId: string;
  readonly timeframe: string;
  readonly maxCandidates: number;
  readonly fromTime?: number;
  readonly toTime?: number;
  readonly createdBy?: string;
  readonly generatorConfig?: Readonly<Record<string, unknown>>;
}

/**
 * Parameters for runSearch.
 * - `algorithm` is the generator code (e.g. "random", "domain_guided"),
 *   passed via query string per the backend's existing convention.
 */
export interface RunSearchParams extends StartSearchRequest {
  readonly algorithm?: string;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    throw new Error((json as ApiError).error ?? `HTTP ${res.status}`);
  }
  return (json as ApiSuccess<T>).data;
}

async function post<T, B = unknown>(path: string, body: B, query?: Record<string, string>): Promise<T> {
  let url = `${BASE}${path}`;
  if (query && Object.keys(query).length > 0) {
    const qs = new URLSearchParams(query).toString();
    url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    throw new Error((json as ApiError).error ?? `HTTP ${res.status}`);
  }
  return (json as ApiSuccess<T>).data;
}

// ─── Search API ──────────────────────────────────────────────────────────────

/**
 * GET /api/search/algorithms
 * Lists all registered SearchAlgorithm rows (with their UUIDs).
 */
export async function fetchSearchAlgorithms(): Promise<SearchAlgorithmItem[]> {
  return get<SearchAlgorithmItem[]>("/api/search/algorithms");
}

/**
 * GET /api/search/symbols
 * Lists active Symbol rows (with their UUIDs).
 */
export async function fetchSearchSymbols(): Promise<SymbolItem[]> {
  return get<SymbolItem[]>("/api/search/symbols");
}

/**
 * POST /api/search/start?algorithm={generator}
 *
 * Creates a SearchRun and immediately starts generation. The backend
 * executes synchronously and returns final counts.
 *
 * @param params.requestBody   Required request body fields.
 * @param params.algorithm     Optional generator code (defaults to "random" on backend).
 */
export async function startSearch(params: RunSearchParams): Promise<StartSearchResponse> {
  const { algorithm, ...body } = params;
  const query: Record<string, string> | undefined = algorithm ? { algorithm } : undefined;
  return post<StartSearchResponse, StartSearchRequest>("/api/search/start", body, query);
}

/**
 * GET /api/search/:id
 * Returns the SearchRun summary (status, timestamps, ids).
 *
 * NOTE: The backend does NOT expose individual candidates on this
 * endpoint — by design, CandidateStrategy rows are owned by the
 * Backtest module. The frontend therefore displays the run summary
 * plus the start response (totalGenerated / totalQueued / stopReason).
 */
export async function getSearchRun(id: string): Promise<SearchRunSummary> {
  return get<SearchRunSummary>(`/api/search/${encodeURIComponent(id)}`);
}

/**
 * CandidateStrategy metadata enriched with its StrategyVersion.
 * Returned by GET /api/search/:id/candidates.
 */
export interface CandidateItem {
  readonly id: string;
  readonly searchRunId: string;
  readonly strategyVersionId: string;
  readonly parameters: Record<string, unknown>;
  readonly status: "PENDING" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly strategyVersion: {
    readonly id: string;
    readonly name: string;
    readonly implementationRef: string;
    readonly definitionType: "BASE" | "COMPOSITE";
    readonly definitionFamily: string;
  } | null;
}

/**
 * GET /api/search/:id/candidates
 * Returns all CandidateStrategy rows produced by a SearchRun, with
 * StrategyVersion data joined. Used to drive the Search → Backtest
 * integration (each row has a "Run Backtest" action in the UI).
 */
export async function fetchSearchRunCandidates(
  searchRunId: string,
): Promise<CandidateItem[]> {
  return get<CandidateItem[]>(
    `/api/search/${encodeURIComponent(searchRunId)}/candidates`,
  );
}

/**
 * One row of the SearchRun history. Returned by GET /api/search.
 */
export interface SearchRunListItem {
  readonly id: string;
  readonly status: SearchStatus;
  readonly timeframe: string;
  readonly maxCandidates: number;
  readonly algorithm: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  };
  readonly symbol: {
    readonly id: string;
    readonly symbol: string;
    readonly baseAsset: string;
    readonly quoteAsset: string;
  };
  readonly candidateCount: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
}

/**
 * GET /api/search
 * List recent SearchRuns, most recent first. Drives the Discovery
 * history dashboard.
 *
 * @param options.limit  Optional page size (1..200, default 50).
 * @param options.status Optional SearchStatus filter.
 * @param options.cursor Optional SearchRun id to paginate from.
 */
export async function fetchSearchRuns(options?: {
  limit?: number;
  status?: SearchStatus;
  cursor?: string;
}): Promise<SearchRunListItem[]> {
  const query: Record<string, string> = {};
  if (options?.limit !== undefined) query["limit"] = String(options.limit);
  if (options?.status) query["status"] = options.status;
  if (options?.cursor) query["cursor"] = options.cursor;
  const qs = Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : "";
  return get<SearchRunListItem[]>(`/api/search${qs}`);
}