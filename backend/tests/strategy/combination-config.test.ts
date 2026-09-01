/**
 * Tests for CombinationConfig validation.
 */
import { describe, it, expect } from "vitest";

import {
  validateCombinationConfig,
  type CombinationConfig,
} from "../../src/modules/strategy";

function makeConfig(
  components: Array<{ id: string; weight: number; position: number }>,
): CombinationConfig {
  return {
    id: "strategy.composite.test",
    name: "Test Combo",
    components: components.map((c) => ({
      strategyId: c.id,
      weight: c.weight,
      position: c.position,
    })),
  };
}

describe("validateCombinationConfig", () => {
  it("accepts a valid single-component config", () => {
    const cfg = makeConfig([{ id: "strategy.ma", weight: 1, position: 0 }]);
    expect(validateCombinationConfig(cfg)).toEqual({ ok: true });
  });

  it("accepts a valid multi-component config", () => {
    const cfg = makeConfig([
      { id: "strategy.ma", weight: 0.4, position: 0 },
      { id: "strategy.rsi", weight: 0.6, position: 1 },
    ]);
    expect(validateCombinationConfig(cfg)).toEqual({ ok: true });
  });

  it("rejects empty components array", () => {
    const cfg = makeConfig([]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/at least one component/);
    }
  });

  it("rejects empty strategyId", () => {
    const cfg = makeConfig([{ id: "   ", weight: 1, position: 0 }]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/non-empty string/);
    }
  });

  it("rejects negative weight", () => {
    const cfg = makeConfig([{ id: "strategy.ma", weight: -0.5, position: 0 }]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/≥ 0/);
    }
  });

  it("rejects NaN weight", () => {
    const cfg = makeConfig([{ id: "strategy.ma", weight: NaN, position: 0 }]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
  });

  it("rejects non-integer position", () => {
    const cfg = makeConfig([{ id: "strategy.ma", weight: 1, position: 1.5 }]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/non-negative integer/);
    }
  });

  it("rejects negative position", () => {
    const cfg = makeConfig([{ id: "strategy.ma", weight: 1, position: -1 }]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate strategyId", () => {
    const cfg = makeConfig([
      { id: "strategy.ma", weight: 0.5, position: 0 },
      { id: "strategy.ma", weight: 0.5, position: 1 },
    ]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/duplicate.*strategy.ma/);
    }
  });

  it("rejects duplicate position", () => {
    const cfg = makeConfig([
      { id: "strategy.ma", weight: 0.5, position: 1 },
      { id: "strategy.rsi", weight: 0.5, position: 1 },
    ]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/duplicate position/);
    }
  });

  it("accepts equal weights (e.g. 0.5 + 0.5 = 1.0)", () => {
    const cfg = makeConfig([
      { id: "strategy.ma", weight: 0.5, position: 0 },
      { id: "strategy.rsi", weight: 0.5, position: 1 },
    ]);
    expect(validateCombinationConfig(cfg)).toEqual({ ok: true });
  });

  it("accepts weights that do not sum to 1.0 (normalisation is the engine's job)", () => {
    const cfg = makeConfig([
      { id: "strategy.ma", weight: 4, position: 0 },
      { id: "strategy.rsi", weight: 6, position: 1 },
    ]);
    expect(validateCombinationConfig(cfg)).toEqual({ ok: true });
  });

  it("reports multiple errors at once", () => {
    const cfg = makeConfig([
      { id: "", weight: -1, position: 0 },
      { id: "strategy.ma", weight: 0.5, position: -1 },
    ]);
    const r = validateCombinationConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
