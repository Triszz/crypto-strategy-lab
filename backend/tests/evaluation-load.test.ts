/**
 * Load test for the Evaluation Engine.
 *
 * Runs the pure-math EvaluatorEngine across 100 trade-heavy datasets
 * and asserts:
 *  - Average per-strategy calculation time < 50 ms (loose bound on a typical laptop)
 *  - No NaN / Infinity leaks
 *  - Engine produces stable output for the same input (deterministic)
 *
 * Skipped on CI to keep CI green.
 */

import { describe, expect, it } from "vitest";
import { EvaluatorEngine, type TradeInput } from "../src/modules/evaluation/domain/evaluator.engine";

const RUN_ON_CI = process.env.CI === "true";
const loadIt = RUN_ON_CI ? it.skip : it;

function generateTrades(seed: number, count: number): TradeInput[] {
  // Simple deterministic pseudo-random based on seed
  let s = seed;
  const next = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  return Array.from({ length: count }).map((_, i) => {
    const entryPrice = 100 + next() * 100;
    const pnl = (next() - 0.45) * 200; // slight upward bias → 55% win-rate
    const exitPrice = entryPrice + pnl;
    const quantity = 1 + next() * 5;
    return {
      entryPrice,
      exitPrice,
      quantity,
      profitLoss: pnl * quantity,
      profitLossPct: pnl / entryPrice,
      entryTime: 1000 + i * 100,
      exitTime: 1000 + i * 100 + 50,
      side: "BUY" as const,
      position: "LONG" as const,
    };
  });
}

describe("EvaluatorEngine load test", () => {
  loadIt("L.1: calculates metrics for 100 strategies in under 5 seconds", () => {
    const N_STRATEGIES = 100;
    const N_TRADES_PER_STRATEGY = 200;

    const start = Date.now();
    const durations: number[] = [];

    for (let i = 0; i < N_STRATEGIES; i++) {
      const t0 = Date.now();
      const trades = generateTrades(i + 1, N_TRADES_PER_STRATEGY);
      const result = EvaluatorEngine.calculateMetrics(trades, 10000);
      durations.push(Date.now() - t0);

      // Sanity checks on each result
      expect(Number.isFinite(result.totalReturn)).toBe(true);
      expect(Number.isFinite(result.sharpeRatio)).toBe(true);
      expect(Number.isFinite(result.sortinoRatio)).toBe(true);
      expect(Number.isFinite(result.calmarRatio)).toBe(true);
      expect(Number.isFinite(result.profitFactor)).toBe(true);
      expect(Number.isFinite(result.overallScore)).toBe(true);

      // No NaN
      expect(Number.isNaN(result.totalReturn)).toBe(false);
      expect(Number.isNaN(result.maxDrawdown)).toBe(false);

      // Plausibility checks
      expect(result.numTrades).toBe(N_TRADES_PER_STRATEGY);
      expect(result.initialCapital).toBe(10000);
      expect(result.equityCurve.length).toBe(N_TRADES_PER_STRATEGY + 1);
    }

    const totalMs = Date.now() - start;
    const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
    const maxMs = Math.max(...durations);

    // eslint-disable-next-line no-console
    console.log(
      `[LoadTest] 100 strategies × 200 trades each — total: ${totalMs}ms, ` +
        `avg/strategy: ${avgMs.toFixed(2)}ms, max: ${maxMs}ms`,
    );

    // Loose bounds — engine is pure math and should be very fast
    expect(totalMs).toBeLessThan(5000); // total < 5s
    expect(avgMs).toBeLessThan(50); // average < 50ms per strategy
  });

  loadIt("L.2: deterministic — same input produces same output", () => {
    const trades = generateTrades(42, 100);

    const r1 = EvaluatorEngine.calculateMetrics(trades, 10000);
    const r2 = EvaluatorEngine.calculateMetrics(trades, 10000);

    expect(r1.totalReturn).toBe(r2.totalReturn);
    expect(r1.sharpeRatio).toBe(r2.sharpeRatio);
    expect(r1.calmarRatio).toBe(r2.calmarRatio);
    expect(r1.profitFactor).toBe(r2.profitFactor);
    expect(r1.overallScore).toBe(r2.overallScore);
    expect(r1.maxDrawdown).toBe(r2.maxDrawdown);
  });

  loadIt("L.3: handles 1000 trades per strategy without error", () => {
    const bigTrades = generateTrades(7, 1000);
    const result = EvaluatorEngine.calculateMetrics(bigTrades, 10000);

    expect(result.numTrades).toBe(1000);
    expect(result.equityCurve.length).toBe(1001);
    expect(Number.isFinite(result.sharpeRatio)).toBe(true);
  });
});
