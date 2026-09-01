/**
 * Shared candle + context fixtures for Strategy unit tests.
 *
 * Pure functions — no DB, no network. Every candle's `openTime` is
 * strictly increasing so the SMA / RSI / Bollinger helpers can rely on
 * ASCENDING-order assumptions. `closeTime` mirrors `openTime + 60_000`
 * for the 1m timeframe but tests do not depend on it.
 */
import type { StrategyCandle, StrategyContext } from "../../src/modules/strategy/domain/StrategyContext";

const ONE_MINUTE_MS = 60_000;
const BASE_OPEN = 1_700_000_000_000;

/**
 * Build a candle from a close price; other OHLCV fields are computed to
 * keep the candle "realistic" enough for SMA / RSI / Bollinger math.
 *
 * - open  = close (so the body has zero length and tests don't depend on it)
 * - high  = max(close, 0) + 0.5 (always above)
 * - low   = max(0, min(close, 0)) - 0.5 (always below, but never negative)
 */
export function candleAt(index: number, close: number): StrategyCandle {
  const openTime = BASE_OPEN + index * ONE_MINUTE_MS;
  const safeClose = Number.isFinite(close) ? close : 0;
  return {
    openTime,
    closeTime: openTime + ONE_MINUTE_MS,
    open: safeClose,
    high: safeClose + 0.5,
    low: Math.max(0, safeClose - 0.5),
    close: safeClose,
    volume: 100,
  };
}

/** Build a deterministic ascending-then-descending trend for MA tests. */
export function trendCandles(
  length: number,
  start = 100,
  step = 1,
): ReadonlyArray<StrategyCandle> {
  const candles: StrategyCandle[] = [];
  for (let i = 0; i < length; i++) {
    const close = start + i * step;
    candles.push(candleAt(i, close));
  }
  return candles;
}

/** Build a context from an array of candles + parameters. */
export function ctxOf(
  history: ReadonlyArray<StrategyCandle>,
  parameters: Readonly<Record<string, unknown>>,
  symbol = "BTCUSDT",
): StrategyContext {
  const last = history[history.length - 1];
  if (!last) {
    throw new Error("ctxOf: history must contain at least one candle.");
  }
  return {
    symbol,
    timeframe: "1m",
    candle: last,
    history,
    parameters,
  };
}