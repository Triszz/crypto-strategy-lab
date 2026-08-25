/**
 * search · domain · StrategyGenerator
 *
 * The core contract for all candidate generators. The SearchController calls
 * `generator.generate(onCandidate, stop)` to drive candidate generation. Each call
 * to `onCandidate` emits one `SearchCandidate` to the queue.
 *
 * Generator implementations (RandomGenerator, DomainGuidedGenerator) do NOT:
 *   - access the database
 *   - emit events
 *   - manage queues
 *   - run backtests
 *
 * They ONLY produce candidates deterministically from the declared parameter space.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no Socket.IO,
 * no Binance SDK.
 */
import type { SearchCandidate } from "./SearchCandidate";
import type { StopCondition, SearchState } from "./StopCondition";
import type { ParameterSpace } from "./ParameterSpace";

/**
 * Callback invoked by the generator for each candidate it produces.
 * The controller uses this to enqueue the candidate for backtesting.
 *
 * The callback may be synchronous (MVP generators) or asynchronous (when the
 * controller needs to await DB operations). The caller MUST check whether
 * the result is a Promise and await it appropriately.
 *
 * @param candidate  The generated `SearchCandidate`.
 * @returns `true` (or Promise resolving to `true`) to signal that the candidate
 *          was successfully queued and the generator should continue. `false`
 *          signals back-pressure — the generator SHOULD pause and retry.
 */
export type OnCandidate = (candidate: SearchCandidate) => boolean | Promise<boolean>;

/**
 * Safely invoke `onCandidate` and resolve the result. If `result` is a Promise,
 * it is awaited; otherwise the boolean is returned directly.
 */
export async function resolveOnCandidate(
  onCandidate: OnCandidate,
  candidate: SearchCandidate,
): Promise<boolean> {
  const result = onCandidate(candidate);
  return result instanceof Promise ? result : result;
}

/**
 * Generator configuration shared by all generators. Passed to the constructor
 * so that the controller can configure the generator before calling `generate()`.
 */
export interface GeneratorConfig {
  /** Maximum candidates to generate. Maps to `SearchRun.maxCandidates`. */
  readonly maxCandidates: number;
  /**
   * The symbol to evaluate, e.g. `"BTCUSDT"`. Passed through to the candidate
   * so the Backtester knows which market data to load.
   */
  readonly symbol: string;
  /**
   * The timeframe to evaluate, e.g. `"1h"`. Maps to the backtest dataset
   * time range (the dataset itself is managed by the Backtester).
   */
  readonly timeframe: string;
  /**
   * Optional per-candidate budget in milliseconds. If provided, the generator
   * should honour it by calling `shouldStop()` after each candidate.
   */
  readonly timeBudgetMs?: number;
}

/**
 * The return value of a generator run. The controller uses this to report
 * search statistics.
 */
export interface GeneratorRunResult {
  /** Total candidates generated (including duplicates that were skipped). */
  readonly totalGenerated: number;
  /** Candidates successfully queued to the backtest queue. */
  readonly totalQueued: number;
  /** Candidates rejected as duplicates. */
  readonly totalRejected: number;
  /** Whether the generator stopped because `shouldStop()` returned `true`. */
  readonly stoppedByCondition: boolean;
  /** Whether the generator stopped because the queue signalled back-pressure. */
  readonly stoppedByBackPressure: boolean;
  /** Wall-clock milliseconds spent generating. */
  readonly generationMs: number;
}

/**
 * Result of a single `generate()` call. Indicates whether generation should
 * continue or stop.
 */
export type GenerateResult =
  | { readonly done: true; readonly result: GeneratorRunResult }
  | { readonly done: false };

/**
 * The generator interface. Both RandomGenerator and DomainGuidedGenerator
 * implement this contract.
 *
 * The SearchController drives the generator by calling `generate()` once
 * and passing callbacks/state. The generator itself is a push-based iterator:
 * it calls `onCandidate` for each candidate and checks `shouldStop(state)`
 * after each one.
 *
 * The generator is responsible for:
 *   - Producing deterministic candidates from the declared `ParameterSpace[]`
 *   - Deduplicating candidates within the same search run (BR-019)
 *   - Respecting `maxCandidates`
 *
 * The controller is responsible for:
 *   - Enqueuing candidates via `onCandidate`
 *   - Tracking statistics to build `SearchState`
 *   - Calling `shouldStop()` after each candidate
 *   - Deciding when to stop
 *
 * Note: `generate()` is async to support both synchronous generators (MVP)
 * and future async generators that need DB-backed deduplication or I/O.
 */
export interface StrategyGenerator {
  /**
   * Human-readable name of this generator, e.g. `"Random Search"` or
   * `"Domain-guided Search"`.
   */
  readonly name: string;

  /**
   * The parameter spaces this generator will explore. One space per BASE
   * strategy being searched (COMPOSITE candidates are assembled from the
   * same spaces by the DomainGuidedGenerator).
   *
   * Set by the controller before calling `generate()`.
   */
  spaces: ReadonlyArray<ParameterSpace>;

  /**
   * Generate candidates and emit them via `onCandidate`. The generator
   * checks `shouldStop()` after each candidate; if it returns `true`,
   * generation stops immediately.
   *
   * The generator MUST call `shouldStop()` at least once after each
   * candidate and MUST stop when it returns `true`.
   *
   * The generator MUST deduplicate candidates using an in-memory seen-set
   * (BR-019). A duplicate candidate is skipped (not emitted) and
   * `totalRejected` is incremented.
   *
   * The generator MUST NOT call `onCandidate` more than `maxCandidates` times.
   *
   * @param onCandidate  Callback for each candidate. Returns `true` on success,
   *                     `false` on back-pressure (queue full) — generator should pause.
   * @param shouldStop   Predicate called after each candidate; if `true`, stop.
   * @param state        Mutable search state (the generator reads it to update
   *                     statistics; the controller maintains it).
   * @returns `GenerateResult.done = true` when stopped, with statistics.
   */
  generate(
    onCandidate: OnCandidate,
    shouldStop: StopCondition,
    state: SearchState,
  ): Promise<GenerateResult>;
}
