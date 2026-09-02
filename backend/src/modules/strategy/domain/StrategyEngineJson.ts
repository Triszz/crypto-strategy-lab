/**
 * strategy · domain · StrategyEngineJson
 *
 * The JSON contract used by the Strategy Engine (/strategy-engine page)
 * to define user-created strategies. It is INTENTIONALLY compatible
 * with the existing Strategy domain so that saved strategies can later
 * be wired into Search / Backtest without an incompatible second format.
 *
 * Required fields:
 *   - name, version, family, implementationRef
 *   - parameterSpec (matches the existing ParamSpec type)
 *   - parameters   (concrete parameter values matching the spec)
 *   - requiredHistory (matches existing Strategy.requiredHistory)
 *   - supportedTimeframes? (matches existing Strategy.supportedTimeframes)
 *   - description? (UI hint)
 *
 * User-friendly extras (ignored by the runtime domain):
 *   - source  ("USER_PROMPT" | "WEB_IMPORT")
 *   - tags    (free-form labels)
 */
import type { ParamSpec } from "./ParamSpec";
import type { StrategyFamily, StrategyTimeframe } from "./StrategyContext";

export const STRATEGY_SOURCES = ["USER_PROMPT", "WEB_IMPORT"] as const;
export type StrategySource = typeof STRATEGY_SOURCES[number];

export interface StrategyEngineJson {
  readonly name: string;
  readonly version: string;
  readonly family: StrategyFamily;
  /** Globally unique reference. For user strategies: "strategy.user.<uuid>". */
  readonly implementationRef: string;
  readonly parameterSpec: ParamSpec;
  /** Concrete parameter values; must satisfy parameterSpec. */
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly requiredHistory: number;
  readonly supportedTimeframes?: ReadonlyArray<StrategyTimeframe>;
  readonly description?: string;
  readonly source?: StrategySource;
  readonly tags?: ReadonlyArray<string>;
  readonly timeframe?: StrategyTimeframe;
}
