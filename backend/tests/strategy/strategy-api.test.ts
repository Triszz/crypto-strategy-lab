/**
 * Tests for the Strategy catalogue API (presentation layer).
 *
 * Covers:
 *  - list returns all registered strategies
 *  - list is empty when registry is empty
 *  - get returns detail for existing strategy
 *  - get returns null for unknown strategy
 *  - list contains parameter spec and requiredHistory
 *  - list does not expose internal implementation objects
 *  - no hard-coded strategy branching exists
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  StrategyService,
  type StrategyListItem,
  type StrategyDetail,
} from "../../src/modules/strategy/presentation/StrategyService";
import {
  getStrategyRegistry,
  resetStrategyRegistry,
} from "../../src/modules/strategy/domain/StrategyRegistry";
import { bootstrapStrategies } from "../../src/modules/strategy/strategies/bootstrap";

describe("StrategyService", () => {
  beforeEach(() => {
    resetStrategyRegistry();
  });

  describe("list()", () => {
    it("returns empty when no strategies are registered", () => {
      const service = new StrategyService();
      const result = service.list();
      expect(result.strategies).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("returns all bootstrapped strategies", () => {
      bootstrapStrategies();
      const service = new StrategyService();
      const result = service.list();

      expect(result.total).toBeGreaterThan(0);
      expect(result.strategies).toHaveLength(result.total);

      // All returned items are StrategyListItems
      for (const item of result.strategies) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("name");
        expect(item).toHaveProperty("family");
        expect(item).toHaveProperty("type", "BASE");
        expect(item).toHaveProperty("requiredHistory");
        expect(item).toHaveProperty("parameterSpec");
        expect(item.parameterSpec).toHaveProperty("fields");
        expect(Array.isArray(item.parameterSpec.fields)).toBe(true);
      }
    });

    it("each strategy contains requiredHistory and parameterSpec", () => {
      bootstrapStrategies();
      const service = new StrategyService();
      const result = service.list();

      for (const item of result.strategies) {
        expect(typeof item.requiredHistory).toBe("number");
        expect(item.requiredHistory).toBeGreaterThan(0);
        expect(item.parameterSpec.fields.length).toBeGreaterThan(0);
      }
    });

    it("each parameter field has kind, key, and defaultValue", () => {
      bootstrapStrategies();
      const service = new StrategyService();
      const result = service.list();

      for (const item of result.strategies) {
        for (const field of item.parameterSpec.fields) {
          expect(typeof field.key).toBe("string");
          expect(["integer", "decimal", "enum"]).toContain(field.kind);
          // defaultValue can be string or number
          expect(typeof field.defaultValue === "number" || typeof field.defaultValue === "string").toBe(true);
        }
      }
    });

    it("integer/decimal fields include min and max", () => {
      bootstrapStrategies();
      const service = new StrategyService();
      const result = service.list();

      const numericFields = result.strategies
        .flatMap((s) => s.parameterSpec.fields)
        .filter((f) => f.kind === "integer" || f.kind === "decimal");

      for (const field of numericFields) {
        expect(field).toHaveProperty("min");
        expect(field).toHaveProperty("max");
      }
    });

    it("does not expose internal implementation objects", () => {
      bootstrapStrategies();
      const service = new StrategyService();
      const result = service.list();

      for (const item of result.strategies) {
        // Internal domain types must not leak through
        expect(item).not.toHaveProperty("analyze");
        expect(item).not.toHaveProperty("validateParameters");
        expect(item).not.toHaveProperty("defaultParameters"); // detail-only field
        expect(item).not.toHaveProperty("parameterValidation"); // detail-only field
      }
    });

    it("returns strategies sorted alphabetically by id", () => {
      bootstrapStrategies();
      const service = new StrategyService();
      const result = service.list();

      const ids = result.strategies.map((s) => s.id);
      expect(ids).toEqual([...ids].sort());
    });
  });

  describe("get(id)", () => {
    it("returns null for an unknown strategy id", () => {
      const service = new StrategyService();
      expect(service.get("strategy.unknown")).toBeNull();
    });

    it("returns a StrategyDetail for a bootstrapped strategy", () => {
      bootstrapStrategies();
      const service = new StrategyService();

      const registry = getStrategyRegistry();
      const firstId = registry.list()[0]!;
      const detail = service.get(firstId);

      expect(detail).not.toBeNull();
      expect(detail!.id).toBe(firstId);
    });

    it("detail includes defaultParameters", () => {
      bootstrapStrategies();
      const service = new StrategyService();

      const registry = getStrategyRegistry();
      const firstId = registry.list()[0]!;
      const detail = service.get(firstId);

      expect(detail).toHaveProperty("defaultParameters");
      expect(typeof detail!.defaultParameters).toBe("object");
    });

    it("detail includes parameterValidation.hasCrossFieldRules", () => {
      bootstrapStrategies();
      const service = new StrategyService();

      const registry = getStrategyRegistry();
      for (const id of registry.list()) {
        const detail = service.get(id);
        expect(detail!.parameterValidation).toHaveProperty("hasCrossFieldRules");
        expect(typeof detail!.parameterValidation.hasCrossFieldRules).toBe("boolean");
      }
    });

    it("MA and RSI strategies report hasCrossFieldRules = true", () => {
      bootstrapStrategies();
      const service = new StrategyService();

      const ma = service.get("strategy.ma");
      const rsi = service.get("strategy.rsi");

      expect(ma?.parameterValidation.hasCrossFieldRules).toBe(true);
      expect(rsi?.parameterValidation.hasCrossFieldRules).toBe(true);
    });

    it("Bollinger and SupportResistance strategies report hasCrossFieldRules = false", () => {
      bootstrapStrategies();
      const service = new StrategyService();

      const bb = service.get("strategy.bollinger");
      const sr = service.get("strategy.support_resistance");

      expect(bb?.parameterValidation.hasCrossFieldRules).toBe(false);
      expect(sr?.parameterValidation.hasCrossFieldRules).toBe(false);
    });

    it("detail does not expose internal implementation objects", () => {
      bootstrapStrategies();
      const service = new StrategyService();

      const registry = getStrategyRegistry();
      const firstId = registry.list()[0]!;
      const detail = service.get(firstId);

      expect(detail).not.toHaveProperty("analyze");
      expect(detail).not.toHaveProperty("validateParameters");
    });
  });

  describe("no hard-coded branching", () => {
    it("service works for any registered strategy without branching on id", () => {
      bootstrapStrategies();
      const service = new StrategyService();

      const registry = getStrategyRegistry();
      const ids = registry.list();

      // All registered strategies should be reachable through the service
      for (const id of ids) {
        const listItem = service.list().strategies.find((s) => s.id === id);
        expect(listItem).toBeDefined();

        const detail = service.get(id);
        expect(detail).not.toBeNull();
        expect(detail!.id).toBe(id);
      }
    });
  });
});
