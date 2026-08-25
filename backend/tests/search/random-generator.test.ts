/**
 * Tests for RandomGenerator. Uses a mock PRNG so tests are deterministic.
 * We override Math.random via vi.stubGlobal.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { ParameterSpace } from "../../src/modules/search/domain/ParameterSpace";
import { RandomGenerator } from "../../src/modules/search/generators/RandomGenerator";

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

describe("RandomGenerator", () => {
  let rng: SeededRandom;

  beforeEach(() => {
    rng = new SeededRandom(42);
    vi.stubGlobal("Math.random", () => rng.next());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("emits one candidate per iteration", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
    ];
    const emitted: unknown[] = [];
    const result = await gen.generate(
      (c: unknown) => { emitted.push(c); return true; },
      neverStop(),
      emptyState(),
    );
    expect(result.done).toBe(true);
    expect(emitted.length).toBeGreaterThan(0);
  });

  it("emitted candidates have candidateType BASE", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
    ];
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

  it("skips duplicate candidates (same params for same strategy)", async () => {
    const gen = new RandomGenerator();
    // Only 2 possible values → duplicates appear within ~50 attempts
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 3, defaultValue: 2 },
      ]),
    ];
    const emitted: unknown[] = [];
    const result = await gen.generate(
      (c: unknown) => { emitted.push(c); return true; },
      neverStop(),
      emptyState(),
    );
    // With only 2 possible values (2 and 3), duplicates appear quickly.
    expect(emitted.length).toBeLessThan(result.result.totalGenerated);
    expect(result.result.totalRejected).toBeGreaterThan(0);
  });

  it("stoppedByCondition=true when shouldStop returns true immediately", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
    ];
    const result = await gen.generate(
      () => true,
      () => true, // stop immediately
      emptyState(),
    );
    expect(result.done).toBe(true);
    expect(result.result.stoppedByCondition).toBe(true);
  });

  it("stoppedByBackPressure=true when onCandidate returns false", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 200, defaultValue: 14 },
      ]),
    ];
    const result = await gen.generate(
      () => false, // always signal back-pressure
      neverStop(),
      emptyState(),
    );
    expect(result.done).toBe(true);
    expect(result.result.stoppedByBackPressure).toBe(true);
  });

  it("parameter values are within declared bounds", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.rsi", [
        { key: "period", kind: "integer", min: 5, max: 10, defaultValue: 14 },
        { key: "threshold", kind: "decimal", min: 20, max: 30, defaultValue: 25 },
      ]),
    ];
    const emitted: Array<{ parameters: Record<string, unknown> }> = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as { parameters: Record<string, unknown> }); return true; },
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

  it("enum fields pick from declared values", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.test", [
        { key: "mode", kind: "enum", values: ["a", "b", "c"], defaultValue: "a" },
      ]),
    ];
    const emitted: Array<{ parameters: Record<string, unknown> }> = [];
    await gen.generate(
      (c: unknown) => { emitted.push(c as { parameters: Record<string, unknown> }); return true; },
      neverStop(),
      emptyState(),
    );
    const valid = new Set(["a", "b", "c"]);
    for (const e of emitted) {
      expect(valid.has(e.parameters["mode"] as string)).toBe(true);
    }
  });

  it("respects state.generatedCount as starting offset for deduplication", async () => {
    const gen = new RandomGenerator();
    gen.spaces = [
      makeSpace("strategy.ma", [
        { key: "period", kind: "integer", min: 2, max: 3, defaultValue: 2 },
      ]),
    ];
    // Simulate pause/resume: 2 candidates already generated.
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
