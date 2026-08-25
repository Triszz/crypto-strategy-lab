/**
 * strategy · strategies · BollingerBandsStrategy
 *
 * Volatility BASE strategy. Computes the middle band (SMA over `period`
 * closes), the upper band (middle + `stdDevMultiplier * stddev`), and
 * the lower band (middle - `stdDevMultiplier * stddev). Generates a
 * BUY when the current close is below the lower band (price stretched
 * below its recent mean), a SELL when the close is above the upper
 * band, and HOLD otherwise.
 *
 * Parameters (validated in `validateParameters`):
 *  - `period`: integer ∈ [2, 200], default 20.
 *  - `stdDevMultiplier`: decimal ∈ [0.1, 10], default 2.
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
import { closesOf, populationStdDev, simpleMovingAverage } from "./_indicators";

export const BOLLINGER_STRATEGY_ID = "strategy.bollinger";

const PARAM_SPEC: ParamSpec = {
  fields: [
    {
      key: "period",
      kind: "integer",
      min: 2,
      max: 200,
      default: 20,
      description: "Lookback for the SMA and standard deviation (in candles).",
    },
    {
      key: "stdDevMultiplier",
      kind: "decimal",
      min: 0.1,
      max: 10,
      default: 2,
      description: "Number of standard deviations for the upper/lower bands.",
    },
  ],
};

export class BollingerBandsStrategy implements Strategy {
  public readonly id = BOLLINGER_STRATEGY_ID;
  public readonly name = "Bollinger Bands";
  public readonly family = "VOLATILITY" as const;
  public readonly description =
    "Generates BUY when close drops below the lower band and SELL when close rises above the upper band.";
  public readonly supportedTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
  public readonly requiredHistory = 200;
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
    const period = params["period"];
    const k = params["stdDevMultiplier"];
    if (
      typeof period !== "number" || !Number.isInteger(period) || period <= 0 ||
      typeof k !== "number" || !Number.isFinite(k) || k <= 0
    ) {
      return { side: "HOLD", strength: 0, reason: "invalid parameters" };
    }

    const closes = closesOf(ctx.history);
    const middle = simpleMovingAverage(closes, period);
    if (middle === null) {
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }
    const stdDev = populationStdDev(closes, period, middle);
    if (stdDev === null) {
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }

    const upper = middle + k * stdDev;
    const lower = middle - k * stdDev;
    const close = ctx.candle.close;

    if (close < lower) {
      return {
        side: "BUY",
        strength: 1,
        reason: `close ${close} below lower band ${lower.toFixed(6)}`,
        metadata: { middle, upper, lower, stdDev, close },
      };
    }
    if (close > upper) {
      return {
        side: "SELL",
        strength: 1,
        reason: `close ${close} above upper band ${upper.toFixed(6)}`,
        metadata: { middle, upper, lower, stdDev, close },
      };
    }
    return {
      side: "HOLD",
      strength: 0,
      reason: `close ${close} inside bands [${lower.toFixed(6)}, ${upper.toFixed(6)}]`,
      metadata: { middle, upper, lower, stdDev, close },
    };
  }
}