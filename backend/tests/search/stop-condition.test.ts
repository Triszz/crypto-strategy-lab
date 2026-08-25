/**
 * Tests for StopCondition domain types and factory functions.
 */
import { describe, it, expect } from "vitest";
import type { SearchState } from "../../src/modules/search/domain/StopCondition";
import {
  maxCandidatesStopCondition,
  timeBudgetStopCondition,
  anyStopCondition,
} from "../../src/modules/search/domain/StopCondition";

function makeState(overrides: Partial<SearchState> = {}): SearchState {
  return {
    generatedCount: 0,
    queuedCount: 0,
    rejectedCount: 0,
    elapsedMs: 0,
    ...overrides,
  };
}

describe("maxCandidatesStopCondition", () => {
  it("returns false when generated < max", () => {
    const cond = maxCandidatesStopCondition(10);
    expect(cond(makeState({ generatedCount: 5 }))).toBe(false);
  });

  it("returns true when generated >= max", () => {
    const cond = maxCandidatesStopCondition(10);
    expect(cond(makeState({ generatedCount: 10 }))).toBe(true);
    expect(cond(makeState({ generatedCount: 11 }))).toBe(true);
  });

  it("stops at exactly maxCandidates", () => {
    const cond = maxCandidatesStopCondition(100);
    expect(cond(makeState({ generatedCount: 100 }))).toBe(true);
  });
});

describe("timeBudgetStopCondition", () => {
  it("returns false when elapsed < limit", () => {
    const cond = timeBudgetStopCondition(60_000);
    expect(cond(makeState({ elapsedMs: 30_000 }))).toBe(false);
  });

  it("returns true when elapsed >= limit", () => {
    const cond = timeBudgetStopCondition(60_000);
    expect(cond(makeState({ elapsedMs: 60_000 }))).toBe(true);
    expect(cond(makeState({ elapsedMs: 90_000 }))).toBe(true);
  });

  it("returns true at exactly the limit", () => {
    const cond = timeBudgetStopCondition(30_000);
    expect(cond(makeState({ elapsedMs: 30_000 }))).toBe(true);
  });
});

describe("anyStopCondition", () => {
  it("returns false when all conditions are false", () => {
    const cond = anyStopCondition([
      maxCandidatesStopCondition(10),
      timeBudgetStopCondition(60_000),
    ]);
    expect(cond(makeState({ generatedCount: 5, elapsedMs: 30_000 }))).toBe(false);
  });

  it("returns true when first condition is true", () => {
    const cond = anyStopCondition([
      maxCandidatesStopCondition(10),
      timeBudgetStopCondition(60_000),
    ]);
    expect(cond(makeState({ generatedCount: 10, elapsedMs: 30_000 }))).toBe(true);
  });

  it("returns true when second condition is true", () => {
    const cond = anyStopCondition([
      maxCandidatesStopCondition(10),
      timeBudgetStopCondition(60_000),
    ]);
    expect(cond(makeState({ generatedCount: 5, elapsedMs: 60_000 }))).toBe(true);
  });

  it("returns true when both conditions are true", () => {
    const cond = anyStopCondition([
      maxCandidatesStopCondition(10),
      timeBudgetStopCondition(60_000),
    ]);
    expect(cond(makeState({ generatedCount: 10, elapsedMs: 60_000 }))).toBe(true);
  });

  it("works with a single condition", () => {
    const cond = anyStopCondition([maxCandidatesStopCondition(5)]);
    expect(cond(makeState({ generatedCount: 5 }))).toBe(true);
    expect(cond(makeState({ generatedCount: 4 }))).toBe(false);
  });

  it("returns false for empty conditions array", () => {
    const cond = anyStopCondition([]);
    expect(cond(makeState())).toBe(false);
  });
});
