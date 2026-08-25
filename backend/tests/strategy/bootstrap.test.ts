/**
 * Tests for the bootstrap file. The bootstrap is the ONLY place where
 * concrete strategy classes are mapped to their `implementationRef`.
 */
import { beforeEach, describe, it, expect } from "vitest";

import {
  BUILT_IN_STRATEGIES,
  bootstrapStrategies,
} from "../../src/modules/strategy/strategies/bootstrap";
import {
  getStrategyRegistry,
  resetStrategyRegistry,
} from "../../src/modules/strategy/domain/StrategyRegistry";
import {
  BOLLINGER_STRATEGY_ID,
} from "../../src/modules/strategy/strategies/BollingerBandsStrategy";
import {
  MA_STRATEGY_ID,
} from "../../src/modules/strategy/strategies/MovingAverageStrategy";
import {
  RSI_STRATEGY_ID,
} from "../../src/modules/strategy/strategies/RsiStrategy";
import {
  SUPPORT_RESISTANCE_STRATEGY_ID,
} from "../../src/modules/strategy/strategies/SupportResistanceStrategy";

describe("bootstrap", () => {
  beforeEach(() => {
    resetStrategyRegistry();
  });

  it("BUILT_IN_STRATEGIES contains all four MVP strategies", () => {
    const ids = BUILT_IN_STRATEGIES.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        BOLLINGER_STRATEGY_ID,
        MA_STRATEGY_ID,
        RSI_STRATEGY_ID,
        SUPPORT_RESISTANCE_STRATEGY_ID,
      ].sort(),
    );
  });

  it("bootstrapStrategies registers all four in the runtime registry", () => {
    bootstrapStrategies();
    const r = getStrategyRegistry();
    expect(r.has(MA_STRATEGY_ID)).toBe(true);
    expect(r.has(RSI_STRATEGY_ID)).toBe(true);
    expect(r.has(BOLLINGER_STRATEGY_ID)).toBe(true);
    expect(r.has(SUPPORT_RESISTANCE_STRATEGY_ID)).toBe(true);
    expect(r.list()).toHaveLength(4);
  });

  it("bootstrapStrategies is idempotent (calling twice does not throw)", () => {
    bootstrapStrategies();
    expect(() => bootstrapStrategies()).not.toThrow();
    const r = getStrategyRegistry();
    expect(r.list()).toHaveLength(4);
  });

  it("resolved strategies return a usable analyze() function", () => {
    bootstrapStrategies();
    const r = getStrategyRegistry();
    const ma = r.resolve(MA_STRATEGY_ID);
    expect(ma).toBeDefined();
    expect(typeof ma?.analyze).toBe("function");
    const sig = ma?.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candle: {
        openTime: 1700000000000,
        closeTime: 1700003600000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 0,
      },
      history: [],
      parameters: ma.defaultParameters(),
    });
    expect(sig?.side).toBe("HOLD"); // empty history ⇒ warm-up ⇒ HOLD
  });
});