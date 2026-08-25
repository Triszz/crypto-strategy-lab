/**
 * strategy · strategies · internal indicator helpers
 *
 * Pure numeric helpers used by concrete strategies to compute classic
 * technical indicators (SMA, RSI, Bollinger bands, etc.) from a
 * `ReadonlyArray<StrategyCandle>`.
 *
 * The underscore prefix marks the file as an internal utility — it is
 * not part of the public Strategy domain contract (which exposes only
 * `Strategy`, `Signal`, `StrategyContext`, `ParamSpec`, `StrategyRegistry`).
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK. Pure number math + arrays.
 *
 * Conventions:
 *  - Inputs are ALWAYS ascending by `openTime`.
 *  - The `current` candle is ALWAYS the LAST element of the array.
 *  - All "lookback" indicators require AT LEAST `period` data points
 *    AND the *previous* `period` data points to produce a stable
 *    average — callers MUST validate `history.length >= required + 1`
 *    before invoking these helpers. Returning `null` on insufficient
 *    data is the canonical "warm-up" sentinel.
 *  - All returned values use plain JS `number`. No `Decimal`, no BigInt.
 *    Strategies do not need sub-cent precision.
 */
import type { StrategyCandle } from "../domain/StrategyContext";

/**
 * Simple Moving Average over `closes` using the LAST `period` values.
 * Returns `null` when there are fewer than `period` closes available.
 *
 * Complexity: O(period) via rolling sum (constant per call after the
 * initial sum). Deterministic for the same input.
 */
export function simpleMovingAverage(closes: ReadonlyArray<number>, period: number): number | null {
  if (!Number.isInteger(period) || period <= 0) {
    return null;
  }
  if (closes.length < period) {
    return null;
  }
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const v = closes[i];
    if (v === undefined || !Number.isFinite(v)) {
      return null;
    }
    sum += v;
  }
  return sum / period;
}

/**
 * Population standard deviation over the LAST `period` values of
 * `closes`. Returns `null` when there are fewer than `period` values
 * or when `mean` is not finite.
 */
export function populationStdDev(
  closes: ReadonlyArray<number>,
  period: number,
  mean: number,
): number | null {
  if (!Number.isInteger(period) || period <= 0) {
    return null;
  }
  if (closes.length < period || !Number.isFinite(mean)) {
    return null;
  }
  let sumSq = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const v = closes[i];
    if (v === undefined || !Number.isFinite(v)) {
      return null;
    }
    const d = v - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / period);
}

/**
 * Wilder's Relative Strength Index over the LAST `period` closes. Uses
 * the exponentially-smoothed average gain / loss formulation (Wilder,
 * 1978). Returns a value in `[0, 100]`, or `null` when there are
 * insufficient data points.
 *
 * For `period` closes the algorithm needs `period` *differences*, which
 * means at minimum `period + 1` closes in `closes`. The first average
 * is the arithmetic mean of the first `period` differences; subsequent
 * averages are smoothed.
 */
export function wilderRSI(closes: ReadonlyArray<number>, period: number): number | null {
  if (!Number.isInteger(period) || period <= 0) {
    return null;
  }
  // Need at least `period + 1` closes to compute `period` differences.
  if (closes.length < period + 1) {
    return null;
  }

  // Compute the initial average gain/loss across the FIRST `period`
  // differences. The differences start at index 1.
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev === undefined || curr === undefined) {
      return null;
    }
    const change = curr - prev;
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum += -change;
    }
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // Wilder smoothing for the remaining differences.
  for (let i = period + 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev === undefined || curr === undefined) {
      return null;
    }
    const change = curr - prev;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Project the closes array (ascending) out of an array of candles.
 * Deterministic; returns a new array.
 */
export function closesOf(candles: ReadonlyArray<StrategyCandle>): number[] {
  const out: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c === undefined) {
      out[i] = Number.NaN;
    } else {
      out[i] = c.close;
    }
  }
  return out;
}

/**
 * Project the highs array (ascending) out of an array of candles.
 */
export function highsOf(candles: ReadonlyArray<StrategyCandle>): number[] {
  const out: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c === undefined) {
      out[i] = Number.NaN;
    } else {
      out[i] = c.high;
    }
  }
  return out;
}

/**
 * Project the lows array (ascending) out of an array of candles.
 */
export function lowsOf(candles: ReadonlyArray<StrategyCandle>): number[] {
  const out: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c === undefined) {
      out[i] = Number.NaN;
    } else {
      out[i] = c.low;
    }
  }
  return out;
}