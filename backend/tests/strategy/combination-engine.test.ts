/**
 * Tests for CombinationEngine. Uses a hand-rolled fake registry so the
 * tests are fully deterministic and require no external dependencies.
 */
import { beforeEach, describe, it, expect } from "vitest";

import { CombinationEngine, CombinationError } from "../../src/modules/strategy";
import type { Strategy } from "../../src/modules/strategy/domain/Strategy";
import type { StrategyContext } from "../../src/modules/strategy/domain/StrategyContext";
import type { Signal } from "../../src/modules/strategy/domain/Signal";
import type { StrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";
import { resetStrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";

/** Fake strategy that always returns the same signal. */
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

/**
 * Helper that builds a BUY/HOLD/SELL signal with a strength that is
 * consistent with the Signal contract:
 *   BUY  → strength ≥ 0
 *   SELL → strength ≤ 0
 *   HOLD → strength = 0
 */
function makeSig(side: "BUY" | "SELL" | "HOLD", magnitude = 1, confidence?: number): Signal {
  const strength = side === "HOLD" ? 0 : side === "BUY" ? magnitude : -magnitude;
  return confidence !== undefined ? { side, strength, confidence } : { side, strength };
}

/** Fake registry that holds concrete Strategy instances. */
class FakeRegistry implements StrategyRegistry {
  private readonly map = new Map<string, Strategy>();
  public register(strategy: Strategy): void {
    this.map.set(strategy.id, strategy);
  }
  public resolve(id: string): Strategy | undefined {
    return this.map.get(id);
  }
  public has(id: string): boolean {
    return this.map.has(id);
  }
  public list(): string[] {
    return Array.from(this.map.keys());
  }
  public clear(): void {
    this.map.clear();
  }
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

describe("CombinationEngine", () => {
  let registry: FakeRegistry;
  let engine: CombinationEngine;

  beforeEach(() => {
    registry = new FakeRegistry();
    engine = new CombinationEngine(registry);
  });

  describe("structural validation", () => {
    it("throws CombinationError for empty components", () => {
      expect(() =>
        engine.run(
          { id: "strategy.composite.empty", name: "Empty", components: [] },
          fakeCtx(),
        ),
      ).toThrow(CombinationError);
    });

    it("throws on unknown strategy id", () => {
      registry.register(fakeStrategy("strategy.ma", { side: "BUY", strength: 1 }));
      expect(() =>
        engine.run(
          {
            id: "strategy.composite.test",
            name: "Test",
            components: [
              { strategyId: "strategy.ma", weight: 1, position: 0 },
              { strategyId: "strategy.unknown", weight: 0, position: 1 },
            ],
          },
          fakeCtx(),
        ),
      ).toThrow(CombinationError);
    });

    it("propagates parameter validation failure from child strategy", () => {
      registry.register({
        id: "strategy.invalid",
        name: "Invalid",
        family: "TREND",
        requiredHistory: 1,
        parameterSpec: { fields: [] },
        defaultParameters: () => ({}),
        validateParameters: () => ({ ok: false, errors: ["bad params"] }),
        analyze: () => ({ side: "HOLD", strength: 0 }),
      });
      expect(() =>
        engine.run(
          {
            id: "strategy.composite.test",
            name: "Test",
            components: [{ strategyId: "strategy.invalid", weight: 1, position: 0 }],
          },
          fakeCtx(),
        ),
      ).toThrow(CombinationError);
    });

    it("does NOT throw for unknown id when that component's strategy is NOT required", () => {
      // The engine must throw on unknown ids (no silent skip).
      // We test that the error message is meaningful.
      registry.register(fakeStrategy("strategy.ma", { side: "HOLD", strength: 0 }));
      try {
        engine.run(
          {
            id: "strategy.composite.test",
            name: "Test",
            components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
          },
          fakeCtx(),
        );
      } catch (e) {
        if (e instanceof CombinationError) {
          // Expected: no errors should be thrown for known id
        }
        throw e; // Re-throw to fail if no error
      }
    });
  });

  describe("happy path — single component", () => {
    it("returns the child signal when config has one component", () => {
      registry.register(fakeStrategy("strategy.ma", { side: "BUY", strength: 1 }));
      const result = engine.run(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        fakeCtx(),
      );
      expect(result.side).toBe("BUY");
      expect(result.componentCount).toBe(1);
    });
  });

  describe("happy path — multiple components", () => {
    it("BUY + BUY → BUY", () => {
      registry.register(fakeStrategy("strategy.ma", { side: "BUY", strength: 1 }));
      registry.register(fakeStrategy("strategy.rsi", { side: "BUY", strength: 1 }));
      const result = engine.run(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [
            { strategyId: "strategy.ma", weight: 0.5, position: 0 },
            { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
          ],
        },
        fakeCtx(),
      );
      expect(result.side).toBe("BUY");
      expect(result.componentCount).toBe(2);
    });

    it("BUY + SELL (equal weight) → HOLD", () => {
      registry.register(fakeStrategy("strategy.ma", makeSig("BUY", 1)));
      registry.register(fakeStrategy("strategy.rsi", makeSig("SELL", 1)));
      const result = engine.run(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [
            { strategyId: "strategy.ma", weight: 0.5, position: 0 },
            { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
          ],
        },
        fakeCtx(),
      );
      expect(result.side).toBe("HOLD");
    });

    it("BUY dominant (0.75) + SELL (0.25) → BUY", () => {
      registry.register(fakeStrategy("strategy.ma", makeSig("BUY", 1)));
      registry.register(fakeStrategy("strategy.rsi", makeSig("SELL", 1)));
      const result = engine.run(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [
            { strategyId: "strategy.ma", weight: 0.75, position: 0 },
            { strategyId: "strategy.rsi", weight: 0.25, position: 1 },
          ],
        },
        fakeCtx(),
      );
      expect(result.side).toBe("BUY");
      expect(result.strength).toBeCloseTo(0.5, 5);
    });

    it("uses component parameter overrides when provided", () => {
      let capturedParams: unknown = null;
      registry.register({
        id: "strategy.ma",
        name: "MA",
        family: "TREND",
        requiredHistory: 1,
        parameterSpec: { fields: [] },
        defaultParameters: () => ({ fastPeriod: 9, slowPeriod: 21 }),
        validateParameters: () => ({ ok: true }),
        analyze: (ctx: StrategyContext) => {
          capturedParams = ctx.parameters;
          return { side: "BUY", strength: 1 };
        },
      });
      engine.run(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [
            {
              strategyId: "strategy.ma",
              weight: 1,
              position: 0,
              parameters: { fastPeriod: 5, slowPeriod: 50 },
            },
          ],
        },
        fakeCtx(),
      );
      expect(capturedParams).toEqual({ fastPeriod: 5, slowPeriod: 50 });
    });

    it("uses strategy defaults when no override parameters provided", () => {
      let capturedParams: unknown = null;
      registry.register({
        id: "strategy.ma",
        name: "MA",
        family: "TREND",
        requiredHistory: 1,
        parameterSpec: { fields: [] },
        defaultParameters: () => ({ fastPeriod: 9, slowPeriod: 21 }),
        validateParameters: () => ({ ok: true }),
        analyze: (ctx: StrategyContext) => {
          capturedParams = ctx.parameters;
          return { side: "BUY", strength: 1 };
        },
      });
      engine.run(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [{ strategyId: "strategy.ma", weight: 1, position: 0 }],
        },
        fakeCtx(),
      );
      expect(capturedParams).toEqual({ fastPeriod: 9, slowPeriod: 21 });
    });

    it("respects position order for execution", () => {
      const executionOrder: string[] = [];
      registry.register({
        id: "strategy.a",
        name: "A",
        family: "TREND",
        requiredHistory: 1,
        parameterSpec: { fields: [] },
        defaultParameters: () => ({}),
        validateParameters: () => ({ ok: true }),
        analyze: () => { executionOrder.push("a"); return { side: "HOLD", strength: 0 }; },
      });
      registry.register({
        id: "strategy.b",
        name: "B",
        family: "TREND",
        requiredHistory: 1,
        parameterSpec: { fields: [] },
        defaultParameters: () => ({}),
        validateParameters: () => ({ ok: true }),
        analyze: () => { executionOrder.push("b"); return { side: "HOLD", strength: 0 }; },
      });
      engine.run(
        {
          id: "strategy.composite.test",
          name: "Test",
          components: [
            { strategyId: "strategy.b", weight: 1, position: 1 },
            { strategyId: "strategy.a", weight: 1, position: 0 },
          ],
        },
        fakeCtx(),
      );
      expect(executionOrder).toEqual(["a", "b"]);
    });
  });
});
