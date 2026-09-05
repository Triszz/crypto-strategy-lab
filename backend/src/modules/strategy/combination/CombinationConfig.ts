/**
 * strategy · combination · CombinationConfig
 *
 * Domain types for declaring a combination of strategies. These types
 * are the PURE domain representation of what the Prisma
 * `CompositeComponent` table holds in the infrastructure layer.
 *
 * The Combination domain reads these types; infrastructure layers map
 * Prisma rows → these types. The combination domain itself never
 * imports Prisma.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
import type { StrategyParameters } from "../domain/StrategyContext";
import { getStrategyRegistry } from "../domain/StrategyRegistry";

/**
 * Combination operator — determines how child strategy signals are aggregated.
 *
 *  - MAJORITY_VOTE: Most votes win. Deterministic tie-break → HOLD.
 *  - WEIGHTED:     Signal-weighted sum. Weights are normalised at combine time.
 */
export enum CombinationOperator {
  MAJORITY_VOTE = "MAJORITY_VOTE",
  WEIGHTED = "WEIGHTED",
}

/**
 * A single strategy participant inside a combination. Corresponds to one
 * `CompositeComponent` row in the database.
 *
 * The `strategyId` matches `StrategyVersion.implementationRef` and is
 * used to look up the concrete Strategy via `StrategyRegistry.resolve()`.
 *
 * `parameters` are the concrete runtime parameters for this component
 * instance (can be defaults or overridden by Search). The Combination
 * domain does NOT validate individual strategy parameters — it defers to
 * `Strategy.validateParameters()` which the CombinationEngine calls
 * before analysis.
 */
export interface CombinationComponent {
  /** Stable identifier matching `StrategyVersion.implementationRef`. */
  readonly strategyId: string;
  /**
   * Fractional vote weight in `[0, 1]`. Weights are NORMALISED to sum to
   * 1.0 at CombinationEngine.run() time; the input weights need only be
   * non-negative. Decimal precision ≤ 4 decimal places is sufficient for
   * the MVP (matching Prisma `Decimal(6,4)`).
   */
  readonly weight: number;
  /**
   * Optional per-component parameter overrides. When absent the strategy's
   * `defaultParameters()` are used. Allows a combination to override e.g.
   * RSI period without editing the strategy's defaults.
   */
  readonly parameters?: StrategyParameters;
  /**
   * Execution priority. Lower numbers run earlier. The CombinationEngine
   * sorts components by `position` ascending before execution. Uniqueness
   * of position among components is validated at configuration time.
   * Maps to `CompositeComponent.position` in the database.
   */
  readonly position: number;
}

/**
 * The complete declaration of a combination. Corresponds to one
 * `StrategyVersion` of type `COMPOSITE` together with its
 * `CompositeComponent` rows.
 *
 * This is the input type for `CombinationEngine.run()` and for
 * constructing a `CompositeStrategy`.
 */
export interface CombinationConfig {
  /**
   * Stable identifier for this composite. Used as the `id` of the
   * resulting `CompositeStrategy`. Must match the database's
   * `StrategyVersion.implementationRef` for the COMPOSITE version so that
   * the runtime registry can look it up by the same string.
   *
   * Convention: `"strategy.composite.<slug>"` where `<slug>` is a
   * kebab-case descriptor, e.g. `"strategy.composite.trend-momentum"`.
   */
  readonly id: string;
  /** Human-readable name, e.g. `"Trend + Momentum Blend"`. */
  readonly name: string;
  /**
   * Ordered, non-empty list of components. The CombinationEngine sorts by
   * `position` ascending before execution; duplicate positions are a
   * validation error.
   */
  readonly components: ReadonlyArray<CombinationComponent>;
  /**
   * Signal aggregation operator. Defaults to WEIGHTED. AND and OR use
   * deterministic Boolean semantics; MAJORITY_VOTE and WEIGHTED use the
   * WeightedCombiner logic.
   */
  readonly operator: CombinationOperator;
}

/**
 * Result of validating a `CombinationConfig`. The CombinationEngine
 * ALWAYS validates before running so that malformed configurations fail
 * fast and loudly rather than producing incorrect results.
 */
export type CombinationValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/**
 * Validate a `CombinationConfig`. Returns a `CombinationValidationResult`.
 * Checks:
 *   - components is non-empty
 *   - all strategyIds are non-empty strings
 *   - all weights are non-negative finite numbers
 *   - position values are unique within the component list
 *   - strategyId deduplication: a strategy may appear at most once
 *     (prevents double-counting votes)
 *
 * NOTE: This validates the COMBINATION STRUCTURE, not the individual
 * strategy parameters. Parameter validation is the caller's (or the
 * CombinationEngine's) responsibility and is delegated to
 * `Strategy.validateParameters()` per component.
 */
export function validateCombinationConfig(
  config: CombinationConfig,
): CombinationValidationResult {
  const errors: string[] = [];

  if (!config.components || config.components.length === 0) {
    errors.push("Combination must contain at least one component.");
    return { ok: false, errors };
  }

  const seenStrategyIds = new Set<string>();
  const seenPositions = new Set<number>();

  for (let i = 0; i < config.components.length; i++) {
    const c = config.components[i]!;

    if (typeof c.strategyId !== "string" || c.strategyId.trim().length === 0) {
      errors.push(`Component[${i}]: strategyId must be a non-empty string.`);
    } else if (seenStrategyIds.has(c.strategyId)) {
      errors.push(
        `Component[${i}]: duplicate strategyId "${c.strategyId}". Each strategy may appear at most once in a combination.`,
      );
    } else {
      seenStrategyIds.add(c.strategyId);
    }

    if (typeof c.weight !== "number" || !Number.isFinite(c.weight) || c.weight < 0) {
      errors.push(
        `Component[${i}] (${c.strategyId}): weight must be a finite number ≥ 0.`,
      );
    }

    if (!Number.isInteger(c.position) || c.position < 0) {
      errors.push(
        `Component[${i}] (${c.strategyId}): position must be a non-negative integer.`,
      );
    } else if (seenPositions.has(c.position)) {
      errors.push(
        `Component[${i}] (${c.strategyId}): duplicate position ${c.position}.`,
      );
    } else {
      seenPositions.add(c.position);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Phase 3.4 — canonical, non-recursive display name for a composite.
 *
 * The previous contract let the generator pass a "human-readable" name
 * that was itself built from the parent's display name. Each iteration
 * prefixed the previous persisted name, producing strings like:
 *   "Domain-guided bollinger + rsi → Bollinger Bands + RSI (Wilder) →
 *    Bollinger Bands + RSI (Wilder) → Bollinger Bands + RSI (Wilder)"
 *
 * The fix: derive the display name strictly from the canonical
 * composite components (the `strategyId` of each component, mapped
 * through `StrategyRegistry.resolve(id)?.name` for human-readable
 * labels). Two `CombinationConfig`s with the same components yield
 * the same canonical name, regardless of how the original name was
 * built.
 *
 * Why this is safe:
 *   - The executable definition lives in `composite_components`,
 *     `parameters`, `weights`, `operator`, and `implementationRef`.
 *     The display name is purely a label.
 *   - The helper uses the live `StrategyRegistry` so it picks up
 *     human-readable strategy names ("Bollinger Bands") when present
 *     and falls back to a stripped `implementationRef` otherwise
 *     (so legacy strategies not yet registered still resolve).
 *   - Infra-free: no Prisma, no Express. Safe to call from anywhere
 *     that already imports `CombinationConfig`.
 *
 * @param config  The composite config to derive a display name for.
 * @returns       A stable, recursive-free human-readable label.
 */
export function getCanonicalCompositeDisplayName(config: CombinationConfig): string {
  if (!config || !Array.isArray(config.components) || config.components.length === 0) {
    return "Composite";
  }
  const registry = getStrategyRegistry();
  // Order by position so the label is deterministic.
  const ordered = [...config.components].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const labels = ordered.map((c) => {
    const registered = registry.resolve(c.strategyId);
    if (registered && typeof registered.name === "string" && registered.name.length > 0) {
      return registered.name;
    }
    // Fallback: strip the "strategy." prefix to surface a clean label.
    return c.strategyId.replace(/^strategy\./, "");
  });
  return `Composite · ${labels.join(" + ")}`;
}
