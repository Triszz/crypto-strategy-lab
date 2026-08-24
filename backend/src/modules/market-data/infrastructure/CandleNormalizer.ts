import type { Candle } from "../domain/Candle";
import type { Timeframe } from "../domain/Timeframe";
import {
  parseBinanceInterval,
  TIMEFRAME_TO_BINANCE,
  timeframeToMs,
} from "../domain/Timeframe";

/**
 * REST `GET /api/v3/klines` returns one row per array index. We declare
 * an indexed tuple-like interface instead of a `number[]` so callers can
 * rely on the documented positions without runtime checks.
 */
export interface BinanceKlineDTO {
  0: number; // openTime (ms)
  1: string; // open
  2: string; // high
  3: string; // low
  4: string; // close
  5: string; // volume
  6: number; // closeTime (ms)
  7: string; // quoteVolume
  8: number; // trades
}

export interface BinanceKlineWSKline {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  q: string;
  n: number;
  x: boolean;
}

export interface BinanceKlineWSMessage {
  e: "kline";
  E: number;
  s: string;
  k: BinanceKlineWSKline;
}

/**
 * Single point of contact with Binance's wire format. Every adapter
 * (REST, WebSocket) must funnel through this normalizer before the
 * internal `Candle` schema is produced.
 */
export class CandleNormalizer {
  /**
   * Convert a single REST kline row into the internal `Candle` shape.
   * The caller MUST supply the timeframe (Binance does not include it
   * in the row). When `timeframeHint` is omitted we infer it from the
   * difference between open and close time.
   */
  static fromRestKline(
    symbol: string,
    dto: BinanceKlineDTO,
    timeframeHint?: Timeframe,
  ): Candle {
    const timeframe = timeframeHint ?? inferTimeframeFromDuration(dto);
    return {
      symbol,
      timeframe,
      openTime: dto[0],
      closeTime: dto[6],
      open: Number(dto[1]),
      high: Number(dto[2]),
      low: Number(dto[3]),
      close: Number(dto[4]),
      volume: Number(dto[5]),
      quoteVolume: Number(dto[7]),
      trades: dto[8],
    };
  }

  static fromRestKlines(
    symbol: string,
    rows: BinanceKlineDTO[],
    timeframe: Timeframe,
  ): Candle[] {
    return rows.map((row) => CandleNormalizer.fromRestKline(symbol, row, timeframe));
  }

  /**
   * Convert a WebSocket kline update into the internal `Candle` shape.
   * Binance sends `k.i` (interval string) on every message — we trust
   * it and look up the canonical `Timeframe` literal.
   */
  static fromWsKline(msg: BinanceKlineWSMessage): Candle {
    if (msg.e !== "kline") {
      throw new Error(
        `Expected kline event, received "${(msg as { e: string }).e}"`,
      );
    }
    const k = msg.k;
    return {
      symbol: msg.s,
      timeframe: parseBinanceInterval(k.i),
      openTime: k.t,
      closeTime: k.T,
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
      quoteVolume: Number(k.q),
      trades: k.n,
    };
  }
}

function inferTimeframeFromDuration(dto: BinanceKlineDTO): Timeframe {
  const duration = dto[6] - dto[0];
  const match = Object.entries(TIMEFRAME_TO_BINANCE).find(
    ([tf]) => timeframeToMs(tf as Timeframe) === duration,
  );
  if (!match) {
    throw new Error(
      `Cannot infer timeframe from candle duration ${duration}ms`,
    );
  }
  return match[0] as Timeframe;
}
