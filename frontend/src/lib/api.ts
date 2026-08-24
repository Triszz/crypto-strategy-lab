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

interface ApiError {
  success: false;
  error: string;
  details?: unknown[];
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    throw new Error((json as ApiError).error ?? `HTTP ${res.status}`);
  }
  return (json as ApiSuccess<T>).data;
}

async function post<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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

async function put<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
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
