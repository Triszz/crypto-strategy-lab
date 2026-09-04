/**
 * strategy · strategies · NewsSentimentStrategy
 *
 * Sentiment-based BASE strategy. Evaluates news sentiment scores calculated
 * over a configurable lookback window for the target asset.
 *
 * Trading Rules:
 *  - BUY when average sentiment score >= buyThreshold (default +0.7)
 *  - SELL when average sentiment score <= sellThreshold (default -0.7)
 *  - HOLD otherwise (neutral or score between sellThreshold and buyThreshold)
 *
 * Parameters:
 *  - `lookbackWindowHours`: integer ∈ [1, 24], default 1.
 *  - `buyThreshold`: decimal ∈ [0.1, 1.0], default 0.7.
 *  - `sellThreshold`: decimal ∈ [-1.0, -0.1], default -0.7.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ.
 * All signal evaluation is pure and relies on `ctx.metadata.sentimentScore`.
 */
import type { Strategy } from "../domain/Strategy";
import type { ParamSpec, ValidationResult } from "../domain/ParamSpec";
import type { Signal } from "../domain/Signal";
import type { StrategyContext, StrategyParameters } from "../domain/StrategyContext";
import {
  defaultParametersFromSpec,
  validateParamSpec,
} from "../domain/ParamSpec";

export const NEWS_SENTIMENT_STRATEGY_ID = "strategy.sentiment.news";

const PARAM_SPEC: ParamSpec = {
  fields: [
    {
      key: "lookbackWindowHours",
      kind: "integer",
      min: 1,
      max: 24,
      default: 1,
      description: "Lookback window in hours to compute average sentiment.",
    },
    {
      key: "buyThreshold",
      kind: "decimal",
      min: 0.1,
      max: 1.0,
      default: 0.7,
      description: "Minimum average sentiment score to trigger a BUY signal.",
    },
    {
      key: "sellThreshold",
      kind: "decimal",
      min: -1.0,
      max: -0.1,
      default: -0.7,
      description: "Maximum average sentiment score to trigger a SELL signal.",
    },
  ],
};

export class NewsSentimentStrategy implements Strategy {
  public readonly id = NEWS_SENTIMENT_STRATEGY_ID;
  public readonly name = "News Sentiment Strategy";
  public readonly family = "SENTIMENT" as const;
  public readonly description =
    "Generates BUY/SELL signals based on market news sentiment score within a lookback window.";
  public readonly supportedTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
  public readonly requiredHistory = 1;
  public readonly parameterSpec: ParamSpec = PARAM_SPEC;

  public defaultParameters(): StrategyParameters {
    return defaultParametersFromSpec(PARAM_SPEC);
  }

  public validateParameters(parameters: unknown): ValidationResult {
    if (!parameters || typeof parameters !== "object") {
      return { ok: false, errors: ["parameters must be an object."] };
    }
    const fullParams = {
      ...this.defaultParameters(),
      ...(parameters as Readonly<Record<string, unknown>>),
    };
    const base = validateParamSpec(PARAM_SPEC, fullParams);
    if (!base.ok) {
      return base;
    }
    const buy = fullParams["buyThreshold"] as number;
    const sell = fullParams["sellThreshold"] as number;
    if (sell >= buy) {
      return {
        ok: false,
        errors: [`sellThreshold (${sell}) must be strictly less than buyThreshold (${buy}).`],
      };
    }
    return { ok: true };
  }

  public analyze(ctx: StrategyContext): Signal {
    const params = ctx.parameters;
    const buyThreshold = (params["buyThreshold"] as number) ?? 0.7;
    const sellThreshold = (params["sellThreshold"] as number) ?? -0.7;

    // Extract sentiment score from context metadata
    const rawScore =
      ctx.metadata?.sentimentScore ??
      ctx.metadata?.sentimentAverageScore ??
      ctx.metadata?.sentiment;

    if (rawScore === undefined || rawScore === null || typeof rawScore !== "number") {
      return {
        side: "HOLD",
        strength: 0,
        reason: "no sentiment data available in context metadata",
      };
    }

    const sentimentScore = rawScore;

    if (sentimentScore >= buyThreshold) {
      return {
        side: "BUY",
        strength: Math.min(1, Math.abs(sentimentScore)),
        reason: `positive news sentiment (${sentimentScore} >= buy threshold ${buyThreshold})`,
        metadata: { sentimentScore, buyThreshold, sellThreshold },
      };
    }

    if (sentimentScore <= sellThreshold) {
      return {
        side: "SELL",
        strength: Math.min(1, Math.abs(sentimentScore)),
        reason: `negative news sentiment (${sentimentScore} <= sell threshold ${sellThreshold})`,
        metadata: { sentimentScore, buyThreshold, sellThreshold },
      };
    }

    return {
      side: "HOLD",
      strength: 0,
      reason: `neutral sentiment (${sellThreshold} < ${sentimentScore} < ${buyThreshold})`,
      metadata: { sentimentScore, buyThreshold, sellThreshold },
    };
  }
}
