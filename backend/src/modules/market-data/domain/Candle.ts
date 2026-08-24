import type { Timeframe } from "./Timeframe";

/**
 * Internal Candle shape used across the Market Data module.
 *
 * `openTime` and `closeTime` are stored as epoch milliseconds (Binance
 * always uses milliseconds). They are converted to BigInt when persisted
 * via `PostgresCandleRepository`. All numeric OHLCV fields are plain
 * numbers — the Postgres repository is responsible for casting to
 * Prisma `Decimal`.
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
 * Socket.IO room name used by `SocketGateway` to broadcast events to
 * the right listener group.
 */
export function candleRoom(c: Pick<Candle, "symbol" | "timeframe">): string {
  return `candles:${c.symbol.toLowerCase()}@${c.timeframe}`;
}
