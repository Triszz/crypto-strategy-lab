/**
 * strategy · combination · CombinationEngine
 *
 * The orchestration layer that:
 *   1. Validates a `CombinationConfig`.
 *   2. Resolves each `strategyId` → concrete `Strategy` via the runtime
 *      `StrategyRegistry`.
 *   3. Validates per-component parameter overrides (delegated to each
 *      Strategy's `validateParameters()`).
 *   4. Executes every component strategy against the same `StrategyContext`.
 *   5. Aggregates the resulting `Signal`s via `WeightedCombiner`.
 *
 * The engine is a pure orchestrator: it contains no combination logic
 * itself (that lives in `WeightedCombiner`) and no I/O.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK. It DOES depend on `StrategyRegistry` from
 * the sibling domain layer, which is a pure in-memory map — not a Prisma
 * model.
 *
 * Architectural note: the engine resolves strategy ids through the
 * *runtime* `StrategyRegistry`. The Prisma `StrategyRegistry` table is a
 * separate feature-flag table managed by a future administration module.
 * These two registries are intentionally distinct.
 */
import type { StrategyRegistry } from "../domain/StrategyRegistry";
import type { StrategyContext } from "../domain/StrategyContext";
import {
  type CombinationConfig,
  validateCombinationConfig,
} from "./CombinationConfig";
import { type CompositeSignal, type ComponentVote } from "./CompositeSignal";
import { combineComponentVotes, buildComponentVote } from "./WeightedCombiner";

/**
 * Error thrown (not returned) when the engine encounters an unrecoverable
 * structural problem that was not caught by `validateCombinationConfig`.
 * Callers should catch this and surface it as a user-visible validation
 * failure rather than a crash.
 */
export class CombinationError extends Error {
  public readonly errors: ReadonlyArray<string>;

  constructor(message: string, errors: ReadonlyArray<string>) {
    super(message);
    this.name = "CombinationError";
    this.errors = errors;
    Object.setPrototypeOf(this, CombinationError.prototype);
  }
}

/**
 * Result of one failed component during `run()`. Carried in the
 * `ComponentError` thrown from `run()` so the caller can distinguish
 * individual failures from structural ones.
 */
export interface ComponentFailure {
  readonly strategyId: string;
  readonly reason: string;
}

function formatErrors(prefix: string, errors: ReadonlyArray<string>): string {
  return `${prefix}:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
}

/**
 * The CombinationEngine. Instantiate with a `StrategyRegistry` (typically
 * `getStrategyRegistry()` from the domain layer).
 *
 * Usage:
 *   const engine = new CombinationEngine(registry);
 *   const signal = engine.run(config, ctx);
 *
 * Throws `CombinationError` on structural failures (unknown strategy,
 * parameter validation failure, empty result) before returning.
 */
export class CombinationEngine {
  public readonly registry: StrategyRegistry;

  public constructor(registry: StrategyRegistry) {
    this.registry = registry;
  }

  /** Forwarded from `StrategyRegistry.resolve()` so callers don't need the registry directly. */
  public resolve(strategyId: string) {
    return this.registry.resolve(strategyId);
  }

  /**
   * Run the combination over a single candle context.
   *
   * @param config  The combination configuration. Must pass
   *                `validateCombinationConfig()` first for fast-fail.
   * @param ctx     The StrategyContext shared by all components.
   *
   * @throws CombinationError  If a strategy id is unknown, parameter
   *                          validation fails, or the combination produces
   *                          no component votes (should be impossible after
   *                          config validation).
   *
   * @returns A `CompositeSignal`. The `side`, `strength`, `confidence`,
   *          `reason`, `metadata` fields satisfy the `Signal` contract so
   *          the Backtester can treat it as a plain signal.
   */
  public run(config: CombinationConfig, ctx: StrategyContext): CompositeSignal {
    const structural = validateCombinationConfig(config);
    if (!structural.ok) {
      throw new CombinationError(
        formatErrors("CombinationConfig is structurally invalid", structural.errors),
        structural.errors,
      );
    }

    // Sort components by position ascending (deterministic execution order).
    const sorted = [...config.components].sort(
      (a, b) => a.position - b.position,
    );

    const votes: ComponentVote[] = [];
    const failures: ComponentFailure[] = [];

    for (const component of sorted) {
      const strategy = this.registry.resolve(component.strategyId);
      if (!strategy) {
        failures.push({
          strategyId: component.strategyId,
          reason: `Unknown strategy id "${component.strategyId}" — not registered.`,
        });
        continue;
      }

      // Use override parameters if provided, otherwise strategy defaults.
      const params =
        component.parameters !== undefined
          ? component.parameters
          : strategy.defaultParameters();

      // Validate component parameters.
      const validation = strategy.validateParameters(params);
      if (!validation.ok) {
        failures.push({
          strategyId: component.strategyId,
          reason: `Parameter validation failed: ${validation.errors.join("; ")}`,
        });
        continue;
      }

      // Build a per-component context with the resolved parameters.
      // We re-use the same candle/history but inject the component's parameters.
      const componentCtx: StrategyContext = {
        ...ctx,
        parameters: params,
      };

      const signal = strategy.analyze(componentCtx);
      votes.push(buildComponentVote(component.strategyId, component.weight, signal));
    }

    if (failures.length > 0) {
      throw new CombinationError(
        `${failures.length} component(s) failed:\n${failures
          .map((f) => `  - [${f.strategyId}] ${f.reason}`)
          .join("\n")}`,
        failures.map((f) => `[${f.strategyId}] ${f.reason}`),
      );
    }

    if (votes.length === 0) {
      throw new CombinationError(
        "Combination produced no component votes (all components failed).",
        ["No valid votes after processing all components."],
      );
    }

    const rawTotalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
    return combineComponentVotes(votes, rawTotalWeight);
  }
}
