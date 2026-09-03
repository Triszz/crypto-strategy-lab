/**
 * strategy · combination · WeightedCombiner
 *
 * Aggregation engine for Strategy Combination. Given a list of component
 * signals and their raw weights, produces a deterministic `CompositeSignal`.
 *
 * Two operators are supported:
 *
 *   - WEIGHTED:       score = Σ (normWeight_i × signal.strength_i)
 *                     side   = sign(score)
 *                     strength = clamp(score, -1, 1)
 *                     confidence = weighted avg of confidences
 *
 *   - MAJORITY_VOTE:  Each vote contributes its side as a weighted mass.
 *                     buyMass  = Σ (normWeight_i × 1[side=BUY])
 *                     sellMass = Σ (normWeight_i × 1[side=SELL])
 *                     side = argmax(buyMass, sellMass); tie → HOLD
 *                     strength = |buyMass - sellMass|
 *                     confidence = share of winning mass
 *
 * Per project specification, BUY=+1, HOLD=0, SELL=-1 at the signal level.
 *
 * This module is intentionally a pure function (no I/O, no state). It is
 * the core of the CombinationEngine and can also be unit-tested in
 * isolation with static signal fixtures.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
import type { Signal } from "../domain/Signal";
import type { ComponentVote, CompositeSignal } from "./CompositeSignal";
import { combineComponentVotes } from "./CompositeSignal";

export {
  combineComponentVotes,
  combineWeighted,
  combineMajorityVote,
} from "./CompositeSignal";
export type { ComponentVote, CompositeSignal } from "./CompositeSignal";

/**
 * Build a `ComponentVote` from a component description and its signal.
 * This is a pure data-transformation; it performs no I/O.
 *
 * @param strategyId  Matches `CombinationComponent.strategyId`.
 * @param weight     The raw (un-normalised) weight from the config.
 * @param signal     The output of `strategy.analyze(ctx)`.
 */
export function buildComponentVote(
  strategyId: string,
  weight: number,
  signal: Signal,
): ComponentVote {
  return Object.freeze({
    strategyId,
    signal,
    weight,
    rawWeight: weight,
  });
}

/**
 * Convenience wrapper: given votes + raw total weight + operator, returns
 * the combined CompositeSignal. The bulk of the logic lives in
 * `combineComponentVotes` (in `CompositeSignal.ts`).
 */
export function combine(
  votes: ReadonlyArray<ComponentVote>,
  rawTotalWeight: number,
  operator: "WEIGHTED" | "MAJORITY_VOTE",
): CompositeSignal {
  return combineComponentVotes(votes, rawTotalWeight, operator);
}
