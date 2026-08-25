/**
 * Tests for SupportResistanceStrategy.
 *
 * Construct a deterministic price history where:
 *   - support = min of last `lookback` lows (excluding current candle)
 *   - resistance = max of last `lookback` highs (excluding current candle)
 * then drive the current candle to either probe support or fail resistance.
 */
import { describe, it, expect } from "vitest";

import {
  SupportResistanceStrategy,
  SUPPORT_RESISTANCE_STRATEGY_ID,
} from "../../src/modules/strategy/strategies/SupportResistanceStrategy";
import { candleAt, ctxOf } from "./_fixtures";

describe("SupportResistanceStrategy", () => {
  const strategy = new SupportResistanceStrategy();

  it("exposes the documented contract fields", () => {
    expect(strategy.id).toBe(SUPPORT_RESISTANCE_STRATEGY_ID);
    expect(strategy.family).toBe("STRUCTURE");
    expect(strategy.parameterSpec.fields).toHaveLength(2);
    expect(strategy.defaultParameters()).toEqual({ lookback: 20, tolerancePct: 0.001 });
  });

  describe("parameter validation", () => {
    it("accepts valid parameters", () => {
      expect(strategy.validateParameters({ lookback: 20, tolerancePct: 0.001 }).ok).toBe(true);
    });

    it("rejects lookback below 2", () => {
      expect(strategy.validateParameters({ lookback: 1, tolerancePct: 0.001 }).ok).toBe(false);
    });

    it("rejects negative tolerance", () => {
      expect(strategy.validateParameters({ lookback: 20, tolerancePct: -0.1 }).ok).toBe(false);
    });
  });

  describe("warm-up", () => {
    it("returns HOLD when history is shorter than lookback + 1", () => {
      const candles = [candleAt(0, 100), candleAt(1, 101)];
      const sig = strategy.analyze(ctxOf(candles, { lookback: 20, tolerancePct: 0.001 }));
      expect(sig.side).toBe("HOLD");
      expect(sig.reason).toMatch(/warm-up/);
    });
  });

  describe("support test → BUY", () => {
    it("emits BUY when current low probes support and close reclaims", () => {
      // 20 candles: lows cluster near 100, highs near 110.
      // Support  = 99.5, Resistance ≈ 110.5
      const prior = Array.from({ length: 20 }, (_, i) => {
        const c = candleAt(i, 105 + (i % 3 === 0 ? -3 : 1));
        // Force lows between 99 and 100, highs between 109 and 111.
        return {
          ...c,
          low: 99.5,
          high: 110.5,
        };
      });
      // Current candle: low = 99.4 (probes below support 99.5), close = 105 (reclaims).
      const current = {
        ...candleAt(20, 105),
        low: 99.4,
        high: 110.5,
      };
      const sig = strategy.analyze(ctxOf([...prior, current], { lookback: 20, tolerancePct: 0.001 }));
      expect(sig.side).toBe("BUY");
      expect(sig.reason).toMatch(/support test/);
    });
  });

  describe("failed resistance breakout → SELL", () => {
    it("emits SELL when current high probes resistance and close fails", () => {
      const prior = Array.from({ length: 20 }, (_, i) => {
        const c = candleAt(i, 105);
        return { ...c, low: 99.5, high: 110.5 };
      });
      // Current candle:
      //   low  = 101    > support 99.5 + tolerance 0.0995  ⇒ support branch NOT triggered
      //   high = 110.6  > resistance 110.5 − tolerance ≈ 110.499 ⇒ resistance branch triggered
      //   close = 100   < resistance 110.5  ⇒ "failed breakout"
      const current = {
        ...candleAt(20, 100),
        low: 101,
        high: 110.6,
      };
      const sig = strategy.analyze(ctxOf([...prior, current], { lookback: 20, tolerancePct: 0.001 }));
      expect(sig.side).toBe("SELL");
      expect(sig.reason).toMatch(/failed breakout/);
    });
  });

  describe("no interaction → HOLD", () => {
    it("emits HOLD when current candle is well inside the prior range", () => {
      const prior = Array.from({ length: 20 }, (_, i) => {
        const c = candleAt(i, 105);
        return { ...c, low: 99.5, high: 110.5 };
      });
      const current = { ...candleAt(20, 105), low: 102, high: 108 };
      const sig = strategy.analyze(ctxOf([...prior, current], { lookback: 20, tolerancePct: 0.001 }));
      expect(sig.side).toBe("HOLD");
      expect(sig.reason).toMatch(/no support\/resistance interaction/);
    });
  });
});