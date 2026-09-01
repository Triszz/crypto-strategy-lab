/**
 * search · domain · SearchCandidate
 *
 * The domain representation of a Candidate Strategy. This is the pure output of
 * a `StrategyGenerator` — a candidate configuration ready to be persisted as a
 * `CandidateStrategy` row and passed to the Backtester.
 *
 * A `SearchCandidate` carries either:
 *   - BASE:   `strategyId` + `parameters`
 *   - COMPOSITE: `combinationConfig` (from the Combination layer)
 *
 * The Backtester (not part of this domain) is responsible for turning a
 * `SearchCandidate` into an Experiment with trades.
 *
 * Architectural note: `SearchCandidate` does NOT contain a row id, search run id,
 * or status. Those are database/persistence concerns. The Search domain produces
 * candidates; a separate persistence layer maps them to `CandidateStrategy` rows.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no Socket.IO,
 * no Binance SDK.
 */
import type { StrategyParameters } from "../../strategy/domain/StrategyContext";
import type { CombinationConfig } from "../../strategy/combination/CombinationConfig";

/**
 * Discriminator for the two candidate types.
 */
export type CandidateType = "BASE" | "COMPOSITE";

/**
 * A BASE strategy candidate: a specific strategy implementation with a concrete
 * parameter set to be tested.
 */
export interface BaseCandidate {
  readonly candidateType: "BASE";
  /**
   * Unique within a SearchRun. Not a database id — a local index used for
   * deduplication (BR-019).
   */
  readonly candidateId: string;
  /** The `Strategy.id` / `implementationRef` to resolve via `StrategyRegistry`. */
  readonly strategyId: string;
  /** Concrete parameter values for this strategy instance. */
  readonly parameters: StrategyParameters;
}

/**
 * A COMPOSITE strategy candidate: a `CombinationConfig` that specifies multiple
 * component strategies with weights. The Backtester will construct a
 * `CompositeStrategy` and call `analyze()` per candle.
 */
export interface CompositeCandidate {
  readonly candidateType: "COMPOSITE";
  readonly candidateId: string;
  /** The complete combination configuration. */
  readonly config: CombinationConfig;
}

/** A candidate produced by a StrategyGenerator. */
export type SearchCandidate = BaseCandidate | CompositeCandidate;

/**
 * Unique candidate identifier within a search run. Format: `<searchRunIndex>_<candidateIndex>`.
 * Used for deduplication (BR-019: "Each Candidate Strategy must be assigned a unique
 * Candidate ID").
 */
export function formatCandidateId(searchIndex: number, candidateIndex: number): string {
  return `${searchIndex}_${candidateIndex}`;
}
