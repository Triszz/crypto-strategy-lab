/**
 * REST client for the Market Data module.
 * All calls go to the backend on the same origin (Vite dev server proxies /api).
 */

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface RawCandle {
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
}

export interface ChartConfig {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
  updatedAt?: Date;
}

interface ApiSuccess<T> {
  success: true;
  data: T;
}

/**
 * Backend error shapes are inconsistent (legacy routes return a plain
 * string; the global error middleware returns an object). We accept both
 * and normalise to a single string message at the boundary.
 */
interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

interface ApiError {
  success: false;
  error: string | ApiErrorBody;
  details?: unknown;
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Extract a printable error message from any backend error response shape. */
function extractErrorMessage(json: unknown, status: number): string {
  if (typeof json !== "object" || json === null) return `HTTP ${status}`;
  const e = (json as { error?: unknown }).error;
  if (typeof e === "string" && e.length > 0) return e;
  if (typeof e === "object" && e !== null) {
    const m = (e as { message?: unknown }).message;
    const c = (e as { code?: unknown }).code;
    if (typeof m === "string" && m.length > 0) return m;
    if (typeof c === "string" && c.length > 0) return c;
  }
  return `HTTP ${status}`;
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "include" });
  } catch (e) {
    throw new Error(`Network error: ${(e as Error).message ?? "unknown"}`);
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`Invalid JSON from server (HTTP ${res.status})`);
  }

  if (!json.success) {
    throw new Error(extractErrorMessage(json, res.status));
  }
  return (json as ApiSuccess<T>).data;
}

async function post<T, B = unknown>(path: string, body: B): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Network error: ${(e as Error).message ?? "unknown"}`);
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`Invalid JSON from server (HTTP ${res.status})`);
  }

  if (!json.success) {
    throw new Error(extractErrorMessage(json, res.status));
  }
  return (json as ApiSuccess<T>).data;
}

async function put<T, B = unknown>(path: string, body: B): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Network error: ${(e as Error).message ?? "unknown"}`);
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`Invalid JSON from server (HTTP ${res.status})`);
  }

  if (!json.success) {
    throw new Error(extractErrorMessage(json, res.status));
  }
  return (json as ApiSuccess<T>).data;
}

/** Fetch chart configs (called once on mount). */
export async function fetchChartConfigs(): Promise<ChartConfig[]> {
  return get<ChartConfig[]>("/api/candles/chart-configs");
}

/** Query candles from the local DB. */
export async function fetchCandles(params: {
  symbol: string;
  timeframe: Timeframe;
  from?: number;
  to?: number;
  limit?: number;
}): Promise<RawCandle[]> {
  const url = new URLSearchParams({
    symbol: params.symbol,
    timeframe: params.timeframe,
  });
  if (params.from !== undefined) url.set("from", String(params.from));
  if (params.to !== undefined) url.set("to", String(params.to));
  if (params.limit !== undefined) url.set("limit", String(params.limit));
  return get<RawCandle[]>(`/api/candles?${url}`);
}

/** Load more historical candles by fetching from Binance and upserting. */
export async function loadMoreCandles(params: {
  symbol: string;
  timeframe: Timeframe;
  beforeMs: number;
  limit?: number;
}): Promise<{ symbol: string; timeframe: string; inserted: number; candles: RawCandle[] }> {
  return post<{ symbol: string; timeframe: string; inserted: number; candles: RawCandle[] }>("/api/candles/load-more", {
    symbol: params.symbol,
    timeframe: params.timeframe,
    beforeMs: params.beforeMs,
    limit: params.limit ?? 1000,
  });
}

/** Update a chart's config (symbol/timeframe). Returns updated configs. */
export async function updateChartConfig(params: {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
}): Promise<ChartConfig[]> {
  return put<ChartConfig[]>("/api/candles/chart-configs", {
    chartIndex: params.chartIndex,
    symbol: params.symbol,
    timeframe: params.timeframe,
  });
}
