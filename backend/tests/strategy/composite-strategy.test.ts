/**
 * Tests for CompositeStrategy — it must satisfy the Strategy interface so
 * Backtest / Evaluation can treat it uniformly as a Strategy.
 */
import { beforeEach, describe, it, expect } from "vitest";

import {
  CompositeStrategy,
  CombinationEngine,
  isCompositeStrategyId,
  COMPOSITE_STRATEGY_ID_PREFIX,
} from "../../src/modules/strategy";
import type { Strategy } from "../../src/modules/strategy/domain/Strategy";
import type { StrategyContext } from "../../src/modules/strategy/domain/StrategyContext";
import type { StrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";

/** Fake strategy that always returns a fixed signal. */
function fakeStrategy(id: string, name: string, family: string, signal: ReturnType<typeof makeSig>): Strategy {
  return {
    id,
    name,
    family: family as Strategy["family"],
    requiredHistory: 1,
    parameterSpec: { fields: [] },
    defaultParameters: () => ({}),
    validateParameters: () => ({ ok: true }),
    analyze: () => signal,
  };
}

type Sig = { side: "BUY" | "SELL" | "HOLD"; strength: number; confidence?: number };
function makeSig(side: "BUY" | "SELL" | "HOLD", strength = 1, confidence?: number): Sig {
  return confidence !== undefined ? { side, strength, confidence } : { side, strength };
}

class FakeRegistry implements StrategyRegistry {
  private readonly map = new Map<string, Strategy>();
  public register(strategy: Strategy): void { this.map.set(strategy.id, strategy); }
  public resolve(id: string): Strategy | undefined { return this.map.get(id); }
  public has(id: string): boolean { return this.map.has(id); }
  public list(): string[] { return Array.from(this.map.keys()); }
  public clear(): void { this.map.clear(); }
}

function fakeCtx(): StrategyContext {
  return {
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
    parameters: {},
  };
}

describe("CompositeStrategy", () => {
  let registry: FakeRegistry;
  let engine: CombinationEngine;

  beforeEach(() => {
    registry = new FakeRegistry();
    engine = new CombinationEngine(registry);
  });

  it("satisfies the Strategy interface (has all required fields)", () => {
    registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("HOLD")));
    const composite = new CompositeStrategy(
      {
        id: "strategy.composite.test",
        name: "Test",
        components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
      },
      engine,
    );
    expect(typeof composite.id).toBe("string");
    expect(typeof composite.name).toBe("string");
    expect(typeof composite.family).toBe("string");
    expect(typeof composite.requiredHistory).toBe("number");
    expect(typeof composite.parameterSpec).toBe("object");
    expect(typeof composite.defaultParameters).toBe("function");
    expect(typeof composite.validateParameters).toBe("function");
    expect(typeof composite.analyze).toBe("function");
  });

  it("id starts with composite prefix", () => {
    registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("HOLD")));
    const composite = new CompositeStrategy(
      {
        id: "strategy.composite.trend-momentum",
        name: "Test",
        components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
      },
      engine,
    );
    expect(isCompositeStrategyId(composite.id)).toBe(true);
    expect(composite.id).toBe("strategy.composite.trend-momentum");
  });

  it("isCompositeStrategyId returns false for BASE strategy ids", () => {
    expect(isCompositeStrategyId("strategy.ma")).toBe(false);
    expect(isCompositeStrategyId("strategy.rsi")).toBe(false);
    expect(isCompositeStrategyId("strategy.composite.foo")).toBe(true);
  });

  describe("requiredHistory", () => {
    it("is the max of component requiredHistory values", () => {
      // Register a strategy with requiredHistory = 5.
      const maStrategy: Strategy = {
        id: "strategy.ma",
        name: "MA",
        family: "TREND",
        requiredHistory: 5,
        parameterSpec: { fields: [] },
        defaultParameters: () => ({}),
        validateParameters: () => ({ ok: true }),
        analyze: () => makeSig("HOLD"),
      };
      registry.register(maStrategy);
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        engine,
      );
      expect(composite.requiredHistory).toBe(5);
    });
  });

  describe("analyze() delegates to CombinationEngine", () => {
    it("returns a CompositeSignal from analyze()", () => {
      registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("BUY")));
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        engine,
      );
      const result = composite.analyze(fakeCtx());
      expect(result.side).toBe("BUY");
      expect(result.componentCount).toBe(1);
    });

    it("CompositeSignal can be used through the Signal interface", () => {
      registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("SELL")));
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        engine,
      );
      // Cast to Signal — proves it satisfies the interface
      const signal = composite.analyze(fakeCtx()) as { side: string; strength: number; reason: string };
      expect(["BUY", "SELL", "HOLD"]).toContain(signal.side);
      expect(typeof signal.strength).toBe("number");
      expect(typeof signal.reason).toBe("string");
    });
  });

  describe("defaultParameters()", () => {
    it("returns a JSON-serialised components string", () => {
      registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("HOLD")));
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 0.7, position: 0 }],
        },
        engine,
      );
      const defaults = composite.defaultParameters();
      expect(typeof defaults["components"]).toBe("string");
      const parsed = JSON.parse(defaults["components"] as string);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.strategyId).toBe("strategy.ma");
      expect(parsed[0]!.weight).toBe(0.7);
    });
  });

  describe("validateParameters()", () => {
    it("rejects non-object parameters", () => {
      registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("HOLD")));
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        engine,
      );
      expect(composite.validateParameters(null).ok).toBe(false);
      expect(composite.validateParameters(42).ok).toBe(false);
    });

    it("rejects missing components field", () => {
      registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("HOLD")));
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        engine,
      );
      expect(composite.validateParameters({}).ok).toBe(false);
    });

    it("accepts valid JSON components", () => {
      registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("HOLD")));
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        engine,
      );
      const valid = composite.validateParameters({
        components: JSON.stringify([{ strategyId: "strategy.ma", weight: 0.5, position: 0 }]),
      });
      expect(valid.ok).toBe(true);
    });

    it("rejects malformed JSON in components", () => {
      registry.register(fakeStrategy("strategy.ma", "MA", "TREND", makeSig("HOLD")));
      const composite = new CompositeStrategy(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        engine,
      );
      expect(composite.validateParameters({ components: "not-json" }).ok).toBe(false);
    });
  });
});
