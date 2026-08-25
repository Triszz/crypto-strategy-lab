/**
 * Tests for MovingAverageStrategy.
 *
 * The strategy emits BUY on golden cross, SELL on death cross, HOLD
 * otherwise. We construct deterministic monotonic trend candles so the
 * crossover is triggered by a single candle transition.
 */
import { describe, it, expect } from "vitest";

import { MovingAverageStrategy, MA_STRATEGY_ID } from "../../src/modules/strategy/strategies/MovingAverageStrategy";
import type { StrategyCandle } from "../../src/modules/strategy/domain/StrategyContext";
import { candleAt, ctxOf, trendCandles } from "./_fixtures";

describe("MovingAverageStrategy", () => {
  const strategy = new MovingAverageStrategy();

  it("exposes the documented contract fields", () => {
    expect(strategy.id).toBe(MA_STRATEGY_ID);
    expect(strategy.family).toBe("TREND");
    expect(strategy.requiredHistory).toBeGreaterThanOrEqual(2);
    expect(strategy.parameterSpec.fields).toHaveLength(2);
    expect(strategy.defaultParameters()).toEqual({ fastPeriod: 9, slowPeriod: 21 });
  });

  describe("parameter validation", () => {
    it("rejects non-positive integers", () => {
      expect(strategy.validateParameters({ fastPeriod: 0, slowPeriod: 21 }).ok).toBe(false);
      expect(strategy.validateParameters({ fastPeriod: 9, slowPeriod: 0 }).ok).toBe(false);
    });

    it("rejects fastPeriod ≥ slowPeriod", () => {
      expect(strategy.validateParameters({ fastPeriod: 21, slowPeriod: 21 }).ok).toBe(false);
      expect(strategy.validateParameters({ fastPeriod: 30, slowPeriod: 21 }).ok).toBe(false);
    });

    it("rejects unknown parameters", () => {
      const r = strategy.validateParameters({ fastPeriod: 9, slowPeriod: 21, foo: 1 });
      expect(r.ok).toBe(false);
    });

    it("rejects non-object input", () => {
      expect(strategy.validateParameters(null).ok).toBe(false);
      expect(strategy.validateParameters(42).ok).toBe(false);
    });

    it("accepts valid parameters", () => {
      expect(strategy.validateParameters({ fastPeriod: 9, slowPeriod: 21 }).ok).toBe(true);
    });
  });

  describe("warm-up", () => {
    it("returns HOLD when history is shorter than slow period + 1", () => {
      const candles = trendCandles(10, 100, 1); // length 10 < 21 + 1
      const sig = strategy.analyze(ctxOf(candles, { fastPeriod: 9, slowPeriod: 21 }));
      expect(sig.side).toBe("HOLD");
      expect(sig.reason).toMatch(/warm-up/);
    });
  });

  describe("golden cross → BUY", () => {
    it("emits BUY when fast SMA crosses above slow SMA (ascending trend)", () => {
      // 20 flat candles (close=100) + 1 sharp-rise candle (close=500).
      // Total = 21 = slowPeriod + 1 ⇒ passes crossover warm-up gate.
      // Yesterday's window: 20 flat candles. fast SMA = slow SMA = 100. spreadYesterday = 0.
      // Today's window:      20 flat + 1 spike (close=500).
      //   fast SMA(5) = avg(100,100,100,100,500) = 180
      //   slow SMA(20) = avg(100×20 + 500)/21 ≈ 104.76
      //   spreadNow = 75.24 > 0   ⇒ golden cross fires.
      const candles: StrategyCandle[] = [];
      for (let i = 0; i < 20; i++) candles.push(candleAt(i, 100));
      candles.push(candleAt(20, 500));
      const sig = strategy.analyze(ctxOf(candles, { fastPeriod: 5, slowPeriod: 20 }));
      expect(sig.side).toBe("BUY");
      expect(sig.reason).toMatch(/golden cross/);
    });
  });

  describe("death cross → SELL", () => {
    it("emits SELL when fast SMA crosses below slow SMA (descending trend)", () => {
      // 20 flat candles at 200 + 1 sharp-drop candle at 50.
      // Yesterday's window: 20 flat. fast SMA = slow SMA = 200. spreadYesterday = 0.
      // Today's window:      20 flat + 1 collapse.
      //   fast SMA(5) = avg(200,200,200,200,50) = 170
      //   slow SMA(20) = avg(200×20 + 50)/21 ≈ 192.86
      //   spreadNow = -22.86 < 0   ⇒ death cross fires.
      const candles: StrategyCandle[] = [];
      for (let i = 0; i < 20; i++) candles.push(candleAt(i, 200));
      candles.push(candleAt(20, 50));
      const sig = strategy.analyze(ctxOf(candles, { fastPeriod: 5, slowPeriod: 20 }));
      expect(sig.side).toBe("SELL");
      expect(sig.reason).toMatch(/death cross/);
    });
  });

  describe("no crossover → HOLD", () => {
    it("emits HOLD on a flat trend", () => {
      const candles = trendCandles(40, 100); // perfectly flat
      const sig = strategy.analyze(ctxOf(candles, { fastPeriod: 5, slowPeriod: 20 }));
      expect(sig.side).toBe("HOLD");
    });
  });
});