/**
 * strategy · combination · WeightedCombiner
 *
 * Pure weighted-vote aggregation engine. Given a list of component signals
 * and their raw weights, produces a deterministic `CompositeSignal`.
 *
 * This class is intentionally a pure function (no I/O, no state). It is
 * the core of the CombinationEngine and can also be unit-tested in
 * isolation with static signal fixtures.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 *
 * ---
 * Aggregation rule (MVP):
 *
 *   rawTotalWeight = Σ rawWeight_i
 *   normWeight_i   = rawWeight_i / rawTotalWeight
 *
 *   weightedScore  = Σ (normWeight_i × signal.strength_i)
 *   side          = BUY if weightedScore > 0
 *                  = SELL if weightedScore < 0
 *                  = HOLD if weightedScore = 0
 *   strength      = clamp(weightedScore, -1, 1)  [always true when weights sum to 1 and strengths ∈ [-1,1]]
 *   confidence    = Σ (normWeight_i × confidence_i) / Σ normWeight_i
 *                  (only over components with confidence defined; undefined if none)
 *
 * The Backtester consumes `CompositeSignal` through the normal `Signal`
 * interface fields (`side`, `strength`, `confidence`, `reason`,
 * `metadata`). The additional `componentVotes` field lets it audit
 * individual votes without breaking the abstraction.
 */
import type { Signal } from "../domain/Signal";
import type { ComponentVote } from "./CompositeSignal";

export { combineComponentVotes } from "./CompositeSignal";
export type { ComponentVote } from "./CompositeSignal";
// Re-export CompositeSignal for convenience so callers can import from WeightedCombiner too.
export type { CompositeSignal } from "./CompositeSignal";

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
