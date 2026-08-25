/**
 * strategy · module barrel
 *
 * Public surface of the Strategy module. Only domain contracts and the
 * runtime registry are exported here; concrete strategies are registered
 * via `domain/strategies/bootstrap.ts` and resolved through
 * `getStrategyRegistry()`.
 *
 * Combination layer exports are in `combination/index.ts`.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 */
export type { Strategy } from "./domain/Strategy";
export type { Signal, SignalSide } from "./domain/Signal";
export { holdSignal } from "./domain/Signal";
export type {
  StrategyContext,
  StrategyCandle,
  StrategyFamily,
  StrategyTimeframe,
  StrategyParameters,
} from "./domain/StrategyContext";
export type {
  ParamSpec,
  ParamField,
  ParamKind,
  ValidationResult,
} from "./domain/ParamSpec";
export { validateParamSpec, defaultParametersFromSpec } from "./domain/ParamSpec";
export type { StrategyRegistry } from "./domain/StrategyRegistry";
export {
  getStrategyRegistry,
  setStrategyRegistry,
  resetStrategyRegistry,
} from "./domain/StrategyRegistry";
export { bootstrapStrategies } from "./strategies/bootstrap";

/**
 * Combination layer. Combination lives under the Strategy module (not a
 * top-level `modules/combination/`) per the existing project architecture.
 */
export type {
  CombinationComponent,
  CombinationConfig,
  CombinationValidationResult,
} from "./combination/CombinationConfig";
export {
  validateCombinationConfig,
} from "./combination/CombinationConfig";
export type { CompositeSignal, ComponentVote } from "./combination/CompositeSignal";
export { combineComponentVotes, buildComponentVote } from "./combination/WeightedCombiner";
export type { ComponentFailure } from "./combination/CombinationEngine";
export { CombinationError } from "./combination/CombinationEngine";
export { CombinationEngine } from "./combination/CombinationEngine";
export {
  CompositeStrategy,
  COMPOSITE_STRATEGY_ID_PREFIX,
  isCompositeStrategyId,
} from "./combination/CompositeStrategy";