/**
 * strategy · domain · Strategy
 *
 * The single contract every concrete Strategy (BASE or COMPOSITE) MUST
 * implement. It is intentionally narrow so Search, Backtest, Evaluation
 * and Leaderboard can depend on this interface without ever needing to
 * branch on the concrete strategy class.
 *
 * Architectural invariant (from the audit):
 *   "Adding a new strategy should NOT require changes to Search, Backtest,
 *    Evaluation, Leaderboard, or Market Data."
 *
 * Concretely, this means the Strategy contract must expose *all* the
 * information those modules need:
 *   - `id` + `implementationRef` so the runtime registry can resolve it,
 *   - `family` so taxonomy is observable without instanceof checks,
 *   - `parameterSpec` + `defaultParameters` + `validateParameters` so
 *     Search can generate candidates and Backtest can instantiate safely,
 *   - `requiredHistory` so Backtest reserves warm-up candles,
 *   - `supportedTimeframes?` so Backtest rejects incompatible timeframes,
 *   - `analyze(ctx)` so Backtest / LiveRunner can drive the strategy
 *     per candle and receive a pure `Signal`.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
import type { ParamSpec, ValidationResult } from "./ParamSpec";
import type { Signal } from "./Signal";
import type {
  StrategyContext,
  StrategyFamily,
  StrategyTimeframe,
  StrategyParameters,
} from "./StrategyContext";

export interface Strategy {
  /**
   * Stable, short identifier used by the runtime registry and by the
   * database's `StrategyVersion.implementationRef`. MUST be globally
   * unique. Lowercase + dots recommended (e.g. `"strategy.ma"`,
   * `"strategy.rsi"`).
   */
  readonly id: string;

  /** Human-readable name, e.g. `"Moving Average Crossover"`. */
  readonly name: string;

  /** Taxonomy family (TREND / MOMENTUM / STRUCTURE / VOLATILITY / SENTIMENT). */
  readonly family: StrategyFamily;

  /** Short description for UI listings. Optional. */
  readonly description?: string;

  /**
   * Optional whitelist of timeframes this strategy supports. When
   * absent, the strategy is assumed to work on all supported timeframes.
   */
  readonly supportedTimeframes?: ReadonlyArray<StrategyTimeframe>;

  /**
   * Minimum candle count `StrategyContext.history` MUST contain before
   * `analyze(ctx)` returns a meaningful Signal. Backtest reserves
   * `requiredHistory` warm-up candles before the first `analyze` call.
   */
  readonly requiredHistory: number;

  /** Declarative parameter schema (see `./ParamSpec`). */
  readonly parameterSpec: ParamSpec;

  /**
   * Canonical baseline parameters. Used by Search as the seed for
   * parameter generation and by Backtest when no override is supplied.
   */
  defaultParameters(): StrategyParameters;

  /**
   * Authoritative parameter validation. Backtest calls this once before
   * iterating; Search calls this before persisting a CandidateStrategy.
   * MUST throw or return `{ ok: false, errors }` on invalid input.
   */
  validateParameters(parameters: unknown): ValidationResult;

  /**
   * Produce a Signal for the candle in `ctx`. MUST be a pure function:
   * same `(ctx, parameters)` ⇒ same `Signal`. MUST NOT publish events,
   * mutate state, or perform I/O.
   */
  analyze(ctx: StrategyContext): Signal;
}