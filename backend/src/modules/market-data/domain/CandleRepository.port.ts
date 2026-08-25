import type { Candle } from "./Candle";
import type { Timeframe } from "./Timeframe";

export interface CandleQuery {
  symbol: string;
  timeframe: Timeframe;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

/**
 * Persistence port for candles. Implemented by
 * `PostgresCandleRepository`. The interface is intentionally narrow so
 * the Market Data service never reaches for a Prisma client directly.
 */
export interface CandleRepository {
  upsert(candle: Candle): Promise<void>;
  upsertBatch(candles: Candle[]): Promise<number>;
  query(q: CandleQuery): Promise<Candle[]>;
  getLatestOpen(symbol: string, timeframe: Timeframe): Promise<Candle | null>;
  deleteAll(): Promise<void>;
}
