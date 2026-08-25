/**
 * Tests for the runtime StrategyRegistry.
 *
 * The registry is a process-wide singleton; tests reset it via
 * `resetStrategyRegistry()` to keep cases isolated.
 */
import { beforeEach, describe, it, expect } from "vitest";

import type { Strategy } from "../../src/modules/strategy/domain/Strategy";
import type { StrategyContext } from "../../src/modules/strategy/domain/StrategyContext";
import type { Signal } from "../../src/modules/strategy/domain/Signal";
import {
  getStrategyRegistry,
  resetStrategyRegistry,
} from "../../src/modules/strategy/domain/StrategyRegistry";

function fakeStrategy(id: string, name: string): Strategy {
  return {
    id,
    name,
    family: "TREND",
    requiredHistory: 1,
    parameterSpec: { fields: [] },
    defaultParameters: () => ({}),
    validateParameters: () => ({ ok: true }),
    analyze: (_ctx: StrategyContext): Signal => ({ side: "HOLD", strength: 0 }),
  };
}

describe("StrategyRegistry", () => {
  beforeEach(() => {
    resetStrategyRegistry();
  });

  it("register / resolve / has round-trip", () => {
    const r = getStrategyRegistry();
    const s = fakeStrategy("strategy.fake", "Fake");
    r.register(s);
    expect(r.has("strategy.fake")).toBe(true);
    expect(r.resolve("strategy.fake")?.id).toBe("strategy.fake");
  });

  it("resolve returns undefined for unknown id", () => {
    const r = getStrategyRegistry();
    expect(r.resolve("strategy.does-not-exist")).toBeUndefined();
    expect(r.has("strategy.does-not-exist")).toBe(false);
  });

  it("register rejects duplicate id", () => {
    const r = getStrategyRegistry();
    r.register(fakeStrategy("strategy.x", "X"));
    expect(() => r.register(fakeStrategy("strategy.x", "X2"))).toThrow(
      /already registered/,
    );
  });

  it("register rejects empty / missing id", () => {
    const r = getStrategyRegistry();
    expect(() =>
      r.register({
        ...fakeStrategy("ok", "ok"),
        id: "",
      }),
    ).toThrow(/non-empty string/);
  });

  it("list() returns all registered ids sorted alphabetically", () => {
    const r = getStrategyRegistry();
    r.register(fakeStrategy("strategy.z", "Z"));
    r.register(fakeStrategy("strategy.a", "A"));
    r.register(fakeStrategy("strategy.m", "M"));
    expect(r.list()).toEqual(["strategy.a", "strategy.m", "strategy.z"]);
  });

  it("clear() removes all registrations", () => {
    const r = getStrategyRegistry();
    r.register(fakeStrategy("strategy.x", "X"));
    r.clear();
    expect(r.list()).toEqual([]);
    expect(r.has("strategy.x")).toBe(false);
  });

  it("resetStrategyRegistry() clears the process-wide singleton", () => {
    const r = getStrategyRegistry();
    r.register(fakeStrategy("strategy.x", "X"));
    expect(r.list()).toHaveLength(1);
    resetStrategyRegistry();
    const r2 = getStrategyRegistry();
    expect(r2.list()).toEqual([]);
  });
});