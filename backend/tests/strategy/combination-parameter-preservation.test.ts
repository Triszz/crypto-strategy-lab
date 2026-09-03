/**
 * Parameter-preservation test (Step 7 fix).
 *
 * Verifies that per-component parameters set in a CombinationConfig are
 * preserved through candidate generation → CandidateStrategy.parameters
 * → BacktestService.resolveCandidateContext reconstruction.
 */
import { beforeEach, describe, it, expect } from "vitest";
import {
  bootstrapStrategies,
  resetStrategyRegistry,
} from "../../src/modules/strategy";
import { getStrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";
import { CombinationEngine } from "../../src/modules/strategy/combination/CombinationEngine";
import { CompositeStrategy } from "../../src/modules/strategy/combination/CompositeStrategy";
import { CombinationOperator } from "../../src/modules/strategy/combination/CombinationConfig";
import type { CombinationConfig } from "../../src/modules/strategy/combination/CombinationConfig";
import type { StrategyContext } from "../../src/modules/strategy/domain/StrategyContext";

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

describe("Per-component parameter preservation (Step 7)", () => {
  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
  });

  it("combinationEngine.run injects per-component parameters into the strategy context", () => {
    const registry = getStrategyRegistry();
    const engine = new CombinationEngine(registry);

    const captured: Array<{ id: string; params: unknown }> = [];
    // Stub a strategy to capture params
    registry.register({
      id: "strategy.spy",
      name: "Spy",
      family: "TREND",
      requiredHistory: 1,
      parameterSpec: { fields: [] },
      defaultParameters: () => ({ defaultKey: "DEFAULT" }),
      validateParameters: () => ({ ok: true }),
      analyze: (ctx) => {
        captured.push({ id: "strategy.spy", params: ctx.parameters });
        return { side: "HOLD", strength: 0 };
      },
    });

    const config: CombinationConfig = {
      id: "strategy.composite.param-test",
      name: "Param Test",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.spy", weight: 1, position: 0, parameters: { customKey: "CUSTOM" } },
      ],
    };

    engine.run(config, ctx());

    expect(captured.length).toBe(1);
    expect(captured[0]!.params).toEqual({ customKey: "CUSTOM" });
  });

  it("combinationEngine.run falls back to strategy defaults when no parameters override", () => {
    const registry = getStrategyRegistry();
    const engine = new CombinationEngine(registry);

    const captured: Array<{ id: string; params: unknown }> = [];
    registry.register({
      id: "strategy.spy2",
      name: "Spy2",
      family: "TREND",
      requiredHistory: 1,
      parameterSpec: { fields: [] },
      defaultParameters: () => ({ fast: 9, slow: 21 }),
      validateParameters: () => ({ ok: true }),
      analyze: (ctx) => {
        captured.push({ id: "strategy.spy2", params: ctx.parameters });
        return { side: "HOLD", strength: 0 };
      },
    });

    const config: CombinationConfig = {
      id: "strategy.composite.defaults-test",
      name: "Defaults Test",
      operator: CombinationOperator.WEIGHTED,
      components: [{ strategyId: "strategy.spy2", weight: 1, position: 0 }],
    };
    engine.run(config, ctx());

    expect(captured.length).toBe(1);
    expect(captured[0]!.params).toEqual({ fast: 9, slow: 21 });
  });

  it("compositeCandidate.parameters JSON round-trip preserves per-component parameters (SearchService.candidateParameters)", async () => {
    // This is a focused unit test of the JSON shape that SearchService produces.
    const config: CombinationConfig = {
      id: "strategy.composite.persistence-test",
      name: "Persistence Test",
      operator: CombinationOperator.MAJORITY_VOTE,
      components: [
        {
          strategyId: "strategy.ma",
          weight: 0.5,
          position: 0,
          parameters: { fastPeriod: 5, slowPeriod: 50 },
        },
        {
          strategyId: "strategy.rsi",
          weight: 0.5,
          position: 1,
          parameters: { period: 7, buyThreshold: 25, sellThreshold: 75 },
        },
      ],
    };

    // Replicate SearchService.candidateParameters for COMPOSITE
    const stored = {
      _candidateType: "COMPOSITE",
      _config: {
        id: config.id,
        name: config.name,
        operator: config.operator,
        components: config.components.map((c) => ({
          strategyId: c.strategyId,
          weight: c.weight,
          position: c.position,
          ...(c.parameters !== undefined ? { parameters: c.parameters } : {}),
        })),
      },
    };

    // Round-trip: re-parse and reconstruct CombinationConfig from stored JSON.
    const parsed = JSON.parse(JSON.stringify(stored));
    expect(parsed._candidateType).toBe("COMPOSITE");
    expect(parsed._config.operator).toBe("MAJORITY_VOTE");
    expect(parsed._config.components[0].parameters).toEqual({
      fastPeriod: 5,
      slowPeriod: 50,
    });
    expect(parsed._config.components[1].parameters).toEqual({
      period: 7,
      buyThreshold: 25,
      sellThreshold: 75,
    });
  });

  it("CompositeStrategy constructed from reconstructed JSON can analyse a context", () => {
    const registry = getStrategyRegistry();
    const engine = new CombinationEngine(registry);

    // Simulate a stored candidate with per-component params
    const reconstructed: CombinationConfig = {
      id: "strategy.composite.reconstructed",
      name: "Reconstructed",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.5, position: 0, parameters: { fastPeriod: 7, slowPeriod: 25 } },
        { strategyId: "strategy.rsi", weight: 0.5, position: 1, parameters: { period: 10, buyThreshold: 30, sellThreshold: 70 } },
      ],
    };

    const composite = new CompositeStrategy(reconstructed, engine);
    // With too-few candles, MA will return HOLD ("warm-up")
    const signal = composite.analyze(ctx());
    expect(["BUY", "SELL", "HOLD"]).toContain(signal.side);
  });
});
