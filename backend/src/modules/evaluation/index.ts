// Re-export domain types (avoid TS2308 "duplicate export" for EvaluationWeights
// since it is also exported by evaluator.engine.ts).
export type { EvaluationWeights } from "./domain/evaluation.types";
export type { EvaluationConfig } from "./domain/evaluation.types";

// Re-export domain constants
export { DEFAULT_CONFIG, EVAL_SETTING_KEYS } from "./domain/evaluation.types";

// Re-export engine
export {
  EvaluatorEngine,
  type TradeInput,
  type EvaluationResultMetrics,
} from "./domain/evaluator.engine";

// Re-export application service
export { EvaluationService } from "./application/evaluation.service";

// Re-export infrastructure
export {
  type EvaluationJobData,
  type EvaluationJobResult,
  BullMQEvaluationQueue,
  getEvaluationQueue,
  EVALUATION_QUEUE_NAME,
} from "./infrastructure/evaluation.queue";

export {
  BullMQEvaluationWorker,
  getEvaluationWorker,
} from "./infrastructure/evaluation.worker";

export {
  getEvaluationConfig,
  clearEvaluationConfigCache,
} from "./infrastructure/evaluation-settings.repo";
