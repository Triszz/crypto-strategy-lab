/**
 * search · domain · StopCondition
 *
 * The stop-condition predicate evaluated after each candidate is generated.
 * A search run terminates when `shouldStop(state)` returns `true`.
 *
 * This is the domain representation of BR-018:
 *   "Search must stop when maxCandidates is reached OR the user stops it."
 *
 * The `UserStop` case is handled by the `SearchController` (orchestration layer)
 * cancelling the generator loop; `shouldStop()` models the data-driven condition.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no Socket.IO,
 * no Binance SDK.
 */

/**
 * The mutable state snapshot the `StopCondition` reads to make its decision.
 * Both the controller and the generator may mutate this object.
 * The controller passes the same object reference to `generate()` so the generator
 * can update statistics in-place after each candidate.
 */
export interface SearchState {
  /** How many candidates have been generated so far (may be updated by generator). */
  generatedCount: number;
  /** How many candidates have been sent to the backtest queue so far. */
  queuedCount: number;
  /** How many candidates have been rejected (duplicate / invalid). */
  rejectedCount: number;
  /** Total wall-clock milliseconds elapsed since the search started. */
  elapsedMs: number;
}

/**
 * The reason a search stopped. Used for audit logs and UI.
 */
export type StopReason =
  /** All `maxCandidates` have been generated and queued. */
  | { readonly type: "MAX_CANDIDATES" }
  /** Wall-clock time budget exhausted. */
  | { readonly type: "TIME_BUDGET_EXCEEDED"; readonly limitMs: number }
  /** The orchestrator cancelled the generator. */
  | { readonly type: "USER_STOPPED" };

/**
 * A stop-condition predicate. Given the current `SearchState`, returns `true`
 * if the search should terminate now.
 *
 * Implementations must be pure functions: same `SearchState` ⇒ same result.
 */
export type StopCondition = (state: SearchState) => boolean;

/**
 * Built-in stop condition: stop when `generatedCount >= maxCandidates`.
 * Implements BR-018 (maxCandidates branch).
 */
export function maxCandidatesStopCondition(maxCandidates: number): StopCondition {
  return (state) => state.generatedCount >= maxCandidates;
}

/**
 * Built-in stop condition: stop when wall-clock time budget is exceeded.
 */
export function timeBudgetStopCondition(limitMs: number): StopCondition {
  return (state) => state.elapsedMs >= limitMs;
}

/**
 * Combined stop condition: stop when ANY of the provided conditions is true.
 */
export function anyStopCondition(
  conditions: ReadonlyArray<StopCondition>,
): StopCondition {
  return (state: SearchState): boolean => {
    for (let i = 0; i < conditions.length; i++) {
      if (conditions[i]!(state)) return true;
    }
    return false;
  };
}
