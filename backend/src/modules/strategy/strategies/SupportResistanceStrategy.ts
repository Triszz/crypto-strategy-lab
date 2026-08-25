/**
 * strategy · strategies · SupportResistanceStrategy
 *
 * Structure (price-action) BASE strategy. Computes rolling support and
 * resistance from the LAST `lookback` candles, where:
 *
 *   - support  = the MIN `low`  over the lookback window (excluding the
 *                current candle, so the strategy reacts to *prior*
 *                structure rather than echoing the current bar).
 *   - resistance = the MAX `high` over the lookback window (excluding
 *                  the current candle).
 *
 * Signals:
 *   - BUY  when the current candle's `low` is at-or-below support AND
 *          the candle closes ABOVE support (i.e. the market probed
 *          support and bounced back). This is the canonical "support
 *          test" reaction.
 *   - SELL when the current candle's `high` is at-or-above resistance
 *          AND the candle closes BELOW resistance (failed breakout).
 *   - HOLD otherwise.
 *
 * IMPORTANT — this is an MVP algorithm suitable for a teaching
 * project. It is NOT a sophisticated market-structure detector and it
 * intentionally ignores orderflow, wicks, multi-touch levels, volume
 * confirmation, etc. The goal is to demonstrate that the Strategy
 * plugin contract is sufficient to express an alternative algorithmic
 * family without any change to Search / Backtest / Evaluation /
 * Leaderboard / Market Data.
 *
 * Parameters (validated in `validateParameters`):
 *   - `lookback`: integer ∈ [2, 500], default 20.
 *   - `tolerancePct`: decimal ∈ [0, 1], default 0.001. Fractional
 *     distance at which the price is considered "at" support /
 *     resistance (e.g. 0.001 = within 0.1%).
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
import type { Strategy } from "../domain/Strategy";
import type { Signal } from "../domain/Signal";
import type { ParamSpec, ValidationResult } from "../domain/ParamSpec";
import type { StrategyContext, StrategyParameters } from "../domain/StrategyContext";
import {
  defaultParametersFromSpec,
  validateParamSpec,
} from "../domain/ParamSpec";
import { highsOf, lowsOf } from "./_indicators";

export const SUPPORT_RESISTANCE_STRATEGY_ID = "strategy.support_resistance";

const PARAM_SPEC: ParamSpec = {
  fields: [
    {
      key: "lookback",
      kind: "integer",
      min: 2,
      max: 500,
      default: 20,
      description: "Number of prior candles used to estimate support/resistance.",
    },
    {
      key: "tolerancePct",
      kind: "decimal",
      min: 0,
      max: 1,
      default: 0.001,
      description: "Fractional tolerance for 'at' support/resistance (0.001 = 0.1%).",
    },
  ],
};

export class SupportResistanceStrategy implements Strategy {
  public readonly id = SUPPORT_RESISTANCE_STRATEGY_ID;
  public readonly name = "Support / Resistance (MVP)";
  public readonly family = "STRUCTURE" as const;
  public readonly description =
    "Generates BUY on support test (low probes support and close reclaims), SELL on failed resistance breakout.";
  public readonly supportedTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
  public readonly requiredHistory = 500;
  public readonly parameterSpec: ParamSpec = PARAM_SPEC;

  public defaultParameters(): StrategyParameters {
    return defaultParametersFromSpec(PARAM_SPEC);
  }

  public validateParameters(parameters: unknown): ValidationResult {
    if (!parameters || typeof parameters !== "object") {
      return { ok: false, errors: ["parameters must be an object."] };
    }
    return validateParamSpec(PARAM_SPEC, parameters as Readonly<Record<string, unknown>>);
  }

  public analyze(ctx: StrategyContext): Signal {
    const params = ctx.parameters;
    const lookback = params["lookback"];
    const tolPct = params["tolerancePct"];
    if (
      typeof lookback !== "number" || !Number.isInteger(lookback) || lookback <= 0 ||
      typeof tolPct !== "number" || !Number.isFinite(tolPct) || tolPct < 0
    ) {
      return { side: "HOLD", strength: 0, reason: "invalid parameters" };
    }

    // We need `lookback` candles BEFORE the current one. Total history
    // must therefore be at least `lookback + 1`.
    if (ctx.history.length < lookback + 1) {
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }
    const prior = ctx.history.slice(0, ctx.history.length - 1);
    const window = prior.slice(prior.length - lookback, prior.length);
    if (window.length < lookback) {
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }

    const lows = lowsOf(window);
    const highs = highsOf(window);
    let support = Number.POSITIVE_INFINITY;
    let resistance = Number.NEGATIVE_INFINITY;
    for (const v of lows) {
      if (v < support) support = v;
    }
    for (const v of highs) {
      if (v > resistance) resistance = v;
    }
    if (!Number.isFinite(support) || !Number.isFinite(resistance)) {
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }

    const close = ctx.candle.close;
    const low = ctx.candle.low;
    const high = ctx.candle.high;
    const tolerance = Math.max(tolPct, 0) * support;
    const rTolerance = Math.max(tolPct, 0) * resistance;

    const probedSupport = low <= support + tolerance && close > support;
    const failedResistance = high >= resistance - rTolerance && close < resistance;

    if (probedSupport) {
      return {
        side: "BUY",
        strength: 1,
        reason: `support test: low ${low} probed support ${support}, close ${close} reclaimed`,
        metadata: { support, resistance, low, high, close },
      };
    }
    if (failedResistance) {
      return {
        side: "SELL",
        strength: 1,
        reason: `failed breakout: high ${high} tested resistance ${resistance}, close ${close} failed`,
        metadata: { support, resistance, low, high, close },
      };
    }
    return {
      side: "HOLD",
      strength: 0,
      reason: "no support/resistance interaction",
      metadata: { support, resistance, low, high, close },
    };
  }
}