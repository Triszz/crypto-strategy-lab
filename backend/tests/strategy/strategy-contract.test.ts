/**
 * Tests for the Strategy domain value objects and the ParamSpec
 * helper. Pure TypeScript — no DB, no Prisma, no I/O.
 */
import { describe, it, expect } from "vitest";

import {
  defaultParametersFromSpec,
  holdSignal,
  validateParamSpec,
  type ParamSpec,
} from "../../src/modules/strategy";

describe("ParamSpec validation", () => {
  const spec: ParamSpec = {
    fields: [
      { key: "period", kind: "integer", min: 2, max: 100, default: 14 },
      { key: "stdDevMultiplier", kind: "decimal", min: 0.1, max: 10, default: 2 },
      { key: "side", kind: "enum", enumValues: ["long", "short"], default: "long" },
    ],
  };

  it("accepts a fully valid parameter object", () => {
    const result = validateParamSpec(spec, {
      period: 14,
      stdDevMultiplier: 2,
      side: "long",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing required field", () => {
    const result = validateParamSpec(spec, {
      period: 14,
      stdDevMultiplier: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("side"))).toBe(true);
    }
  });

  it("rejects non-integer for integer field", () => {
    const result = validateParamSpec(spec, {
      period: 14.5,
      stdDevMultiplier: 2,
      side: "long",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/integer/i);
    }
  });

  it("rejects value below min", () => {
    const result = validateParamSpec(spec, {
      period: 1,
      stdDevMultiplier: 2,
      side: "long",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/≥ 2/);
    }
  });

  it("rejects value above max", () => {
    const result = validateParamSpec(spec, {
      period: 200,
      stdDevMultiplier: 2,
      side: "long",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/≤ 100/);
    }
  });

  it("rejects enum value not in enumValues", () => {
    const result = validateParamSpec(spec, {
      period: 14,
      stdDevMultiplier: 2,
      side: "weird",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/one of \[long, short\]/);
    }
  });

  it("rejects unknown parameter keys", () => {
    const result = validateParamSpec(spec, {
      period: 14,
      stdDevMultiplier: 2,
      side: "long",
      mystery: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("mystery"))).toBe(true);
    }
  });

  it("defaultParametersFromSpec returns declared defaults", () => {
    const defaults = defaultParametersFromSpec(spec);
    expect(defaults).toEqual({ period: 14, stdDevMultiplier: 2, side: "long" });
  });
});

describe("Signal helpers", () => {
  it("holdSignal() returns a minimal HOLD signal when called with no args", () => {
    const sig = holdSignal();
    expect(sig.side).toBe("HOLD");
    expect(sig.strength).toBe(0);
    expect(sig.reason).toBeUndefined();
    expect(sig.metadata).toBeUndefined();
  });

  it("holdSignal() propagates reason and metadata when supplied", () => {
    const sig = holdSignal("warm-up", { foo: 1 });
    expect(sig.side).toBe("HOLD");
    expect(sig.strength).toBe(0);
    expect(sig.reason).toBe("warm-up");
    expect(sig.metadata).toEqual({ foo: 1 });
  });
});