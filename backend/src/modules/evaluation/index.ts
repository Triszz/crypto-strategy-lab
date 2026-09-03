// Re-export types from evaluation.types that are NOT already in evaluator.engine.ts.
// This avoids TS2308 "duplicate export" for EvaluationWeights (already exported by engine).
export type { EvaluationWeights, EvaluationConfig } from "./domain/evaluation.types";
export { DEFAULT_CONFIG, EVAL_SETTING_KEYS } from "./domain/evaluation.types";
export * from "./domain/evaluator.engine";
export * from "./application/evaluation.service";
export * from "./infrastructure/evaluation-settings.repo";
