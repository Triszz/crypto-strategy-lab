/**
 * strategy · combination · CompositeSignal
 *
 * The output of `WeightedCombiner.combine()`. It extends the base `Signal`
 * with combination-specific metadata so that the Backtester / Evaluation
 * layer can understand WHY the composite produced its decision.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
import type { Signal, SignalSide } from "../domain/Signal";

/**
 * The voting contribution of ONE component strategy inside a combination.
 * Exposed in `CompositeSignal.componentVotes` so the Backtester can audit
 * individual votes and Evaluation can weight by confidence.
 */
export interface ComponentVote {
  /** Matches `CombinationComponent.strategyId`. */
  readonly strategyId: string;
  /** The raw signal emitted by this component. */
  readonly signal: Signal;
  /** The weight used (after normalisation). */
  readonly weight: number;
  /** The raw (un-normalised) weight from the config. */
  readonly rawWeight: number;
}

/**
 * The aggregated signal returned by `WeightedCombiner.combine()`. It
 * satisfies the `Signal` contract (has `side`, `strength`, `confidence`,
 * `reason`, `metadata`) so it can be consumed by the Backtester without
 * special-casing. It additionally carries `componentVotes` so the caller can
 * audit or log individual votes.
 *
 * Aggregation rule (MVP — documented so it is stable):
 *   - weightedScore = Σ (weight_i × strength_i)  for all i
 *   - side          = sign(weightedScore)  →  BUY (> 0), SELL (< 0), HOLD (= 0)
 *   - strength      = weightedScore  (already bounded to [-1, 1] when weights are normalised and strengths ∈ [-1, 1])
 *   - confidence    = Σ (weight_i × confidence_i) / Σ weight_i
 *                     (confidence_i = 0 when absent; normalises to [0, 1])
 *   - reason        = "Composite: BUY/SELL/HOLD — [N×BUY, M×SELL, K×HOLD]"
 *   - metadata.componentVotes = array of ComponentVotes
 */
export interface CompositeSignal extends Signal {
  /**
   * The number of component strategies that contributed to this result.
   * Used by Backtester for audit logging.
   */
  readonly componentCount: number;
  /** The sum of all normalised weights (always 1.0 for a valid combination). */
  readonly totalWeight: number;
  /** The raw un-normalised sum of weights (before normalisation). */
  readonly rawTotalWeight: number;
  /**
   * Per-component votes, sorted by `CombinationComponent.position` ascending.
   * The Backtester can iterate these to log or display individual votes.
   */
  readonly componentVotes: ReadonlyArray<ComponentVote>;
  /** Human-readable list of component sides for the reason string. */
  readonly componentSides: ReadonlyArray<string>;
}

/**
 * Format a list of signal sides into a human-readable string, e.g.
 * "2×BUY, 1×SELL". Used only to build the `reason` field.
 */
function formatSides(sides: ReadonlyArray<SignalSide>): string {
  const counts: Record<string, number> = {};
  for (const s of sides) {
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${v}×${k}`)
    .join(", ");
}

/**
 * Combine an ordered list of component votes into a `CompositeSignal`
 * using the WEIGHTED aggregation rule.
 *
 * Weights are normalised to sum to 1.0. A component whose strategy
 * returns `HOLD` contributes 0 to both the numerator and denominator of
 * the confidence average, effectively reducing the denominator to the sum
 * of weights of non-HOLD components.
 *
 * @param votes  Ordered by `position` ascending. Must not be empty (callers
 *               should guard against empty arrays before calling).
 * @param rawTotalWeight  The sum of raw weights, used to normalise.
 */
export function combineWeighted(
  votes: ReadonlyArray<ComponentVote>,
  rawTotalWeight: number,
): CompositeSignal {
  if (votes.length === 0) {
    return emptyComposite(rawTotalWeight);
  }

  const norm = rawTotalWeight > 0 ? 1 / rawTotalWeight : 0;

  let weightedScore = 0;
  let weightedConfidenceSum = 0;
  let confidenceWeightSum = 0;
  const sides: SignalSide[] = [];

  for (const vote of votes) {
    const normalisedWeight = vote.weight * norm;
    weightedScore += normalisedWeight * vote.signal.strength;

    sides.push(vote.signal.side);

    if (vote.signal.confidence !== undefined) {
      weightedConfidenceSum += normalisedWeight * vote.signal.confidence;
      confidenceWeightSum += normalisedWeight;
    }
  }

  const rawScore = weightedScore;
  const finalSide: SignalSide =
    rawScore > 0 ? "BUY" : rawScore < 0 ? "SELL" : "HOLD";

  const confidence =
    confidenceWeightSum > 0 ? weightedConfidenceSum / confidenceWeightSum : undefined;

  const sideStr = formatSides(sides);

  return {
    side: finalSide,
    strength: Math.max(-1, Math.min(1, rawScore)),
    confidence,
    reason: `Composite (weighted): ${finalSide} — [${sideStr}]`,
    metadata: {
      componentCount: votes.length,
      totalWeight: norm > 0 ? 1 : 0,
      rawTotalWeight,
      componentVotes: votes,
      componentSides: sides,
    },
    componentCount: votes.length,
    totalWeight: norm > 0 ? 1 : 0,
    rawTotalWeight,
    componentVotes: votes,
    componentSides: sides,
  };
}

/**
 * Combine an ordered list of component votes into a `CompositeSignal`
 * using the MAJORITY_VOTE aggregation rule.
 *
 * Algorithm:
 *   - Treat each vote's `side` as a single vote with magnitude proportional
 *     to its weight (normalised against `rawTotalWeight`).
 *   - Sum the BUY mass and SELL mass. HOLD contributes 0 mass.
 *   - The side with strictly larger mass wins. Ties (including all-HOLD)
 *     resolve to HOLD deterministically.
 *
 * The final `strength` reflects the majority margin (clamped to [-1, 1])
 * and is therefore weaker than a unanimous vote and stronger than a bare
 * majority. `confidence` is the share of weight that participated in the
 * winning side, in [0, 1].
 *
 * Per project requirements:
 *   BUY  = +1, HOLD =  0, SELL = -1
 *
 * @param votes            Ordered by `position` ascending.
 * @param rawTotalWeight   Sum of raw weights, used for normalisation.
 */
export function combineMajorityVote(
  votes: ReadonlyArray<ComponentVote>,
  rawTotalWeight: number,
): CompositeSignal {
  if (votes.length === 0) {
    return emptyComposite(rawTotalWeight);
  }

  const norm = rawTotalWeight > 0 ? 1 / rawTotalWeight : 0;
  const sides: SignalSide[] = [];

  let buyMass = 0;
  let sellMass = 0;
  let weightedConfidenceSum = 0;
  let confidenceWeightSum = 0;

  for (const vote of votes) {
    const normalisedWeight = vote.weight * norm;
    sides.push(vote.signal.side);

    if (vote.signal.side === "BUY") buyMass += normalisedWeight;
    else if (vote.signal.side === "SELL") sellMass += normalisedWeight;
    // HOLD contributes 0 mass.

    if (vote.signal.confidence !== undefined) {
      weightedConfidenceSum += normalisedWeight * vote.signal.confidence;
      confidenceWeightSum += normalisedWeight;
    }
  }

  // Deterministic tie → HOLD.
  let finalSide: SignalSide;
  let strength: number;
  if (buyMass > sellMass) {
    finalSide = "BUY";
    strength = buyMass - sellMass; // ∈ (0, 1]
  } else if (sellMass > buyMass) {
    finalSide = "SELL";
    strength = -(sellMass - buyMass); // ∈ [-1, 0)
  } else {
    finalSide = "HOLD";
    strength = 0;
  }

  // Confidence: share of weight that agreed with the winning side
  // (0 for HOLD tie).
  const winningMass = finalSide === "BUY" ? buyMass : finalSide === "SELL" ? sellMass : 0;
  const confidence = confidenceWeightSum > 0
    ? Math.min(1, weightedConfidenceSum / confidenceWeightSum) * (winningMass > 0 ? 1 : 0)
    : undefined;

  const sideStr = formatSides(sides);

  return {
    side: finalSide,
    strength: Math.max(-1, Math.min(1, strength)),
    confidence,
    reason: `Composite (majority): ${finalSide} — [${sideStr}]`,
    metadata: {
      componentCount: votes.length,
      totalWeight: norm > 0 ? 1 : 0,
      rawTotalWeight,
      componentVotes: votes,
      componentSides: sides,
    },
    componentCount: votes.length,
    totalWeight: norm > 0 ? 1 : 0,
    rawTotalWeight,
    componentVotes: votes,
    componentSides: sides,
  };
}

function emptyComposite(rawTotalWeight: number): CompositeSignal {
  return {
    side: "HOLD",
    strength: 0,
    confidence: undefined,
    reason: "Composite: no components",
    metadata: { componentCount: 0, totalWeight: 0, componentVotes: [] },
    componentCount: 0,
    totalWeight: 0,
    rawTotalWeight,
    componentVotes: [],
    componentSides: [],
  };
}

/**
 * Combine an ordered list of component votes into a `CompositeSignal`.
 * Dispatched by operator. Backwards-compatible default: WEIGHTED.
 */
export function combineComponentVotes(
  votes: ReadonlyArray<ComponentVote>,
  rawTotalWeight: number,
  operator: "WEIGHTED" | "MAJORITY_VOTE" = "WEIGHTED",
): CompositeSignal {
  if (operator === "MAJORITY_VOTE") {
    return combineMajorityVote(votes, rawTotalWeight);
  }
  return combineWeighted(votes, rawTotalWeight);
}
