/**
 * Tests for `LoopMutationGenerator` — the Strategy/Search-side generator
 * the Loop Orchestrator Runner uses to mutate a parent strategy into N
 * new candidates.
 *
 * Runs without Prisma / Redis / BullMQ by using an in-process
 * `StrategyRegistry` populated with a tiny fake strategy.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  LoopMutationGenerator,
  LOOP_MUTATION_GENERATOR_ID,
  __test__ as helpers,
  type ParentStrategy,
} from "../../src/modules/search/generators/LoopMutationGenerator";
import { getStrategyRegistry, setStrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";
import type { StrategyRegistry } from "../../src/modules/strategy/domain/StrategyRegistry";
import type { Strategy } from "../../src/modules/strategy/domain/Strategy";
import type { ParamSpec } from "../../src/modules/strategy/domain/ParamSpec";
import type { Signal } from "../../src/modules/strategy/domain/Signal";
import type { StrategyContext, StrategyParameters } from "../../src/modules/strategy/domain/StrategyContext";
import type { SearchCandidate } from "../../src/modules/search/domain/SearchCandidate";

/* ─── Helpers ────────────────────────────────────────────────────────────── */

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

function makeStrategy(id: string, spec: ParamSpec): Strategy {
  return {
    id,
    name: id,
    family: "TREND" as const,
    requiredHistory: 5,
    parameterSpec: spec,
    defaultParameters: () => defaultParametersFromSpec(spec),
    validateParameters: (p: unknown) => ({ ok: true }),
    analyze: (_ctx: StrategyContext): Signal => ({
      side: "HOLD",
      strength: 0,
    }),
  };
}

function defaultParametersFromSpec(spec: ParamSpec): StrategyParameters {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) out[f.key] = f.default;
  return out;
}

const MA_SPEC: ParamSpec = {
  fields: [
    { key: "fastPeriod", kind: "integer", min: 2, max: 50, default: 9 },
    { key: "slowPeriod", kind: "integer", min: 5, max: 200, default: 21 },
  ],
};

const RSI_SPEC: ParamSpec = {
  fields: [
    { key: "period", kind: "integer", min: 5, max: 50, default: 14 },
    { key: "oversold", kind: "decimal", min: 10, max: 40, default: 30 },
    { key: "overbought", kind: "decimal", min: 60, max: 90, default: 70 },
  ],
};

/* ─── Tests ─────────────────────────────────────────────────────────────── */

describe("LoopMutationGenerator", () => {
  let registry: FakeRegistry;

  beforeEach(() => {
    registry = new FakeRegistry();
    registry.register(makeStrategy("strategy.ma", MA_SPEC));
    registry.register(makeStrategy("strategy.rsi", RSI_SPEC));
    setStrategyRegistry(registry);
  });

  it("exposes the canonical loop_mutation id", () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    expect(gen.id).toBe(LOOP_MUTATION_GENERATOR_ID);
  });

  it("produces exactly `candidateCount` candidates", async () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: {
        type: "BASE",
        strategyId: "strategy.ma",
        parameters: { fastPeriod: 9, slowPeriod: 21 },
      },
      candidateCount: 4,
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
    expect(seen.length).toBe(4);
    expect(result.done ? result.result.totalQueued : 0).toBe(4);
  });

  it("emits BASE candidates with mutated parameters", async () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: {
        type: "BASE",
        strategyId: "strategy.ma",
        parameters: { fastPeriod: 9, slowPeriod: 21 },
      },
      candidateCount: 10,
      randomSeed: 7,
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

    for (const cand of seen) {
      expect(cand.candidateType).toBe("BASE");
      if (cand.candidateType === "BASE") {
        const params = cand.parameters as Record<string, number>;
        expect(params.fastPeriod).toBeGreaterThanOrEqual(2);
        expect(params.fastPeriod).toBeLessThanOrEqual(50);
        expect(params.slowPeriod).toBeGreaterThanOrEqual(5);
        expect(params.slowPeriod).toBeLessThanOrEqual(200);
        expect(Number.isInteger(params.fastPeriod)).toBe(true);
        expect(Number.isInteger(params.slowPeriod)).toBe(true);
      }
    }
  });

  it("does NOT reproduce the exact parent parameters for every candidate (mutation produces variants)", async () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    const parentParams = { fastPeriod: 9, slowPeriod: 21 };
    gen.applyConfig({
      parent: {
        type: "BASE",
        strategyId: "strategy.ma",
        parameters: parentParams,
      },
      candidateCount: 20,
      randomSeed: 1,
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

    const exactDuplicates = seen.filter((c) => {
      if (c.candidateType !== "BASE") return false;
      const p = c.parameters as Record<string, number>;
      return p.fastPeriod === 9 && p.slowPeriod === 21;
    });
    // Deterministic with seed=1 ⇒ expect at least one change out of 20.
    expect(exactDuplicates.length).toBeLessThan(seen.length);
  });

  it("emits COMPOSITE candidates that preserve operator and component strategyIds", async () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: {
        type: "COMPOSITE",
        config: {
          id: "strategy.composite.test.0",
          name: "MA + RSI",
          operator: "MAJORITY_VOTE" as never,
          components: [
            { strategyId: "strategy.ma", weight: 0.5, position: 0 },
            { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
          ],
        },
      },
      candidateCount: 3,
      randomSeed: 99,
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

    expect(seen.length).toBe(3);
    for (const c of seen) {
      expect(c.candidateType).toBe("COMPOSITE");
      if (c.candidateType === "COMPOSITE") {
        const ids = c.config.components.map((cc) => cc.strategyId).sort();
        expect(ids).toEqual(["strategy.ma", "strategy.rsi"]);
        expect(c.config.operator).toBe("MAJORITY_VOTE");
      }
    }
  });

  it("re-normalises COMPOSITE weights so they sum to 1.0", async () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: {
        type: "COMPOSITE",
        config: {
          id: "strategy.composite.test.0",
          name: "MA + RSI",
          operator: "WEIGHTED" as never,
          components: [
            { strategyId: "strategy.ma", weight: 0.5, position: 0 },
            { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
          ],
        },
      },
      candidateCount: 5,
      randomSeed: 11,
      weightPerturbationRatio: 0.5,
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

    for (const c of seen) {
      if (c.candidateType !== "COMPOSITE") continue;
      const total = c.config.components.reduce((s, cc) => s + cc.weight, 0);
      expect(Math.abs(total - 1.0)).toBeLessThan(1e-9);
    }
  });

  it("is deterministic for the same randomSeed", async () => {
    const runOnce = async (): Promise<SearchCandidate[]> => {
      const gen = new LoopMutationGenerator();
      gen.setRegistry(registry);
      gen.applyConfig({
        parent: {
          type: "BASE",
          strategyId: "strategy.ma",
          parameters: { fastPeriod: 9, slowPeriod: 21 },
        },
        candidateCount: 8,
        randomSeed: 123,
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
      return seen;
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      const ca = a[i]!;
      const cb = b[i]!;
      expect(ca.candidateType).toBe(cb.candidateType);
      if (ca.candidateType === "BASE" && cb.candidateType === "BASE") {
        expect(ca.parameters).toEqual(cb.parameters);
      }
    }
  });

  it("emits no candidates when no config is applied", async () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    let emitted = 0;
    const result = await gen.generate(
      async () => {
        emitted += 1;
        return true;
      },
      () => false,
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(emitted).toBe(0);
    expect(result.done).toBe(true);
  });

  it("respects shouldStop and stops early", async () => {
    const gen = new LoopMutationGenerator();
    gen.setRegistry(registry);
    gen.applyConfig({
      parent: {
        type: "BASE",
        strategyId: "strategy.ma",
        parameters: { fastPeriod: 9, slowPeriod: 21 },
      },
      candidateCount: 10,
      randomSeed: 5,
    });
    let emitted = 0;
    const result = await gen.generate(
      async () => {
        emitted += 1;
        return true;
      },
      () => emitted >= 2, // stop after 2 emitted
      { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
    );
    expect(emitted).toBe(2);
    expect(result.done).toBe(true);
    expect(result.done ? result.result.stoppedByCondition : false).toBe(true);
  });

  it("internal field mutation clamps to [min, max]", () => {
    const integerField = {
      key: "x",
      kind: "integer" as const,
      min: 5,
      max: 10,
      defaultValue: 7,
    };
    const rng = () => 1; // always bumps up by the max step
    for (let i = 0; i < 50; i += 1) {
      const v = helpers.mutateField(integerField, 10, rng) as number;
      expect(v).toBeLessThanOrEqual(10);
      expect(v).toBeGreaterThanOrEqual(5);
    }
  });
});

/* Keep TS happy about the unused import. */
void getStrategyRegistry;
void helpers;
