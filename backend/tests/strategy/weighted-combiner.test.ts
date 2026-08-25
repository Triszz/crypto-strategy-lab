/**
 * Tests for CompositeSignal aggregation via WeightedCombiner.
 * Pure function — no I/O, no mocks.
 */
import { describe, it, expect } from "vitest";

import {
  combineComponentVotes,
  buildComponentVote,
  type ComponentVote,
} from "../../src/modules/strategy";
import type { Signal } from "../../src/modules/strategy/domain/Signal";

function sig(side: "BUY" | "SELL" | "HOLD", strength = 1, confidence?: number): Signal {
  // Signal contract: BUY → strength ≥ 0, SELL → strength ≤ 0, HOLD → strength = 0
  const signedStrength = side === "SELL" ? -strength : side === "HOLD" ? 0 : strength;
  return confidence !== undefined
    ? { side, strength: signedStrength, confidence }
    : { side, strength: signedStrength };
}

function vote(
  id: string,
  w: number,
  s: Signal,
): ComponentVote {
  return buildComponentVote(id, w, s);
}

describe("WeightedCombiner — pure aggregation", () => {
  describe("all BUY signals", () => {
    it("BUY + BUY → BUY with correct strength", () => {
      // 50/50 blend of two BUY signals, both strength 1
      const votes = [
        vote("strategy.ma", 0.5, sig("BUY", 1)),
        vote("strategy.rsi", 0.5, sig("BUY", 1)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("BUY");
      expect(result.strength).toBeCloseTo(1, 5);
    });

    it("BUY + HOLD → BUY (HOLD contributes 0)", () => {
      const votes = [
        vote("strategy.ma", 0.5, sig("BUY", 1)),
        vote("strategy.rsi", 0.5, sig("HOLD", 0)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("BUY");
      expect(result.strength).toBeCloseTo(0.5, 5);
    });

    it("BUY + BUY (different strengths) → BUY with weighted average", () => {
      const votes = [
        vote("strategy.ma", 0.3, sig("BUY", 1)),
        vote("strategy.rsi", 0.7, sig("BUY", 0.5)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("BUY");
      // weightedScore = 0.3*1 + 0.7*0.5 = 0.65
      expect(result.strength).toBeCloseTo(0.65, 5);
    });
  });

  describe("all SELL signals", () => {
    it("SELL + SELL → SELL with correct strength", () => {
      const votes = [
        vote("strategy.ma", 0.5, sig("SELL", 1)),
        vote("strategy.rsi", 0.5, sig("SELL", 1)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("SELL");
      expect(result.strength).toBeCloseTo(-1, 5);
    });

    it("SELL + HOLD → SELL (HOLD contributes 0)", () => {
      const votes = [
        vote("strategy.ma", 0.5, sig("SELL", 1)),
        vote("strategy.rsi", 0.5, sig("HOLD", 0)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("SELL");
      expect(result.strength).toBeCloseTo(-0.5, 5);
    });
  });

  describe("mixed BUY / SELL signals", () => {
    it("BUY + SELL with equal weight → HOLD (cancels out)", () => {
      const votes = [
        vote("strategy.ma", 0.5, sig("BUY", 1)),
        vote("strategy.rsi", 0.5, sig("SELL", 1)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("HOLD");
      expect(result.strength).toBeCloseTo(0, 5);
    });

    it("BUY dominant (0.75) + SELL (0.25) → BUY", () => {
      const votes = [
        vote("strategy.ma", 0.75, sig("BUY", 1)),
        vote("strategy.rsi", 0.25, sig("SELL", 1)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("BUY");
      // score = 0.75*1 + 0.25*(-1) = 0.5
      expect(result.strength).toBeCloseTo(0.5, 5);
    });

    it("SELL dominant (0.8) + BUY (0.2) → SELL", () => {
      const votes = [
        vote("strategy.ma", 0.8, sig("SELL", 1)),
        vote("strategy.rsi", 0.2, sig("BUY", 1)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("SELL");
      // score = 0.8*(-1) + 0.2*1 = -0.6
      expect(result.strength).toBeCloseTo(-0.6, 5);
    });

    it("BUY (partial strength) + SELL (partial strength) → HOLD", () => {
      const votes = [
        vote("strategy.ma", 0.5, sig("BUY", 0.6)),
        vote("strategy.rsi", 0.5, sig("SELL", 0.6)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("HOLD");
      // score = 0.5*0.6 + 0.5*(-0.6) = 0
      expect(result.strength).toBeCloseTo(0, 5);
    });
  });

  describe("all HOLD signals", () => {
    it("HOLD + HOLD + HOLD → HOLD, strength 0", () => {
      const votes = [
        vote("strategy.ma", 0.33, sig("HOLD", 0)),
        vote("strategy.rsi", 0.33, sig("HOLD", 0)),
        vote("strategy.bollinger", 0.34, sig("HOLD", 0)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.side).toBe("HOLD");
      expect(result.strength).toBe(0);
    });
  });

  describe("confidence aggregation", () => {
    it("computes weighted average confidence when all components report it", () => {
      const votes = [
        vote("strategy.ma", 0.4, sig("BUY", 1, 0.8)),
        vote("strategy.rsi", 0.6, sig("BUY", 1, 0.5)),
      ];
      const result = combineComponentVotes(votes, 1);
      // confidence = 0.4*0.8 + 0.6*0.5 = 0.62
      expect(result.confidence).toBeCloseTo(0.62, 5);
    });

    it("returns undefined confidence when no component reports it", () => {
      const votes = [
        vote("strategy.ma", 0.5, sig("BUY", 1)),
        vote("strategy.rsi", 0.5, sig("BUY", 1)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.confidence).toBeUndefined();
    });

    it("uses only components with confidence for average (ignores those without)", () => {
      const votes = [
        vote("strategy.ma", 0.9, sig("BUY", 1)), // no confidence
        vote("strategy.rsi", 0.1, sig("BUY", 1, 1)), // has confidence
      ];
      const result = combineComponentVotes(votes, 1);
      // Only the 0.1 weight component contributes to confidence avg
      // weightedConfidenceSum = 0.1*1 = 0.1, confidenceWeightSum = 0.1
      expect(result.confidence).toBeCloseTo(1, 5);
    });
  });

  describe("normalisation", () => {
    it("correctly normalises non-unit raw weights", () => {
      // raw weights sum to 10, not 1
      const votes = [
        vote("strategy.ma", 4, sig("BUY", 1)),
        vote("strategy.rsi", 6, sig("BUY", 1)),
      ];
      const result = combineComponentVotes(votes, 10);
      // normWeight = 4/10, 6/10
      // weightedScore = 0.4*1 + 0.6*1 = 1.0
      expect(result.side).toBe("BUY");
      expect(result.strength).toBeCloseTo(1, 5);
      expect(result.totalWeight).toBeCloseTo(1, 5);
      expect(result.rawTotalWeight).toBe(10);
    });

    it("handles rawTotalWeight = 0 gracefully (zero votes)", () => {
      const result = combineComponentVotes([], 0);
      expect(result.side).toBe("HOLD");
      expect(result.strength).toBe(0);
      expect(result.componentCount).toBe(0);
    });
  });

  describe("metadata", () => {
    it("preserves componentVotes in metadata", () => {
      const votes = [
        vote("strategy.ma", 0.5, sig("BUY", 1, 0.8)),
        vote("strategy.rsi", 0.5, sig("SELL", 1, 0.6)),
      ];
      const result = combineComponentVotes(votes, 1);
      expect(result.componentCount).toBe(2);
      expect(result.componentVotes).toHaveLength(2);
      expect(result.componentSides).toEqual(["BUY", "SELL"]);
      const meta = result.metadata as Record<string, unknown>;
      expect(meta["componentCount"]).toBe(2);
      expect(meta["totalWeight"]).toBeCloseTo(1, 5);
    });
  });

  describe("determinism", () => {
    it("produces identical results for identical inputs", () => {
      const makeVotes = () => [
        vote("strategy.ma", 0.4, sig("BUY", 1, 0.8)),
        vote("strategy.rsi", 0.6, sig("BUY", 0.5, 0.6)),
      ];
      const r1 = combineComponentVotes(makeVotes(), 1);
      const r2 = combineComponentVotes(makeVotes(), 1);
      expect(r1.side).toBe(r2.side);
      expect(r1.strength).toBe(r2.strength);
      expect(r1.confidence).toBe(r2.confidence);
    });
  });
});
