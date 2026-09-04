/**
 * Pure numeric helpers for computing classic technical indicators from
 * close-price arrays. These intentionally mirror the backend's
 * `backend/src/modules/strategy/strategies/_indicators.ts` so the
 * Realtime Chart visualises the SAME math the Strategy domain uses.
 *
 * MUST stay infrastructure-free: no React, no DOM, no fetch. Pure
 * number math + arrays.
 *
 * Conventions:
 *  - Inputs are ALWAYS ascending by candle openTime.
 *  - `closes[closes.length - 1]` is the current/most-recent close.
 *  - "warm-up" indicators return `null` until there are enough data
 *    points; callers MUST treat `null` as "not enough history yet".
 */

export interface Candle {
  /** Epoch milliseconds. */
  readonly openTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * Simple Moving Average over the LAST `period` closes.
 *
 * Returns `null` when there are fewer than `period` closes available
 * (canonical warm-up sentinel).
 *
 * Mirrors: `backend/src/modules/strategy/strategies/_indicators.ts →
 *            simpleMovingAverage()`
 */
export function simpleMovingAverage(
  closes: ReadonlyArray<number>,
  period: number,
): number | null {
  if (!Number.isInteger(period) || period <= 0) return null;
  if (closes.length < period) return null;

  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const v = closes[i];
    if (v === undefined || !Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / period;
}

/** Project an array of candles down to just their closes (asc). */
export function closesOf(candles: ReadonlyArray<Candle>): number[] {
  const out: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i += 1) {
    out[i] = candles[i]?.close ?? Number.NaN;
  }
  return out;
}

/**
 * MA Crossover signal — mirrors
 * `backend/src/modules/strategy/strategies/MovingAverageStrategy.analyze`.
 *
 * Produces a single Signal for the candle at `closes[closes.length - 1]`.
 * Requires at least `slowPeriod + 1` closes so the previous-bar crossover
 * can be detected without look-ahead.
 *
 * Tie behaviour is intentionally identical to the backend strategy:
 *   - first warm-up candle → HOLD ("warm-up")
 *   - not enough history   → HOLD ("warm-up")
 *   - no crossover         → HOLD ("no crossover")
 */
export type SignalSide = "BUY" | "SELL" | "HOLD";

export interface MASignal {
  readonly side: SignalSide;
  readonly fastSMA: number | null;
  readonly slowSMA: number | null;
  readonly reason: string;
}

/**
 * Compute the MA crossover signal at the LATEST candle in `closes`.
 *
 * @param closes       ascending closes (current candle is last)
 * @param fastPeriod   default 9  (matches MovingAverageStrategy defaults)
 * @param slowPeriod   default 21 (matches MovingAverageStrategy defaults)
 */
export function maCrossoverSignal(
  closes: ReadonlyArray<number>,
  fastPeriod = 9,
  slowPeriod = 21,
): MASignal {
  if (
    !Number.isInteger(fastPeriod) || fastPeriod <= 0 ||
    !Number.isInteger(slowPeriod) || slowPeriod <= 0 ||
    fastPeriod >= slowPeriod
  ) {
    return { side: "HOLD", fastSMA: null, slowSMA: null, reason: "invalid parameters" };
  }

  const fastNow = simpleMovingAverage(closes, fastPeriod);
  const slowNow = simpleMovingAverage(closes, slowPeriod);
  if (fastNow === null || slowNow === null) {
    return { side: "HOLD", fastSMA: fastNow, slowSMA: slowNow, reason: "warm-up" };
  }

  // Need one full prior bar to detect the CROSS, never look ahead.
  if (closes.length < slowPeriod + 1) {
    return {
      side: "HOLD",
      fastSMA: fastNow,
      slowSMA: slowNow,
      reason: "warm-up (need ≥ slowPeriod + 1 candles for crossover detection)",
    };
  }

  const yesterdaysCloses = closes.slice(0, closes.length - 1);
  const fastYesterday = simpleMovingAverage(yesterdaysCloses, fastPeriod);
  const slowYesterday = simpleMovingAverage(yesterdaysCloses, slowPeriod);
  if (fastYesterday === null || slowYesterday === null) {
    return { side: "HOLD", fastSMA: fastNow, slowSMA: slowNow, reason: "warm-up" };
  }

  const spreadNow = fastNow - slowNow;
  const spreadYesterday = fastYesterday - slowYesterday;

  if (spreadYesterday <= 0 && spreadNow > 0) {
    return {
      side: "BUY",
      fastSMA: fastNow,
      slowSMA: slowNow,
      reason: "golden cross: fast SMA crossed above slow SMA",
    };
  }
  if (spreadYesterday >= 0 && spreadNow < 0) {
    return {
      side: "SELL",
      fastSMA: fastNow,
      slowSMA: slowNow,
      reason: "death cross: fast SMA crossed below slow SMA",
    };
  }
  return {
    side: "HOLD",
    fastSMA: fastNow,
    slowSMA: slowNow,
    reason: "no crossover",
  };
}

/**
 * Compute a single-SMA series (one value per candle, aligned by index).
 * Returns nothing for indices before enough history (`< period`) so the
 * chart's line series naturally starts after the warm-up window.
 */
export function computeMASeries(
  candles: ReadonlyArray<Candle>,
  period: number,
): Array<{ time: number; value: number }> {
  if (!Number.isInteger(period) || period <= 0 || candles.length < period) {
    return [];
  }
  const out: Array<{ time: number; value: number }> = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      out.push({ time: Math.floor(candles[i].openTime / 1000), value: sum / period });
    }
  }
  return out;
}

/**
 * Walk the closes once and produce a Signal per candle, using the same
 * crossover logic as the backend `MovingAverageStrategy`. The first
 * `slowPeriod` candles are always HOLD (warm-up). No look-ahead:
 * candle at index `i` only uses closes[0..i].
 *
 * Complexity: O(n) — two rolling sums ("current" and "previous" bar)
 * maintained in lockstep.
 */
export function computeMASignals(
  candles: ReadonlyArray<Candle>,
  fastPeriod = 9,
  slowPeriod = 21,
): Array<{ openTime: number; side: SignalSide }> {
  if (
    candles.length === 0 ||
    !Number.isInteger(fastPeriod) || fastPeriod <= 0 ||
    !Number.isInteger(slowPeriod) || slowPeriod <= 0 ||
    fastPeriod >= slowPeriod
  ) {
    return [];
  }
  const n = candles.length;
  const closes = new Array<number>(n);
  for (let i = 0; i < n; i += 1) closes[i] = candles[i].close;

  const out: Array<{ openTime: number; side: SignalSide }> = new Array(n);

  // "Current" rolling sums over closes[0..i].
  let fastSum = 0;
  let slowSum = 0;
  // "Previous-bar" rolling sums over closes[0..i-1], kept one step
  // behind the current sums.
  let fastSumPrev = 0;
  let slowSumPrev = 0;
  // How many closes have been added to the previous-bar window.
  let prevLen = 0;

  for (let i = 0; i < n; i += 1) {
    // 1. Advance the previous-bar window using the close that was the
    //    "current" before this iteration.
    if (i >= 1) {
      const prevC = closes[i - 1];
      fastSumPrev += prevC;
      slowSumPrev += prevC;
      if (prevLen >= fastPeriod) fastSumPrev -= closes[i - 1 - fastPeriod];
      if (prevLen >= slowPeriod) slowSumPrev -= closes[i - 1 - slowPeriod];
      prevLen += 1;
    }

    // 2. Add this close into the "current" rolling sums.
    const c = closes[i];
    fastSum += c;
    slowSum += c;
    if (i >= fastPeriod) fastSum -= closes[i - fastPeriod];
    if (i >= slowPeriod) slowSum -= closes[i - slowPeriod];

    const fastNow = i >= fastPeriod - 1 ? fastSum / fastPeriod : null;
    const slowNow = i >= slowPeriod - 1 ? slowSum / slowPeriod : null;
    const prevFast = prevLen >= fastPeriod ? fastSumPrev / fastPeriod : null;
    const prevSlow = prevLen >= slowPeriod ? slowSumPrev / slowPeriod : null;

    let side: SignalSide = "HOLD";
    if (fastNow !== null && slowNow !== null && prevFast !== null && prevSlow !== null) {
      const spreadNow = fastNow - slowNow;
      const spreadYesterday = prevFast - prevSlow;
      if (spreadYesterday <= 0 && spreadNow > 0) side = "BUY";
      else if (spreadYesterday >= 0 && spreadNow < 0) side = "SELL";
    }

    out[i] = { openTime: candles[i].openTime, side };
  }
  return out;
}
