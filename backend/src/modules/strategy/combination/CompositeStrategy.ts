/**
 * strategy · combination · CompositeStrategy
 *
 * A concrete `Strategy` that wraps a `CombinationConfig` and a
 * `CombinationEngine`. It satisfies the `Strategy` interface so the
 * Backtester / Evaluation layer can call `composite.analyze(ctx)` without
 * knowing whether it is a BASE or COMPOSITE strategy — they are both just
 * `Strategy`.
 *
 * The composite's `requiredHistory` is the MAXIMUM `requiredHistory` of its
 * components, ensuring all child strategies have enough warm-up candles.
 *
 * The composite's `parameterSpec` exposes the *combination configuration*
 * parameters (`components`): Search can use this to mutate weights and
 * component selection. Note: the `paramSpec` for a composite strategy is
 * necessarily more complex than a BASE strategy's because it must describe
 * the array of component overrides. For the MVP we expose it as a JSON
 * blob field; a future UI can render it as a component list editor.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
import type { Strategy } from "../domain/Strategy";
import type {
  ParamSpec,
  ValidationResult,
} from "../domain/ParamSpec";
import type {
  StrategyContext,
  StrategyParameters,
  StrategyFamily,
  StrategyTimeframe,
} from "../domain/StrategyContext";
import type { CompositeSignal } from "./CompositeSignal";
import type { CombinationConfig } from "./CombinationConfig";
import { CombinationEngine } from "./CombinationEngine";

/**
 * Synthetic `ParamSpec` for a composite strategy. It exposes the component
 * list as a JSON-encoded field so Search can mutate it generically. The
 * concrete schema of each component's parameters is defined by the child
 * strategy's own `ParamSpec`.
 *
 * MVP approach: one opaque JSON field `"components"` containing the full
 * `CombinationComponent[]` array. Future refinement can expose individual
 * weight fields per component if the UI supports it.
 */
function buildCompositeParamSpec(): ParamSpec {
  return {
    fields: [
      {
        key: "components",
        kind: "enum",
        enumValues: ["__composite_config__"],
        default: "__composite_config__",
        description:
          "JSON-encoded combination component configuration. WARNING: do not edit manually.",
      },
    ],
  };
}

/**
 * Build the family label for a composite strategy. The family is a
 * UNION of the component families (e.g. "TREND+MOMENTUM").
 */
function buildCompositeFamily(
  engine: CombinationEngine,
  config: CombinationConfig,
): StrategyFamily {
  const families: string[] = [];
  for (const component of config.components) {
    const strategy = engine.resolve(component.strategyId);
    if (strategy && !families.includes(strategy.family)) {
      families.push(strategy.family);
    }
  }
  return (families.join("+") || "TREND") as StrategyFamily;
}

export const COMPOSITE_STRATEGY_ID_PREFIX = "strategy.composite.";

/**
 * Returns true if the given id has the composite strategy prefix.
 */
export function isCompositeStrategyId(id: string): boolean {
  return id.startsWith(COMPOSITE_STRATEGY_ID_PREFIX);
}

/**
 * A `Strategy` whose `analyze()` delegates to a `CombinationEngine`. This
 * is the concrete implementation of the `CompositeStrategy` referenced in
 * `Solution.md`'s sequence diagram.
 *
 * Key properties:
 *   - `id` starts with `strategy.composite.` — the registry can distinguish
 *     composites from BASE strategies without instanceof checks.
 *   - `requiredHistory` = max of all components' `requiredHistory`.
 *   - `analyze()` delegates to `engine.run()` → `CompositeSignal`.
 */
export class CompositeStrategy implements Strategy {
  public readonly id: string;
  public readonly name: string;
  public readonly family: StrategyFamily;
  public readonly description: string;
  public readonly requiredHistory: number;
  public readonly parameterSpec: ParamSpec;
  public readonly supportedTimeframes?: ReadonlyArray<StrategyTimeframe>;

  private readonly engine: CombinationEngine;
  private readonly config: CombinationConfig;

  /**
   * Build a CompositeStrategy from a validated `CombinationConfig`.
   *
   * @param config     The combination configuration. MUST pass
   *                    `validateCombinationConfig()` before construction.
   * @param engine     The CombinationEngine to delegate to.
   */
  public constructor(config: CombinationConfig, engine: CombinationEngine) {
    this.id = config.id;
    this.name = config.name;
    this.description = `Composite: ${config.components
      .map((c) => c.strategyId.replace("strategy.", ""))
      .join(" + ")}`;
    this.engine = engine;
    this.config = config;

    // requiredHistory = max of all component requiredHistory values.
    // The Backtester reserves this many warm-up candles for all components.
    let maxHistory = 0;
    for (const component of config.components) {
      const strategy = engine.resolve(component.strategyId);
      if (strategy && strategy.requiredHistory > maxHistory) {
        maxHistory = strategy.requiredHistory;
      }
    }
    this.requiredHistory = maxHistory;

    this.parameterSpec = buildCompositeParamSpec();
    this.family = buildCompositeFamily(engine, config);

    // Determine shared timeframes: the intersection of all component
    // supportedTimeframes (if they declare any).
    const timeframes = new Set<string>();
    for (const component of config.components) {
      const strategy = engine.resolve(component.strategyId);
      if (!strategy) continue;
      const tf = strategy.supportedTimeframes;
      if (!tf) {
        // Strategy supports all → intersection = empty means "all"
        // We use undefined to signal "all".
        this.supportedTimeframes = undefined;
        return;
      }
      for (const t of tf) {
        if (timeframes.size === 0) {
          // Not yet initialised — add all from first strategy
          timeframes.add(t);
        } else if (!timeframes.has(t)) {
          timeframes.delete(t);
        }
      }
    }
    this.supportedTimeframes =
      timeframes.size > 0
        ? Array.from(timeframes).sort() as unknown as ReadonlyArray<StrategyTimeframe>
        : undefined;
  }

  public defaultParameters(): StrategyParameters {
    return Object.freeze({
      components: JSON.stringify(this.config.components),
    });
  }

  public validateParameters(parameters: unknown): ValidationResult {
    if (!parameters || typeof parameters !== "object") {
      return { ok: false, errors: ["CompositeStrategy parameters must be a non-null object."] };
    }
    const p = parameters as Record<string, unknown>;
    if (!p["components"]) {
      return { ok: false, errors: ['Parameter "components" is required.'] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(p["components"] as string);
    } catch {
      return { ok: false, errors: ['Parameter "components" must be valid JSON.'] };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, errors: ['Parameter "components" must be a JSON array.'] };
    }
    // Structural validation (not parameter-level) is done by CombinationEngine.run().
    return { ok: true };
  }

  /**
   * Delegates to `CombinationEngine.run()`. Returns a `CompositeSignal`
   * which satisfies the `Signal` contract, so callers can use it through
   * the normal Signal interface fields.
   */
  public analyze(ctx: StrategyContext): CompositeSignal {
    // If the caller passed override parameters (from Search), parse them
    // and build a merged config.
    let config = this.config;
    const p = ctx.parameters;
    if (p["components"] && typeof p["components"] === "string") {
      try {
        const overrides = JSON.parse(p["components"] as string);
        if (Array.isArray(overrides)) {
          // Merge: start from this.config.components, then apply overrides by strategyId.
          const overridesMap = new Map<string, Record<string, unknown>>();
          for (const o of overrides as Array<Record<string, unknown>>) {
            const sid = o["strategyId"] as string;
            if (sid) overridesMap.set(sid, o);
          }
          const merged = this.config.components.map((c) => {
            const override = overridesMap.get(c.strategyId);
            if (!override) return c;
            return {
              strategyId: c.strategyId,
              weight: (override["weight"] as number | undefined) ?? c.weight,
              parameters: (override["parameters"] as StrategyParameters | undefined) ?? c.parameters,
              position: (override["position"] as number | undefined) ?? c.position,
            };
          });
          config = {
            id: this.config.id,
            name: this.config.name,
            components: merged,
            operator: this.config.operator,
          };
        }
      } catch {
        // Malformed JSON → fall through to this.config (defaults)
      }
    }
    return this.engine.run(config, ctx);
  }
}
