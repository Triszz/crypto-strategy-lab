/**
 * Tests for the CombinationEngine MAJORITY_VOTE operator (Step 6 fix).
 *
 * Requirements:
 *   BUY  = +1, HOLD = 0, SELL = -1
 *   Most votes win; deterministic tie → HOLD
 */
import { beforeEach, describe, it, expect } from "vitest";
import {
  CombinationEngine,
} from "../../src/modules/strategy";
import { CombinationOperator } from "../../src/modules/strategy/combination/CombinationConfig";
import type { Strategy } from "../../src/modules/strategy/domain/Strategy";
import type { StrategyContext } from "../../src/modules/strategy/domain/StrategyContext";
import type { Signal } from "../../src/modules/strategy/domain/Signal";
import type { StrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";

function fakeStrategy(id: string, signal: Signal): Strategy {
  return {
    id,
    name: `Fake ${id}`,
    family: "TREND",
    requiredHistory: 1,
    parameterSpec: { fields: [] },
    defaultParameters: () => ({}),
    validateParameters: () => ({ ok: true }),
    analyze: () => signal,
  };
}

function makeSig(side: "BUY" | "SELL" | "HOLD"): Signal {
  return side === "HOLD"
    ? { side, strength: 0 }
    : side === "BUY"
      ? { side, strength: 1 }
      : { side, strength: -1 };
}

class FakeRegistry implements StrategyRegistry {
  private readonly map = new Map<string, Strategy>();
  register(s: Strategy): void { this.map.set(s.id, s); }
  resolve(id: string): Strategy | undefined { return this.map.get(id); }
  has(id: string): boolean { return this.map.has(id); }
  list(): string[] { return Array.from(this.map.keys()); }
  clear(): void { this.map.clear(); }
}

function ctx(): StrategyContext {
  return {
    symbol: "BTCUSDT",
    timeframe: "1h",
    candle: {
      openTime: 1, closeTime: 2, open: 100, high: 101, low: 99, close: 100, volume: 0,
    },
    history: [],
    parameters: {},
  };
}

describe("CombinationEngine — MAJORITY_VOTE operator", () => {
  let registry: FakeRegistry;
  let engine: CombinationEngine;

  beforeEach(() => {
    registry = new FakeRegistry();
    engine = new CombinationEngine(registry);
  });

  it("MAJORITY_VOTE: 2 BUY + 1 SELL → BUY", () => {
    registry.register(fakeStrategy("strategy.ma", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.rsi", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.bollinger", makeSig("SELL")));
    const r = engine.run(
      {
        id: "strategy.composite.mv",
        name: "MV",
        operator: CombinationOperator.MAJORITY_VOTE,
        components: [
          { strategyId: "strategy.ma", weight: 1, position: 0 },
          { strategyId: "strategy.rsi", weight: 1, position: 1 },
          { strategyId: "strategy.bollinger", weight: 1, position: 2 },
        ],
      },
      ctx(),
    );
    expect(r.side).toBe("BUY");
  });

  it("MAJORITY_VOTE: 1 BUY + 2 SELL → SELL", () => {
    registry.register(fakeStrategy("strategy.ma", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.rsi", makeSig("SELL")));
    registry.register(fakeStrategy("strategy.bollinger", makeSig("SELL")));
    const r = engine.run(
      {
        id: "strategy.composite.mv",
        name: "MV",
        operator: CombinationOperator.MAJORITY_VOTE,
        components: [
          { strategyId: "strategy.ma", weight: 1, position: 0 },
          { strategyId: "strategy.rsi", weight: 1, position: 1 },
          { strategyId: "strategy.bollinger", weight: 1, position: 2 },
        ],
      },
      ctx(),
    );
    expect(r.side).toBe("SELL");
  });

  it("MAJORITY_VOTE: deterministic tie → HOLD (1 BUY + 1 SELL, equal weight)", () => {
    registry.register(fakeStrategy("strategy.ma", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.rsi", makeSig("SELL")));
    const r = engine.run(
      {
        id: "strategy.composite.mv",
        name: "MV",
        operator: CombinationOperator.MAJORITY_VOTE,
        components: [
          { strategyId: "strategy.ma", weight: 1, position: 0 },
          { strategyId: "strategy.rsi", weight: 1, position: 1 },
        ],
      },
      ctx(),
    );
    expect(r.side).toBe("HOLD");
    expect(r.strength).toBe(0);
  });

  it("MAJORITY_VOTE: weighted majority (heavy BUY 0.8, light SELL 0.2) → BUY", () => {
    registry.register(fakeStrategy("strategy.ma", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.rsi", makeSig("SELL")));
    const r = engine.run(
      {
        id: "strategy.composite.mv",
        name: "MV",
        operator: CombinationOperator.MAJORITY_VOTE,
        components: [
          { strategyId: "strategy.ma", weight: 0.8, position: 0 },
          { strategyId: "strategy.rsi", weight: 0.2, position: 1 },
        ],
      },
      ctx(),
    );
    expect(r.side).toBe("BUY");
    // Strength = |buyMass - sellMass| = |0.8 - 0.2| = 0.6
    expect(r.strength).toBeCloseTo(0.6, 5);
  });

  it("MAJORITY_VOTE: HOLD votes contribute 0 mass (1 BUY + 1 HOLD + 1 SELL → HOLD tie)", () => {
    registry.register(fakeStrategy("strategy.ma", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.rsi", makeSig("HOLD")));
    registry.register(fakeStrategy("strategy.bollinger", makeSig("SELL")));
    const r = engine.run(
      {
        id: "strategy.composite.mv",
        name: "MV",
        operator: CombinationOperator.MAJORITY_VOTE,
        components: [
          { strategyId: "strategy.ma", weight: 1, position: 0 },
          { strategyId: "strategy.rsi", weight: 1, position: 1 },
          { strategyId: "strategy.bollinger", weight: 1, position: 2 },
        ],
      },
      ctx(),
    );
    // Each component weight = 1/3 after normalisation, so BUY and SELL have
    // equal mass and the deterministic tie → HOLD.
    expect(r.side).toBe("HOLD");
  });

  it("WEIGHTED: 2 BUY + 1 SELL → BUY (unchanged)", () => {
    registry.register(fakeStrategy("strategy.ma", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.rsi", makeSig("BUY")));
    registry.register(fakeStrategy("strategy.bollinger", makeSig("SELL")));
    const r = engine.run(
      {
        id: "strategy.composite.w",
        name: "W",
        operator: CombinationOperator.WEIGHTED,
        components: [
          { strategyId: "strategy.ma", weight: 1, position: 0 },
          { strategyId: "strategy.rsi", weight: 1, position: 1 },
          { strategyId: "strategy.bollinger", weight: 1, position: 2 },
        ],
      },
      ctx(),
    );
    expect(r.side).toBe("BUY");
  });
});
