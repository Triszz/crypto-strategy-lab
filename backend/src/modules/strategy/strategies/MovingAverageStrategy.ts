/**
 * strategy · strategies · MovingAverageStrategy
 *
 * Trend-following BASE strategy. Generates a BUY signal when the fast
 * moving average crosses ABOVE the slow moving average (golden cross),
 * a SELL signal when the fast SMA crosses BELOW the slow SMA (death
 * cross), and HOLD otherwise.
 *
 * The "crossover" is determined by comparing today's spread
 * (`fast - slow`) with yesterday's spread. The first analysis (warm-up)
 * always returns HOLD so that the Backtester does not fire a synthetic
 * signal from a half-populated history.
 *
 * Parameters (validated in `validateParameters`):
 *  - `fastPeriod`: integer ∈ [2, 200], default 9.
 *  - `slowPeriod`: integer ∈ [2, 400], default 21.
 *  - Cross-field rule: `fastPeriod < slowPeriod`.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK. All math is local + deterministic.
 */
import type { Strategy } from "../domain/Strategy";
import type { ParamSpec, ValidationResult } from "../domain/ParamSpec";
import type { Signal } from "../domain/Signal";
import type { StrategyContext, StrategyParameters } from "../domain/StrategyContext";
import {
  defaultParametersFromSpec,
  validateParamSpec,
} from "../domain/ParamSpec";
import { closesOf, simpleMovingAverage } from "./_indicators";

export const MA_STRATEGY_ID = "strategy.ma";

const PARAM_SPEC: ParamSpec = {
  fields: [
    {
      key: "fastPeriod",
      kind: "integer",
      min: 2,
      max: 200,
      default: 9,
      description: "Lookback for the fast SMA (in candles).",
    },
    {
      key: "slowPeriod",
      kind: "integer",
      min: 2,
      max: 400,
      default: 21,
      description: "Lookback for the slow SMA (in candles).",
    },
  ],
};

function readPositiveInteger(
  parameters: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const v = parameters[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    return null;
  }
  return v;
}

export class MovingAverageStrategy implements Strategy {
  public readonly id = MA_STRATEGY_ID;
  public readonly name = "Moving Average Crossover";
  public readonly family = "TREND" as const;
  public readonly description =
    "Generates BUY on golden cross (fast SMA crosses above slow SMA) and SELL on death cross.";
  public readonly supportedTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
  public readonly requiredHistory: number;
  public readonly parameterSpec: ParamSpec = PARAM_SPEC;

  constructor() {
    this.requiredHistory = (PARAM_SPEC.fields.find((f) => f.key === "slowPeriod")?.max as number) ?? 400;
  }

  public defaultParameters(): StrategyParameters {
    return defaultParametersFromSpec(PARAM_SPEC);
  }

  public validateParameters(parameters: unknown): ValidationResult {
    if (!parameters || typeof parameters !== "object") {
      return { ok: false, errors: ["parameters must be an object."] };
    }
    const base = validateParamSpec(PARAM_SPEC, parameters as Readonly<Record<string, unknown>>);
    if (!base.ok) {
      return base;
    }
    const params = parameters as Readonly<Record<string, unknown>>;
    const fast = readPositiveInteger(params, "fastPeriod");
    const slow = readPositiveInteger(params, "slowPeriod");
    if (fast === null || slow === null) {
      return { ok: false, errors: ["fastPeriod and slowPeriod must be positive integers."] };
    }
    if (fast >= slow) {
      return {
        ok: false,
        errors: [`fastPeriod (${fast}) must be strictly less than slowPeriod (${slow}).`],
      };
    }
    return { ok: true };
  }

  public analyze(ctx: StrategyContext): Signal {
    const params = ctx.parameters;
    const fast = params["fastPeriod"];
    const slow = params["slowPeriod"];
    if (
      typeof fast !== "number" || !Number.isInteger(fast) || fast <= 0 ||
      typeof slow !== "number" || !Number.isInteger(slow) || slow <= 0 ||
      fast >= slow
    ) {
      // Defensive: the Backtester must validate first. If we somehow
      // get here with invalid params, fall back to HOLD rather than throw
      // (a Backtest should never crash because of bad inputs).
      return { side: "HOLD", strength: 0, reason: "invalid parameters" };
    }

    const closes = closesOf(ctx.history);
    const fastNow = simpleMovingAverage(closes, fast);
    const slowNow = simpleMovingAverage(closes, slow);
    if (fastNow === null || slowNow === null) {
      // Warm-up: not enough history to compute both averages.
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }

    const spreadNow = fastNow - slowNow;

    // We need at least one full "yesterday" close to detect a CROSS.
    // Yesterday's window is closes[0 .. length-2].
    if (closes.length < slow + 1) {
      return {
        side: "HOLD",
        strength: 0,
        reason: "warm-up (need ≥ slowPeriod + 1 candles for crossover detection)",
        metadata: { fastSMA: fastNow, slowSMA: slowNow },
      };
    }
    const yesterdaysCloses = closes.slice(0, closes.length - 1);
    const fastYesterday = simpleMovingAverage(yesterdaysCloses, fast);
    const slowYesterday = simpleMovingAverage(yesterdaysCloses, slow);
    if (fastYesterday === null || slowYesterday === null) {
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }
    const spreadYesterday = fastYesterday - slowYesterday;

    if (spreadYesterday <= 0 && spreadNow > 0) {
      // Golden cross.
      return {
        side: "BUY",
        strength: 1,
        reason: "golden cross: fast SMA crossed above slow SMA",
        metadata: { fastSMA: fastNow, slowSMA: slowNow, spread: spreadNow },
      };
    }
    if (spreadYesterday >= 0 && spreadNow < 0) {
      // Death cross.
      return {
        side: "SELL",
        strength: 1,
        reason: "death cross: fast SMA crossed below slow SMA",
        metadata: { fastSMA: fastNow, slowSMA: slowNow, spread: spreadNow },
      };
    }

    return {
      side: "HOLD",
      strength: 0,
      reason: "no crossover",
      metadata: { fastSMA: fastNow, slowSMA: slowNow, spread: spreadNow },
    };
  }
}