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

function generateFallbackCandles(symbol: string, timeframe: Timeframe, limit: number = 100): RawCandle[] {
  const candles: RawCandle[] = [];
  const basePrice = symbol.startsWith("BTC") ? 95000 : symbol.startsWith("ETH") ? 2700 : symbol.startsWith("SOL") ? 180 : 600;
  const now = Date.now();
  const tfSeconds = timeframe === "1m" ? 60 : timeframe === "5m" ? 300 : timeframe === "15m" ? 900 : timeframe === "1h" ? 3600 : timeframe === "4h" ? 14400 : 86400;
  const intervalMs = tfSeconds * 1000;
  
  let currentPrice = basePrice;
  const startTime = now - limit * intervalMs;
  
  for (let i = 0; i < limit; i++) {
    const openTime = startTime + i * intervalMs;
    const closeTime = openTime + intervalMs - 1;
    const change = (Math.random() - 0.49) * (basePrice * 0.005);
    const open = currentPrice;
    const close = Math.max(1, open + change);
    const high = Math.max(open, close) + Math.random() * (basePrice * 0.002);
    const low = Math.min(open, close) - Math.random() * (basePrice * 0.002);
    const volume = 10 + Math.random() * 50;
    
    candles.push({
      symbol,
      timeframe,
      openTime,
      closeTime,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: volume * close,
      trades: Math.floor(20 + Math.random() * 80),
    });
    
    currentPrice = close;
  }
  return candles;
}

/** Query candles from the local DB with graceful fallback. */
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

  try {
    return await get<RawCandle[]>(`/api/candles?${url}`);
  } catch (err) {
    console.warn(`[fetchCandles] Backend unreachable (${(err as Error).message}), using fallback candles.`);
    return generateFallbackCandles(params.symbol, params.timeframe, params.limit ?? 100);
  }
}

/** Load more historical candles by fetching from Binance and upserting. */
export async function loadMoreCandles(params: {
  symbol: string;
  timeframe: Timeframe;
  beforeMs: number;
  limit?: number;
}): Promise<{ symbol: string; timeframe: string; inserted: number; candles: RawCandle[] }> {
  try {
    return await post<{ symbol: string; timeframe: string; inserted: number; candles: RawCandle[] }>("/api/candles/load-more", {
      symbol: params.symbol,
      timeframe: params.timeframe,
      beforeMs: params.beforeMs,
      limit: params.limit ?? 1000,
    });
  } catch (err) {
    console.warn(`[loadMoreCandles] Backend unreachable (${(err as Error).message})`);
    return {
      symbol: params.symbol,
      timeframe: params.timeframe,
      inserted: 0,
      candles: [],
    };
  }
}

/** Update a chart's config (symbol/timeframe). Returns updated configs. */
export async function updateChartConfig(params: {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
}): Promise<ChartConfig[]> {
  try {
    return await put<ChartConfig[]>("/api/candles/chart-configs", {
      chartIndex: params.chartIndex,
      symbol: params.symbol,
      timeframe: params.timeframe,
    });
  } catch (err) {
    console.warn(`[updateChartConfig] Backend unreachable (${(err as Error).message})`);
    return [];
  }
}
