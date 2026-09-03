/**
 * REST client for the Market Data module.
 * All calls go to the backend on the same origin (Vite dev server proxies /api).
 */

export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "8h" | "12h" | "1d" | "3d" | "1w" | "1M";

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
  console.log(`[loadMoreCandles] Requesting: ${params.symbol} ${params.timeframe}, before ${new Date(params.beforeMs).toISOString()}, limit ${params.limit ?? 500}`);
  
  try {
    const result = await post<{ symbol: string; timeframe: string; inserted: number; candles: RawCandle[] }>("/api/candles/load-more", {
      symbol: params.symbol,
      timeframe: params.timeframe,
      beforeMs: params.beforeMs,
      limit: params.limit ?? 500,
    });
    
    console.log(`[loadMoreCandles] ✅ Loaded ${result.candles.length} candles (${result.inserted} inserted to DB)`);
    return result;
  } catch (err) {
    console.warn(`[loadMoreCandles] ❌ Backend unreachable (${(err as Error).message})`);
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
