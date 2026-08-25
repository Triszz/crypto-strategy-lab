/**
 * Tests for BollingerBandsStrategy. Construct deterministic price
 * series that drive the close below / above / inside the bands and
 * verify the signal.
 */
import { describe, it, expect } from "vitest";

import {
  BollingerBandsStrategy,
  BOLLINGER_STRATEGY_ID,
} from "../../src/modules/strategy/strategies/BollingerBandsStrategy";
import { candleAt, ctxOf } from "./_fixtures";

describe("BollingerBandsStrategy", () => {
  const strategy = new BollingerBandsStrategy();

  it("exposes the documented contract fields", () => {
    expect(strategy.id).toBe(BOLLINGER_STRATEGY_ID);
    expect(strategy.family).toBe("VOLATILITY");
    expect(strategy.parameterSpec.fields).toHaveLength(2);
    expect(strategy.defaultParameters()).toEqual({ period: 20, stdDevMultiplier: 2 });
  });

  describe("parameter validation", () => {
    it("accepts valid parameters", () => {
      expect(strategy.validateParameters({ period: 20, stdDevMultiplier: 2 }).ok).toBe(true);
    });

    it("rejects period below 2", () => {
      expect(strategy.validateParameters({ period: 1, stdDevMultiplier: 2 }).ok).toBe(false);
    });

    it("rejects stdDevMultiplier outside [0.1, 10]", () => {
      expect(strategy.validateParameters({ period: 20, stdDevMultiplier: 0 }).ok).toBe(false);
      expect(strategy.validateParameters({ period: 20, stdDevMultiplier: 20 }).ok).toBe(false);
    });
  });

  describe("warm-up", () => {
    it("returns HOLD when history is shorter than period", () => {
      const candles = [candleAt(0, 100), candleAt(1, 101), candleAt(2, 102)];
      const sig = strategy.analyze(ctxOf(candles, { period: 20, stdDevMultiplier: 2 }));
      expect(sig.side).toBe("HOLD");
      expect(sig.reason).toMatch(/warm-up/);
    });
  });

  describe("below lower band → BUY", () => {
    it("emits BUY when current close drops below the lower band", () => {
      // 20 closes clustered near 100, then a final close at 50 (way below).
      const candles = [
        ...Array.from({ length: 20 }, (_, i) => candleAt(i, 100 + (i % 2 === 0 ? 0.5 : -0.5))),
        candleAt(20, 50),
      ];
      const sig = strategy.analyze(ctxOf(candles, { period: 20, stdDevMultiplier: 2 }));
      expect(sig.side).toBe("BUY");
      expect(sig.reason).toMatch(/below lower band/);
    });
  });

  describe("above upper band → SELL", () => {
    it("emits SELL when current close rises above the upper band", () => {
      const candles = [
        ...Array.from({ length: 20 }, (_, i) => candleAt(i, 100 + (i % 2 === 0 ? 0.5 : -0.5))),
        candleAt(20, 200),
      ];
      const sig = strategy.analyze(ctxOf(candles, { period: 20, stdDevMultiplier: 2 }));
      expect(sig.side).toBe("SELL");
      expect(sig.reason).toMatch(/above upper band/);
    });
  });

  describe("inside bands → HOLD", () => {
    it("emits HOLD when close is inside [lower, upper]", () => {
      const candles = Array.from({ length: 25 }, (_, i) => candleAt(i, 100 + (i % 2 === 0 ? 0.5 : -0.5)));
      const sig = strategy.analyze(ctxOf(candles, { period: 20, stdDevMultiplier: 2 }));
      expect(sig.side).toBe("HOLD");
      expect(sig.reason).toMatch(/inside bands/);
    });
  });
});