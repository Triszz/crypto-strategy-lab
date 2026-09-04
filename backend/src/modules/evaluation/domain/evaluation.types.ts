/**
 * Domain types for the Evaluation module (v2 BullMQ).
 *
 * These types define the configuration contract used by both the
 * evaluation queue/worker (runtime) and the settings repository (DB).
 */

export interface EvaluationWeights {
  /** Weight for totalReturn in overallScore formula. Default: 40 */
  return: number;
  /** Weight for winRate in overallScore formula. Default: 40 */
  winRate: number;
  /** Weight for maxDrawdown (subtracted) in overallScore formula. Default: 20 */
  drawdown: number;
}

export interface EvaluationConfig {
  weights: EvaluationWeights;
  /** Minimum number of trades before a strategy is considered statistically significant. */
  tradeCountThreshold: number;
}

/**
 * Default configuration — used as fallback when DB lookup fails.
 * These values are intentionally conservative (penalise small samples).
 */
export const DEFAULT_CONFIG: EvaluationConfig = Object.freeze({
  weights: Object.freeze({ return: 40, winRate: 40, drawdown: 20 }),
  tradeCountThreshold: 30,
});

/** Keys stored in the EvaluationSetting table */
export const EVAL_SETTING_KEYS = Object.freeze({
  DEFAULT_WEIGHTS: "evaluation.default_weights",
  TRADE_COUNT_THRESHOLD: "evaluation.trade_count_threshold",
} as const);
