/**
 * Tests for RsiStrategy. Construct deterministic price series that
 * drive the RSI to a known extreme and verify the signal.
 *
 * Wilder's RSI requires `period + 1` closes minimum. We use period = 5
 * for compactness.
 */
import { describe, it, expect } from "vitest";

import { RsiStrategy, RSI_STRATEGY_ID } from "../../src/modules/strategy/strategies/RsiStrategy";
import { candleAt, ctxOf } from "./_fixtures";

describe("RsiStrategy", () => {
  const strategy = new RsiStrategy();

  it("exposes the documented contract fields", () => {
    expect(strategy.id).toBe(RSI_STRATEGY_ID);
    expect(strategy.family).toBe("MOMENTUM");
    expect(strategy.parameterSpec.fields).toHaveLength(3);
    expect(strategy.defaultParameters()).toEqual({
      period: 14,
      buyThreshold: 30,
      sellThreshold: 70,
    });
  });

  describe("parameter validation", () => {
    it("rejects buyThreshold ≥ sellThreshold", () => {
      expect(strategy.validateParameters({ period: 14, buyThreshold: 50, sellThreshold: 50 }).ok).toBe(false);
      expect(strategy.validateParameters({ period: 14, buyThreshold: 70, sellThreshold: 70 }).ok).toBe(false);
    });

    it("accepts valid parameters", () => {
      expect(strategy.validateParameters({ period: 14, buyThreshold: 30, sellThreshold: 70 }).ok).toBe(true);
    });

    it("rejects non-object input", () => {
      expect(strategy.validateParameters(undefined).ok).toBe(false);
    });
  });

  describe("warm-up", () => {
    it("returns HOLD when history is shorter than period + 1", () => {
      const candles = [candleAt(0, 100), candleAt(1, 99), candleAt(2, 98)];
      const sig = strategy.analyze(ctxOf(candles, { period: 14, buyThreshold: 30, sellThreshold: 70 }));
      expect(sig.side).toBe("HOLD");
      expect(sig.reason).toMatch(/warm-up/);
    });
  });

  describe("oversold → BUY", () => {
    it("emits BUY after a sustained downtrend pushes RSI below buyThreshold", () => {
      // Build a long downtrend so all 15 closes are lower than the prior.
      const candles = Array.from({ length: 20 }, (_, i) => candleAt(i, 100 - i * 2));
      const sig = strategy.analyze(ctxOf(candles, { period: 14, buyThreshold: 30, sellThreshold: 70 }));
      expect(sig.side).toBe("BUY");
      expect(sig.reason).toMatch(/oversold/);
      const meta = sig.metadata as { rsi: number };
      expect(meta.rsi).toBeLessThan(30);
    });
  });

  describe("overbought → SELL", () => {
    it("emits SELL after a sustained uptrend pushes RSI above sellThreshold", () => {
      const candles = Array.from({ length: 20 }, (_, i) => candleAt(i, 100 + i * 2));
      const sig = strategy.analyze(ctxOf(candles, { period: 14, buyThreshold: 30, sellThreshold: 70 }));
      expect(sig.side).toBe("SELL");
      expect(sig.reason).toMatch(/overbought/);
      const meta = sig.metadata as { rsi: number };
      expect(meta.rsi).toBeGreaterThan(70);
    });
  });

  describe("neutral → HOLD", () => {
    it("emits HOLD when RSI is inside the neutral band", () => {
      // Alternating tiny moves ⇒ RSI oscillates around 50.
      const candles = Array.from({ length: 20 }, (_, i) => candleAt(i, 100 + (i % 2 === 0 ? 0.1 : -0.1)));
      const sig = strategy.analyze(ctxOf(candles, { period: 14, buyThreshold: 30, sellThreshold: 70 }));
      expect(sig.side).toBe("HOLD");
      expect(sig.reason).toMatch(/neutral/);
    });
  });
});