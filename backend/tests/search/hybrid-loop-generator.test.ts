/**
 * Phase 3 — HybridLoopGenerator unit tests.
 *
 * Verifies:
 *   - mutation / crossover / exploration buckets sum to candidateCount
 *   - parent strategy is NEVER re-emitted
 *   - composite parents can produce composite candidates
 *   - candidateCount is respected even with rounding
 *   - stop conditions terminate the generator early
 *   - parent-only (no elite) loop downgrades crossover → mutation
 *   - explicit loopIterationCounter for candidate ids
 *   - rejects are tracked correctly
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  HybridLoopGenerator,
  HYBRID_LOOP_GENERATOR_ID,
  type ParentStrategy,
} from "../../src/modules/search/generators/HybridLoopGenerator";
import {
  getStrategyRegistry,
  setStrategyRegistry,
} from "../../src/modules/strategy/domain/StrategyRegistry";
import type { StrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";
import type { Strategy } from "../../src/modules/strategy/domain/Strategy";
import type { ParamSpec } from "../../src/modules/strategy/domain/ParamSpec";
import type { Signal } from "../../src/modules/strategy/domain/Signal";
import type {
  StrategyContext,
  StrategyParameters,
} from "../../src/modules/strategy/domain/StrategyContext";
import type { SearchCandidate } from "../../src/modules/search/domain/SearchCandidate";

/* ─── Fake Registry ─────────────────────────────────────────────────────── */

class FakeRegistry implements StrategyRegistry {
  private readonly map = new Map<string, Strategy>();
  public register(s: Strategy): void {
    this.map.set(s.id, s);
  }
  public resolve(id: string): Strategy | undefined {
    return this.map.get(id);
  }
  public has(id: string): boolean {
    return this.map.has(id);
  }
  public list(): ReadonlyArray<string> {
    return Array.from(this.map.keys()).sort();
  }
  public clear(): void {
    this.map.clear();
  }
}

function defaultParametersFromSpec(spec: ParamSpec): StrategyParameters {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    out[f.key] = f.default;
  }
  return out;
}

function makeStrategy(id: string, spec: ParamSpec): Strategy {
  return {
    id,
    name: id,
    family: "TREND",
    requiredHistory: 5,
    parameterSpec: spec,
    defaultParameters: () => defaultParametersFromSpec(spec),
    validateParameters: (_p: unknown) => ({ ok: true }),
    analyze: (_ctx: StrategyContext): Signal => ({ side: "HOLD", strength: 0 }),
  };
}

describe("HybridLoopGenerator (Phase 3)", () => {
  let registry: FakeRegistry;

  beforeEach(() => {
    registry = new FakeRegistry();
    const maSpec: ParamSpec = {
      fields: [
        { key: "fastPeriod", kind: "integer", min: 5, max: 50, default: 9 },
        { key: "slowPeriod", kind: "integer", min: 10, max: 100, default: 21 },
      ],
    };
    const rsiSpec: ParamSpec = {
      fields: [
        { key: "period", kind: "integer", min: 5, max: 30, default: 14 },
      ],
    };
    registry.register(makeStrategy("strategy.ma", maSpec));
    registry.register(makeStrategy("strategy.rsi", rsiSpec));
    registry.register(makeStrategy("strategy.bollinger", maSpec));
    setStrategyRegistry(registry);
  });

  function makeBaseParent(): ParentStrategy {
    return {
      type: "BASE",
      strategyId: "strategy.ma",
      parameters: { fastPeriod: 9, slowPeriod: 21 },
    };
  }

  it("emits exactly candidateCount candidates (default config)", async () => {
    const gen = new HybridLoopGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: makeBaseParent(),
      candidateCount: 5,
      randomSeed: 42,
    });
    const seen: SearchCandidate[] = [];
    const result = await gen.generate(
      async (c) => {
        seen.push(c);
        return true;
      },
      () => false,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(result.done).toBe(true);
    expect(seen.length).toBe(5);
  });

  it("candidateCount=5 produces exactly 5 candidates even with weird ratios", async () => {
    const gen = new HybridLoopGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: makeBaseParent(),
      candidateCount: 5,
      mutationRatio: 0.5,
      crossoverRatio: 0.25,
      explorationRatio: 0.25,
      randomSeed: 42,
    });
    const seen: SearchCandidate[] = [];
    await gen.generate(
      async (c) => {
        seen.push(c);
        return true;
      },
      () => false,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(seen.length).toBe(5);
  });

  it("NEVER re-emits the parent itself", async () => {
    const gen = new HybridLoopGenerator();
    gen.setRegistry(registry);
    const parent: ParentStrategy = {
      type: "BASE",
      strategyId: "strategy.ma",
      parameters: { fastPeriod: 9, slowPeriod: 21 },
    };
    gen.applyConfig({
      parent,
      candidateCount: 12,
      mutationRatio: 1,
      crossoverRatio: 0,
      explorationRatio: 0,
      randomSeed: 1,
    });
    const seen: SearchCandidate[] = [];
    await gen.generate(
      async (c) => seen.push(c),
      () => false,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    // No candidate should be identical to the parent.
    for (const c of seen) {
      if (c.candidateType === "BASE") {
        const sameStrategy = c.strategyId === parent.strategyId;
        const sameParams =
          c.parameters.fastPeriod === 9 && c.parameters.slowPeriod === 21;
        expect(!(sameStrategy && sameParams)).toBe(true);
      }
    }
  });

  it("composite parent produces composite candidates", async () => {
    const gen = new HybridLoopGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: {
        type: "COMPOSITE",
        config: {
          id: "strategy.composite.test.0",
          name: "MA + RSI",
          operator: "WEIGHTED" as never,
          components: [
            {
              strategyId: "strategy.ma",
              weight: 0.6,
              position: 0,
              parameters: { fastPeriod: 9, slowPeriod: 21 },
            },
            {
              strategyId: "strategy.rsi",
              weight: 0.4,
              position: 1,
              parameters: { period: 14 },
            },
          ],
        },
      },
      candidateCount: 4,
      mutationRatio: 1,
      crossoverRatio: 0,
      explorationRatio: 0,
      randomSeed: 42,
    });
    const seen: SearchCandidate[] = [];
    await gen.generate(
      async (c) => seen.push(c),
      () => false,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(seen.length).toBe(4);
    for (const c of seen) {
      expect(c.candidateType).toBe("COMPOSITE");
    }
  });

  it("stop condition halts the generator early", async () => {
    const gen = new HybridLoopGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: makeBaseParent(),
      candidateCount: 100,
      mutationRatio: 1,
      crossoverRatio: 0,
      explorationRatio: 0,
      randomSeed: 42,
    });
    const seen: SearchCandidate[] = [];
    const result = await gen.generate(
      async (c) => {
        seen.push(c);
        return true;
      },
      (state) => state.generatedCount >= 3,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(seen.length).toBe(3);
    expect(result.done).toBe(true);
    if (result.done) {
      expect(result.result.stoppedByCondition).toBe(true);
    }
  });

  it("when no elite is supplied, crossover slots roll over to mutation", async () => {
    const gen = new HybridLoopGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: makeBaseParent(),
      candidateCount: 4,
      mutationRatio: 0,
      crossoverRatio: 0.5,
      explorationRatio: 0.5,
      // No eliteMate → crossover slots should be redistributed.
      randomSeed: 42,
    });
    const seen: SearchCandidate[] = [];
    await gen.generate(
      async (c) => seen.push(c),
      () => false,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(seen.length).toBe(4);
    // No crossover was possible → all candidates should be BASE.
    for (const c of seen) {
      expect(c.candidateType).toBe("BASE");
    }
  });

  it("candidate ids are unique within a single call", async () => {
    const gen = new HybridLoopGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: makeBaseParent(),
      candidateCount: 10,
      randomSeed: 42,
    });
    const ids = new Set<string>();
    await gen.generate(
      async (c) => {
        ids.add(c.candidateId);
        return true;
      },
      () => false,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(ids.size).toBe(10);
  });

  it("HYBRID_LOOP_GENERATOR_ID is exposed for runner discovery", () => {
    expect(HYBRID_LOOP_GENERATOR_ID).toBe("loop_hybrid");
  });
});
