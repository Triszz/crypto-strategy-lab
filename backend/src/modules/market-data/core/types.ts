/**
 * Core types for Market Data module.
 * These types are exchange-agnostic and used across all layers.
 */

// ===== Timeframe =====
export const SUPPORTED_TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
] as const;

export const DEFAULT_TIMEFRAMES = ["1m", "1h", "4h", "1d"] as const;

export type Timeframe = (typeof SUPPORTED_TIMEFRAMES)[number];
export type DefaultTimeframe = (typeof DEFAULT_TIMEFRAMES)[number];

export const TIMEFRAME_TO_BINANCE: Record<Timeframe, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "6h": "6h",
  "8h": "8h",
  "12h": "12h",
  "1d": "1d",
  "3d": "3d",
  "1w": "1w",
  "1M": "1M",
};

const TIMEFRAME_TO_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
};

const BINANCE_INTERVAL_TO_TIMEFRAME: ReadonlyMap<string, Timeframe> = new Map(
  (Object.entries(TIMEFRAME_TO_BINANCE) as Array<[Timeframe, string]>).map(
    ([tf, binance]) => [binance, tf],
  ),
);

export function getStreamKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol.toLowerCase()}@${timeframe}`;
}

export function getBinanceStreamName(
  symbol: string,
  timeframe: Timeframe,
): string {
  const interval = TIMEFRAME_TO_BINANCE[timeframe];
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

export function parseBinanceInterval(interval: string): Timeframe {
  const tf = BINANCE_INTERVAL_TO_TIMEFRAME.get(interval);
  if (!tf) {
    throw new Error(`Unsupported Binance interval: ${interval}`);
  }
  return tf;
}

export function isSupportedTimeframe(value: string): value is Timeframe {
  return (SUPPORTED_TIMEFRAMES as readonly string[]).includes(value);
}

export function timeframeToMs(timeframe: Timeframe): number {
  return TIMEFRAME_TO_MS[timeframe];
}

export function isTimeframe(value: string): value is Timeframe {
  return isSupportedTimeframe(value);
}

// ===== Candle =====
/**
 * Normalized candle representation.
 * All exchanges must convert their native format into this shape.
 * 
 * openTime and closeTime are epoch milliseconds.
 */
export interface Candle {
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

/**
 * Canonical key used for streaming rooms, logs, and socket payloads.
 * Format: `BTCUSDT@1h@1700000400000`.
 */
export function candleKey(c: Pick<Candle, "symbol" | "timeframe" | "openTime">): string {
  return `${c.symbol}@${c.timeframe}@${c.openTime}`;
}

/**
 * Socket.IO room name used by SocketGateway.
 */
export function candleRoom(c: Pick<Candle, "symbol" | "timeframe">): string {
  return `candles:${c.symbol.toLowerCase()}@${c.timeframe}`;
}

// ===== ChartConfig =====
/**
 * Chart configuration from database.
 */
export interface ChartConfig {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
  updatedAt: Date;
}

export interface ActiveChartConfig {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
  /** Cached namespaced stream key, e.g. `btcusdt@kline_1h`. */
  streamKey: ReturnType<typeof getStreamKey>;
}
