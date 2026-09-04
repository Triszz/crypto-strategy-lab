/**
 * Unit tests for DomainGuidedGenerator.
 *
 * Goal: prove that the family → ParameterSpace mapping works correctly when the
 * frontend sends `{name: "<group>", families: ["<FAMILY>"]}` entries and that
 * the generator emits valid CompositeCandidates instead of rejecting all of them.
 */
import { beforeEach, describe, it, expect } from "vitest";
import {
  DomainGuidedGenerator,
  __test__ as dgTest,
} from "../../src/modules/search/generators/DomainGuidedGenerator";
import { buildParameterSpace } from "../../src/modules/search/domain/ParameterSpace";
import {
  getStrategyRegistry,
  resetStrategyRegistry,
} from "../../src/modules/strategy/domain/StrategyRegistry";
import {
  bootstrapStrategies,
} from "../../src/modules/strategy/strategies/bootstrap";
import type { ParameterSpace } from "../../src/modules/search/domain/ParameterSpace";
import type { SearchState } from "../../src/modules/search/domain/StopCondition";
import type {
  SearchCandidate,
  CompositeCandidate,
} from "../../src/modules/search/domain/SearchCandidate";

function freshState(): SearchState {
  return {
    generatedCount: 0,
    queuedCount: 0,
    rejectedCount: 0,
    elapsedMs: 0,
  };
}

function buildSpaces(): ParameterSpace[] {
  const registry = getStrategyRegistry();
  const out: ParameterSpace[] = [];
  for (const id of registry.list()) {
    const s = registry.resolve(id);
    if (!s) continue;
    const sp = buildParameterSpace(s.id, s.parameterSpec);
    if (sp) out.push(sp);
  }
  return out;
}

describe("DomainGuidedGenerator", () => {
  let spaces: ParameterSpace[];

  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
    spaces = buildSpaces();
  });

  describe("family → ParameterSpace index", () => {
    it("TREND resolves to the TREND family parameter space", () => {
      const idx = dgTest.buildFamilyIndex(spaces, getStrategyRegistry());
      const trend = idx.get("TREND");
      expect(trend).toBeDefined();
      expect(trend!.length).toBeGreaterThan(0);
      const trendIds = trend!.map((s) => s.strategyId);
      expect(trendIds).toContain("strategy.ma");
    });

    it("MOMENTUM resolves to the MOMENTUM family parameter space", () => {
      const idx = dgTest.buildFamilyIndex(spaces, getStrategyRegistry());
      const m = idx.get("MOMENTUM");
      expect(m).toBeDefined();
      expect(m!.map((s) => s.strategyId)).toContain("strategy.rsi");
    });

    it("VOLATILITY resolves to the VOLATILITY family parameter space", () => {
      const idx = dgTest.buildFamilyIndex(spaces, getStrategyRegistry());
      const v = idx.get("VOLATILITY");
      expect(v).toBeDefined();
      expect(v!.map((s) => s.strategyId)).toContain("strategy.bollinger");
    });

    it("STRUCTURE resolves to the STRUCTURE family parameter space", () => {
      const idx = dgTest.buildFamilyIndex(spaces, getStrategyRegistry());
      const s = idx.get("STRUCTURE");
      expect(s).toBeDefined();
      expect(s!.map((x) => x.strategyId)).toContain("strategy.support_resistance");
    });

    it("does NOT hardcode strategy ids: any unknown family maps to []", () => {
      const idx = dgTest.buildFamilyIndex(spaces, getStrategyRegistry());
      expect(idx.get("DOES_NOT_EXIST")).toBeUndefined();
    });
  });

  describe("legacy family-group mode (backward-compatible)", () => {
    it("emits COMPOSITE candidate with one strategy per filled group", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [
          { name: "trend", families: ["TREND"] },
          { name: "momentum", families: ["MOMENTUM"] },
          { name: "volatility", families: ["VOLATILITY"] },
          { name: "structure", families: ["STRUCTURE"] },
        ],
        mode: "EXHAUSTIVE",
      });

      const seen: SearchCandidate[] = [];
      const result = await gen.generate(
        async (c) => { seen.push(c); return true; },
        () => false,
        freshState(),
      );

      // With 1 strategy per family, legacy mode yields exactly 1 candidate
      expect(seen.length).toBe(1);
      expect(result.result.totalGenerated).toBeLessThan(2000);
      expect(result.result.totalQueued).toBe(1);

      for (const c of seen) {
        expect(c.candidateType).toBe("COMPOSITE");
        const cc = c as CompositeCandidate;
        expect(cc.config.id.startsWith("strategy.composite.domain_guided.")).toBe(true);
        expect(cc.config.components.length).toBe(4);
        const ids = cc.config.components.map((x) => x.strategyId).sort();
        expect(ids).toContain("strategy.ma");
        expect(ids).toContain("strategy.rsi");
        expect(ids).toContain("strategy.bollinger");
        expect(ids).toContain("strategy.support_resistance");
        const wsum = cc.config.components.reduce((s, x) => s + x.weight, 0);
        expect(Math.abs(wsum - 1)).toBeLessThan(1e-9);
      }
    });

    it("emits a candidate whose id matches the stable composite implementationRef pattern", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [
          { name: "trend", families: ["TREND"] },
          { name: "momentum", families: ["MOMENTUM"] },
        ],
        mode: "EXHAUSTIVE",
      });
      const seen: SearchCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c); return true; },
        () => false,
        freshState(),
      );
      expect(seen.length).toBe(1);
      const cc = seen[0] as CompositeCandidate;
      expect(cc.config.id).toMatch(/^strategy\.composite\.domain_guided\./);
      expect(cc.config.id).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("produces zero candidates when a family is not represented in the registry", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [{ name: "mystery", families: ["NOT_A_FAMILY"] }],
        mode: "EXHAUSTIVE",
      });
      const seen: SearchCandidate[] = [];
      const result = await gen.generate(
        async (c) => { seen.push(c); return true; },
        () => false,
        freshState(),
      );
      expect(seen.length).toBe(0);
      expect(result.result.totalGenerated).toBe(0);
      expect(result.result.totalQueued).toBe(0);
      expect(result.result.totalRejected).toBe(0);
    });

    it("respects maxCandidates cap from domainConfig", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [
          { name: "trend", families: ["TREND"] },
          { name: "momentum", families: ["MOMENTUM"] },
          { name: "volatility", families: ["VOLATILITY"] },
          { name: "structure", families: ["STRUCTURE"] },
        ],
        mode: "EXHAUSTIVE",
        maxCombinations: 1,
      });
      const seen: SearchCandidate[] = [];
      const result = await gen.generate(
        async (c) => { seen.push(c); return true; },
        () => false,
        freshState(),
      );
      expect(seen.length).toBe(1);
      expect(result.result.totalQueued).toBe(1);
    });

    it("deduplicates composites by component set (BR-019)", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [
          { name: "trend", families: ["TREND"] },
          { name: "momentum", families: ["MOMENTUM"] },
        ],
        mode: "RANDOM_SAMPLE",
        maxCombinations: 100,
      });
      const seen: SearchCandidate[] = [];
      const result = await gen.generate(
        async (c) => { seen.push(c); return true; },
        () => false,
        freshState(),
      );
      // Only 1 unique composite is possible with 1 strategy per family.
      expect(seen.length).toBe(1);
      expect(result.result.totalQueued).toBe(1);
      expect(result.result.totalRejected).toBeGreaterThan(0);
    });
  });

  describe("subset enumeration mode (minComponents / maxComponents)", () => {
    it("enumerates all k-subsets for k ∈ [minComponents, maxComponents]", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        mode: "EXHAUSTIVE",
      });

      const seen: SearchCandidate[] = [];
      const result = await gen.generate(
        async (c) => { seen.push(c); return true; },
        () => false,
        freshState(),
      );

      // C(5,2) + C(5,3) + C(5,4) = 10 + 10 + 5 = 25 unique combinations (with 5 built-in strategies)
      expect(seen.length).toBe(25);
      expect(result.result.totalQueued).toBe(25);
      expect(result.result.totalGenerated).toBeLessThan(2000);
      for (const c of seen) {
        expect(c.candidateType).toBe("COMPOSITE");
        const cc = c as CompositeCandidate;
        expect(cc.config.components.length).toBeGreaterThanOrEqual(2);
        expect(cc.config.components.length).toBeLessThanOrEqual(4);
      }
    });

    it("filters by requiredFamilies", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        requiredFamilies: ["TREND", "MOMENTUM", "STRUCTURE"],
        mode: "EXHAUSTIVE",
      });

      const seen: CompositeCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c as CompositeCandidate); return true; },
        () => false,
        freshState(),
      );

      // All emitted composites must contain at least one TREND, one MOMENTUM, one STRUCTURE strategy.
      for (const cc of seen) {
        const ids = cc.config.components.map((x) => x.strategyId);
        expect(ids).toContain("strategy.ma");
        expect(ids).toContain("strategy.rsi");
        expect(ids).toContain("strategy.support_resistance");
      }

      // Valid: MA + RSI + SR, MA + RSI + SR + BB, MA + RSI + SR + Sentiment = 3 total
      expect(seen.length).toBe(3);
    });

    it("GUIDED mode emits ALL k-subsets and ranks domain-valid ones first", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        requiredFamilies: ["TREND", "MOMENTUM", "STRUCTURE"],
        domainMode: "GUIDED",
        mode: "EXHAUSTIVE",
      });

      const seen: CompositeCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c as CompositeCandidate); return true; },
        () => false,
        freshState(),
      );

      // GUIDED must NOT filter — all 25 k-subsets are emitted (10 + 10 + 5).
      expect(seen.length).toBe(25);

      // Components.length must always be ≥ 2.
      for (const cc of seen) {
        expect(cc.config.components.length).toBeGreaterThanOrEqual(2);
        expect(cc.config.components.length).toBeLessThanOrEqual(4);
      }

      // The first two emitted composites must be the domain-valid ones:
      // {MA, RSI, SR} and {MA, RSI, SR, BB}. We check by component strategy IDs.
      const firstIds = seen[0]!.config.components.map((c) => c.strategyId).sort();
      expect(firstIds).toContain("strategy.ma");
      expect(firstIds).toContain("strategy.rsi");
      expect(firstIds).toContain("strategy.support_resistance");
      expect(seen[0]!.config.components.length).toBe(3);

      const secondIds = seen[1]!.config.components.map((c) => c.strategyId).sort();
      expect(secondIds.length).toBe(4);
      expect(secondIds).toContain("strategy.ma");
      expect(secondIds).toContain("strategy.rsi");
      expect(secondIds).toContain("strategy.support_resistance");
      expect(secondIds).toContain("strategy.bollinger");
    });

    it("GUIDED mode preserves weights summing to 1 across all emitted composites", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        requiredFamilies: ["TREND", "MOMENTUM", "STRUCTURE"],
        domainMode: "GUIDED",
        mode: "EXHAUSTIVE",
      });

      const seen: CompositeCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c as CompositeCandidate); return true; },
        () => false,
        freshState(),
      );

      for (const cc of seen) {
        const wsum = cc.config.components.reduce((s, x) => s + x.weight, 0);
        expect(Math.abs(wsum - 1)).toBeLessThan(1e-9);
      }
    });

    it("GUIDED mode emits 2-strategy, 3-strategy, and 4-strategy combinations", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        requiredFamilies: ["TREND", "MOMENTUM", "STRUCTURE"],
        domainMode: "GUIDED",
        mode: "EXHAUSTIVE",
      });

      const seen: CompositeCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c as CompositeCandidate); return true; },
        () => false,
        freshState(),
      );

      const sizes = new Set(seen.map((cc) => cc.config.components.length));
      expect(sizes.has(2)).toBe(true);
      expect(sizes.has(3)).toBe(true);
      expect(sizes.has(4)).toBe(true);
    });

    it("RANDOM_SAMPLE in subset mode still emits composites with k ≥ 2", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        mode: "RANDOM_SAMPLE",
        maxCombinations: 30,
      });

      const seen: SearchCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c); return true; },
        () => false,
        freshState(),
      );

      expect(seen.length).toBeGreaterThan(0);
      for (const c of seen) {
        const cc = c as CompositeCandidate;
        expect(cc.config.components.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("does NOT emit 1-component composites", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        mode: "EXHAUSTIVE",
      });

      const seen: CompositeCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c as CompositeCandidate); return true; },
        () => false,
        freshState(),
      );
      for (const cc of seen) {
        expect(cc.config.components.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("weights sum to 1 for every emitted composite", async () => {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      gen.setRegistry(getStrategyRegistry());
      gen.applyConfig({
        familyGroups: [],
        minComponents: 2,
        maxComponents: 4,
        mode: "EXHAUSTIVE",
      });

      const seen: CompositeCandidate[] = [];
      await gen.generate(
        async (c) => { seen.push(c as CompositeCandidate); return true; },
        () => false,
        freshState(),
      );
      for (const cc of seen) {
        const wsum = cc.config.components.reduce((s, x) => s + x.weight, 0);
        expect(Math.abs(wsum - 1)).toBeLessThan(1e-9);
      }
    });
  });

  describe("subset enumeration helpers", () => {
    it("allKSubsets(4, 2) returns 6 subsets", () => {
      const subsets = dgTest.allKSubsets(4, 2);
      expect(subsets.length).toBe(6);
      for (const s of subsets) expect(s.length).toBe(2);
    });

    it("allKSubsets(4, 3) returns 4 subsets", () => {
      expect(dgTest.allKSubsets(4, 3).length).toBe(4);
    });

    it("allKSubsets(4, 4) returns 1 subset", () => {
      expect(dgTest.allKSubsets(4, 4).length).toBe(1);
    });

    it("allKSubsets(4, 0) returns 1 empty subset", () => {
      expect(dgTest.allKSubsets(4, 0).length).toBe(1);
    });

    it("allKSubsets(4, 5) returns 0 subsets (k > n)", () => {
      expect(dgTest.allKSubsets(4, 5).length).toBe(0);
    });
  });
});
