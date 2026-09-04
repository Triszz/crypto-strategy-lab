/**
 * Tests for RandomGenerator. Uses a mock PRNG so tests are deterministic.
 * We override Math.random via vi.stubGlobal.
 *
 * The default behaviour is now COMPOSITE generation (Module 5/6 compliance).
 * Tests that need legacy BASE behaviour opt in via `compositeMode: "BASE"`.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { ParameterSpace } from "../../src/modules/search/domain/ParameterSpace";
import { RandomGenerator } from "../../src/modules/search/generators/RandomGenerator";
import type {
  BaseCandidate,
  CompositeCandidate,
} from "../../src/modules/search/domain/SearchCandidate";

function makeSpace(id: string, fields: ParameterSpace["fields"]): ParameterSpace {
  return { strategyId: id, fields, totalGridPoints: Infinity };
}

function emptyState() {
  return { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 };
}

function neverStop() {
  return () => false;
}

/** Seeded LCG so we get deterministic random sequences. */
class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  public next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
}

describe("RandomGenerator — interface", () => {
  it("implements StrategyGenerator interface", () => {
    const gen = new RandomGenerator();
    expect(typeof gen.name).toBe("string");
    expect(typeof gen.generate).toBe("function");
    expect(Array.isArray(gen.spaces)).toBe(true);
  });

  it("returns empty result when spaces is empty", async () => {
    const gen = new RandomGenerator();
    const emitted: unknown[] = [];
    const result = await gen.generate(
      (c: unknown) => { emitted.push(c); return true; },
      neverStop(),
      emptyState(),
    );
    expect(result.done).toBe(true);
    expect(result.result.totalGenerated).toBe(0);
    expect(emitted).toHaveLength(0);
  });
});

describe("RandomGenerator — COMPOSITE mode (default)", () => {
  let rng: SeededRandom;

  beforeEach(() => {
    rng = new SeededRandom(42);
    vi.stubGlobal("Math.random", () => rng.next());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits COMPOSITE candidates by default (Module 5/6 compliance)", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
      makeSpace("strategy.rsi", [
        { key: "period", kind: "integer", min: 5, max: 30, defaultValue: 14 },
      ]),
    ];
    const emitted: Array<{ candidateType: string }> = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as { candidateType: string }); return true; },
      neverStop(),
      emptyState(),
    );
    expect(emitted.length).toBeGreaterThan(0);
    for (const e of emitted) {
      expect(e.candidateType).toBe("COMPOSITE");
    }
  });

  it("never produces 1-component composites (k ≥ 2)", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
      makeSpace("strategy.rsi", [
        { key: "period", kind: "integer", min: 5, max: 30, defaultValue: 14 },
      ]),
    ];
    const emitted: CompositeCandidate[] = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as CompositeCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    expect(emitted.length).toBeGreaterThan(0);
    for (const e of emitted) {
      expect(e.config.components.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("can generate 2-component combinations", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
      makeSpace("strategy.rsi", [
        { key: "period", kind: "integer", min: 5, max: 30, defaultValue: 14 },
      ]),
    ];
    const emitted: CompositeCandidate[] = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as CompositeCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    const twoComponent = emitted.filter(
      (c) => c.config.components.length === 2,
    );
    expect(twoComponent.length).toBeGreaterThan(0);
  });

  it("can generate 3-component combinations when 3+ strategies available", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [{ key: "p", kind: "integer", min: 2, max: 100, defaultValue: 14 }]),
      makeSpace("strategy.rsi", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 14 }]),
      makeSpace("strategy.bollinger", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 20 }]),
    ];
    const emitted: CompositeCandidate[] = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as CompositeCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    const three = emitted.filter((c) => c.config.components.length === 3);
    expect(three.length).toBeGreaterThan(0);
  });

  it("does NOT generate duplicate component sets (deduplication)", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [{ key: "p", kind: "integer", min: 2, max: 100, defaultValue: 14 }]),
      makeSpace("strategy.rsi", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 14 }]),
    ];
    const emitted: CompositeCandidate[] = [];
    const result = await gen.generate(
      (c: unknown) => { emitted.push(c as CompositeCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    const seen = new Set<string>();
    for (const c of emitted) {
      const fp = c.config.components
        .map((x) => x.strategyId)
        .sort()
        .join("|");
      expect(seen.has(fp)).toBe(false);
      seen.add(fp);
    }
    // With 2 strategies there is only C(2,2) = 1 valid 2-subset.
    expect(seen.size).toBe(1);
    expect(result.result.totalRejected).toBeGreaterThan(0);
  });

  it("weights sum to 1 for every emitted composite", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [{ key: "p", kind: "integer", min: 2, max: 100, defaultValue: 14 }]),
      makeSpace("strategy.rsi", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 14 }]),
      makeSpace("strategy.bollinger", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 20 }]),
    ];
    const emitted: CompositeCandidate[] = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as CompositeCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    for (const c of emitted) {
      const wsum = c.config.components.reduce((s, x) => s + x.weight, 0);
      expect(Math.abs(wsum - 1)).toBeLessThan(1e-9);
    }
  });

  it("respects minComponents and maxComponents", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [{ key: "p", kind: "integer", min: 2, max: 100, defaultValue: 14 }]),
      makeSpace("strategy.rsi", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 14 }]),
      makeSpace("strategy.bollinger", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 20 }]),
      makeSpace("strategy.support_resistance", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 14 }]),
    ];
    gen.applyConfig({ minComponents: 3, maxComponents: 4 });
    const emitted: CompositeCandidate[] = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as CompositeCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    expect(emitted.length).toBeGreaterThan(0);
    for (const c of emitted) {
      expect(c.config.components.length).toBeGreaterThanOrEqual(3);
      expect(c.config.components.length).toBeLessThanOrEqual(4);
    }
  });
});

describe("RandomGenerator — BASE mode (legacy, opt-in)", () => {
  let rng: SeededRandom;

  beforeEach(() => {
    rng = new SeededRandom(42);
    vi.stubGlobal("Math.random", () => rng.next());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits BASE candidates when compositeMode is BASE", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
    ];
    gen.applyConfig({ compositeMode: "BASE" });
    const emitted: Array<{ candidateType: string }> = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as { candidateType: string }); return true; },
      neverStop(),
      emptyState(),
    );
    for (const e of emitted) {
      expect(e.candidateType).toBe("BASE");
    }
  });

  it("parameter values are within declared bounds (BASE mode)", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.rsi", [
        { key: "period", kind: "integer", min: 5, max: 10, defaultValue: 14 },
        { key: "threshold", kind: "decimal", min: 20, max: 30, defaultValue: 25 },
      ]),
    ];
    gen.applyConfig({ compositeMode: "BASE" });
    const emitted: BaseCandidate[] = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as BaseCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    for (const e of emitted) {
      const period = e.parameters["period"] as number;
      expect(Number.isInteger(period)).toBe(true);
      expect(period).toBeGreaterThanOrEqual(5);
      expect(period).toBeLessThanOrEqual(10);
      const threshold = e.parameters["threshold"] as number;
      expect(typeof threshold).toBe("number");
      expect(threshold).toBeGreaterThanOrEqual(20);
      expect(threshold).toBeLessThanOrEqual(30);
    }
  });

  it("enum fields pick from declared values (BASE mode)", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.test", [
        { key: "mode", kind: "enum", values: ["a", "b", "c"], defaultValue: "a" },
      ]),
    ];
    gen.applyConfig({ compositeMode: "BASE" });
    const emitted: BaseCandidate[] = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as BaseCandidate); return true; },
      neverStop(),
      emptyState(),
    );
    const valid = new Set(["a", "b", "c"]);
    for (const e of emitted) {
      expect(valid.has(e.parameters["mode"] as string)).toBe(true);
    }
  });

  it("skips duplicate candidates (BASE mode)", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 3, defaultValue: 2 },
      ]),
    ];
    gen.applyConfig({ compositeMode: "BASE" });
    const emitted: unknown[] = [];
    const result = await gen.generate(
      (c: unknown) => { emitted.push(c); return true; },
      neverStop(),
      emptyState(),
    );
    expect(emitted.length).toBeLessThan(result.result.totalGenerated);
    expect(result.result.totalRejected).toBeGreaterThan(0);
  });

  it("emits one BASE candidate per iteration", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
    ];
    gen.applyConfig({ compositeMode: "BASE" });
    const emitted: unknown[] = [];
    const result = await gen.generate(
      (c: unknown) => { emitted.push(c); return true; },
      neverStop(),
      emptyState(),
    );
    expect(result.done).toBe(true);
    expect(emitted.length).toBeGreaterThan(0);
  });
});

describe("RandomGenerator — stop semantics", () => {
  let rng: SeededRandom;

  beforeEach(() => {
    rng = new SeededRandom(42);
    vi.stubGlobal("Math.random", () => rng.next());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stoppedByCondition=true when shouldStop returns true immediately", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [{ key: "p", kind: "integer", min: 2, max: 200, defaultValue: 14 }]),
    ];
    const result = await gen.generate(
      () => true,
      () => true,
      emptyState(),
    );
    expect(result.done).toBe(true);
    expect(result.result.stoppedByCondition).toBe(true);
  });

  it("stoppedByBackPressure=true when onCandidate returns false", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [{ key: "p", kind: "integer", min: 2, max: 200, defaultValue: 14 }]),
    ];
    const result = await gen.generate(
      () => false,
      neverStop(),
      emptyState(),
    );
    expect(result.done).toBe(true);
    expect(result.result.stoppedByBackPressure).toBe(true);
  });

  it("respects state.generatedCount as starting offset", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [{ key: "p", kind: "integer", min: 2, max: 200, defaultValue: 14 }]),
      makeSpace("strategy.rsi", [{ key: "p", kind: "integer", min: 5, max: 30, defaultValue: 14 }]),
    ];
    const state = { generatedCount: 2, queuedCount: 2, rejectedCount: 0, elapsedMs: 0 };
    const emitted: unknown[] = [];
    const result = await gen.generate(
      (c: unknown) => { emitted.push(c); return true; },
      neverStop(),
      state,
    );
    expect(emitted.length).toBeGreaterThan(0);
    expect(result.result.totalGenerated).toBeGreaterThan(0);
  });
});
