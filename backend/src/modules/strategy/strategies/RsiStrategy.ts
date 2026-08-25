/**
 * strategy · strategies · RsiStrategy
 *
 * Momentum BASE strategy. Generates a BUY signal when Wilder's RSI
 * drops BELOW the configured `buyThreshold` (oversold), a SELL signal
 * when RSI rises ABOVE the configured `sellThreshold` (overbought), and
 * HOLD otherwise. The two thresholds are non-overlapping: the strategy
 * rejects parameters where `buyThreshold ≥ sellThreshold`.
 *
 * Parameters (validated in `validateParameters`):
 *  - `period`: integer ∈ [2, 100], default 14. Number of closes used by
 *    Wilder's smoothing.
 *  - `buyThreshold`: integer ∈ [1, 99], default 30. RSI below this ⇒ BUY.
 *  - `sellThreshold`: integer ∈ [1, 99], default 70. RSI above this ⇒ SELL.
 *  - Cross-field rule: `buyThreshold < sellThreshold`.
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
import { closesOf, wilderRSI } from "./_indicators";

export const RSI_STRATEGY_ID = "strategy.rsi";

const PARAM_SPEC: ParamSpec = {
  fields: [
    {
      key: "period",
      kind: "integer",
      min: 2,
      max: 100,
      default: 14,
      description: "Wilder smoothing period (in candles).",
    },
    {
      key: "buyThreshold",
      kind: "integer",
      min: 1,
      max: 99,
      default: 30,
      description: "RSI below this value triggers BUY (oversold).",
    },
    {
      key: "sellThreshold",
      kind: "integer",
      min: 1,
      max: 99,
      default: 70,
      description: "RSI above this value triggers SELL (overbought).",
    },
  ],
};

export class RsiStrategy implements Strategy {
  public readonly id = RSI_STRATEGY_ID;
  public readonly name = "Relative Strength Index (Wilder)";
  public readonly family = "MOMENTUM" as const;
  public readonly description =
    "Generates BUY when RSI is oversold and SELL when RSI is overbought.";
  public readonly supportedTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
  // Worst case: need period + 1 closes to compute a stable RSI.
  public readonly requiredHistory = 101;
  public readonly parameterSpec: ParamSpec = PARAM_SPEC;

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
    const buy = params["buyThreshold"];
    const sell = params["sellThreshold"];
    if (typeof buy !== "number" || typeof sell !== "number") {
      return { ok: false, errors: ["buyThreshold and sellThreshold must be integers."] };
    }
    if (buy >= sell) {
      return {
        ok: false,
        errors: [`buyThreshold (${buy}) must be strictly less than sellThreshold (${sell}).`],
      };
    }
    return { ok: true };
  }

  public analyze(ctx: StrategyContext): Signal {
    const params = ctx.parameters;
    const period = params["period"];
    const buy = params["buyThreshold"];
    const sell = params["sellThreshold"];
    if (
      typeof period !== "number" || !Number.isInteger(period) || period <= 0 ||
      typeof buy !== "number" || typeof sell !== "number" || buy >= sell
    ) {
      return { side: "HOLD", strength: 0, reason: "invalid parameters" };
    }

    const closes = closesOf(ctx.history);
    const rsi = wilderRSI(closes, period);
    if (rsi === null) {
      return { side: "HOLD", strength: 0, reason: "warm-up" };
    }

    if (rsi < buy) {
      return {
        side: "BUY",
        strength: 1,
        reason: `RSI ${rsi.toFixed(2)} below oversold threshold ${buy}`,
        metadata: { rsi, buyThreshold: buy, sellThreshold: sell },
      };
    }
    if (rsi > sell) {
      return {
        side: "SELL",
        strength: 1,
        reason: `RSI ${rsi.toFixed(2)} above overbought threshold ${sell}`,
        metadata: { rsi, buyThreshold: buy, sellThreshold: sell },
      };
    }
    return {
      side: "HOLD",
      strength: 0,
      reason: `RSI ${rsi.toFixed(2)} in neutral band`,
      metadata: { rsi, buyThreshold: buy, sellThreshold: sell },
    };
  }
}