// Backtest module barrel exports
export type {
  CandleData,
  SimulatedTrade,
  EquityPoint,
  BacktestMetrics,
  BacktestResultDomain,
  BacktestOptions,
  PositionType,
  StrategySignalFunction,
} from "./domain/types";

export { Backtester } from "./domain/Backtester";

export { BacktestService, type RunBacktestParams } from "./application/BacktestService";
export {
  SearchExecutionService,
  getSearchExecutionService,
  type CandidateExecutionParams,
  type CandidateExecutionResult,
} from "./application/SearchExecutionService";

export { BacktestQueue, getBacktestQueue, type BacktestJobData, type BacktestJobProgress } from "./infrastructure/BacktestQueue";
export { BacktestWorker, getBacktestWorker } from "./infrastructure/BacktestWorker";

export { BacktestController } from "./presentation/backtest.controller";
export { backtestRouter } from "./presentation/backtest.routes";