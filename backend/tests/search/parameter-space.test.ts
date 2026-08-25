/**
 * Tests for ParameterSpace — buildParameterSpace() and ParameterSpaceField types.
 */
import { describe, it, expect } from "vitest";
import type { ParamSpec } from "../../src/modules/strategy/domain/ParamSpec";
import { buildParameterSpace } from "../../src/modules/search/domain/ParameterSpace";

function makeSpec(fields: ParamSpec["fields"]): ParamSpec {
  return { fields };
}

describe("buildParameterSpace", () => {
  it("builds a valid space for integer fields", () => {
    const spec = makeSpec([
      { key: "period", kind: "integer", min: 5, max: 20, default: 14 },
    ]);
    const space = buildParameterSpace("strategy.ma", spec);
    expect(space).not.toBeNull();
    expect(space!.strategyId).toBe("strategy.ma");
    expect(space!.fields).toHaveLength(1);
    expect(space!.fields[0]!.key).toBe("period");
    expect(space!.fields[0]!.kind).toBe("integer");
    expect(space!.totalGridPoints).toBe(16); // 5..20 inclusive = 16
  });

  it("builds a valid space for decimal fields", () => {
    const spec = makeSpec([
      { key: "stdDev", kind: "decimal", min: 1.5, max: 3.0, default: 2.0 },
    ]);
    const space = buildParameterSpace("strategy.bollinger", spec);
    expect(space).not.toBeNull();
    expect(space!.fields[0]!.kind).toBe("decimal");
    expect(space!.totalGridPoints).toBe(Infinity); // continuous
  });

  it("builds a valid space for enum fields", () => {
    const spec = makeSpec([
      { key: "mode", kind: "enum", enumValues: ["long", "short", "both"], default: "both" },
    ]);
    const space = buildParameterSpace("strategy.mode", spec);
    expect(space).not.toBeNull();
    expect(space!.fields[0]!.kind).toBe("enum");
    const field = space!.fields[0] as { values: string[] };
    expect(field.values).toEqual(["long", "short", "both"]);
    expect(space!.totalGridPoints).toBe(3);
  });

  it("builds a valid multi-field space", () => {
    const spec = makeSpec([
      { key: "period", kind: "integer", min: 2, max: 10, default: 14 },
      { key: "stdDev", kind: "decimal", min: 1.5, max: 3.0, default: 2.0 },
    ]);
    const space = buildParameterSpace("strategy.combo", spec);
    expect(space).not.toBeNull();
    expect(space!.fields).toHaveLength(2);
    expect(space!.totalGridPoints).toBe(Infinity); // one field is continuous
  });

  it("returns null when integer field has no min", () => {
    const spec = makeSpec([
      { key: "period", kind: "integer", max: 20, default: 14 },
    ]);
    expect(buildParameterSpace("strategy.ma", spec)).toBeNull();
  });

  it("returns null when integer field has no max", () => {
    const spec = makeSpec([
      { key: "period", kind: "integer", min: 2, default: 14 },
    ]);
    expect(buildParameterSpace("strategy.ma", spec)).toBeNull();
  });

  it("returns null when decimal field has no min", () => {
    const spec = makeSpec([
      { key: "stdDev", kind: "decimal", max: 3.0, default: 2.0 },
    ]);
    expect(buildParameterSpace("strategy.bollinger", spec)).toBeNull();
  });

  it("returns null when enum field has no values", () => {
    const spec = makeSpec([
      { key: "mode", kind: "enum", enumValues: [], default: "both" },
    ]);
    expect(buildParameterSpace("strategy.mode", spec)).toBeNull();
  });

  it("empty spec produces a space with totalGridPoints = 1", () => {
    const spec = makeSpec([]);
    const space = buildParameterSpace("strategy.empty", spec);
    expect(space).not.toBeNull();
    expect(space!.totalGridPoints).toBe(1);
    expect(space!.fields).toHaveLength(0);
  });

  it("calculates totalGridPoints for bounded discrete space", () => {
    const spec = makeSpec([
      { key: "fast", kind: "integer", min: 2, max: 5, default: 3 },        // 4 values
      { key: "slow", kind: "integer", min: 10, max: 12, default: 11 },      // 3 values
      { key: "mode", kind: "enum", enumValues: ["a", "b"], default: "a" },  // 2 values
    ]);
    const space = buildParameterSpace("strategy.multi", spec);
    expect(space).not.toBeNull();
    expect(space!.totalGridPoints).toBe(4 * 3 * 2); // 24
  });
});
