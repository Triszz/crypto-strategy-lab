import { getEventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";
import { BacktestService, type RunBacktestParams } from "../application/BacktestService";
import type { BacktestJobProgress } from "./BacktestQueue";

export interface BacktestWorkerConfig {
  concurrency?: number;
}

export class BacktestWorker {
  private readonly backtestService: BacktestService;
  private isRunning: boolean = false;

  constructor() {
    this.backtestService = new BacktestService();
  }

  public start(): void {
    if (this.isRunning) {
      logger.info("BacktestWorker is already running");
      return;
    }
    this.isRunning = true;
    logger.info("BacktestWorker initialized and listening for jobs");
  }

  public stop(): void {
    this.isRunning = false;
    logger.info("BacktestWorker stopped");
  }

  /**
   * Directly executes a backtest job as a worker unit, handling status reporting and EventBus events.
   */
  public async processJob(jobId: string, params: RunBacktestParams): Promise<BacktestJobProgress> {
    const eventBus = getEventBus();

    logger.info({ jobId, symbol: params.symbol, strategy: params.strategyName }, "BacktestWorker processing job");

    try {
      // 1. Emit BacktestStarted event
      try {
        eventBus.publish("BacktestStarted", {
          jobId,
          params,
          startedAt: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ err: e, jobId }, "Failed to publish BacktestStarted event");
      }

      // 2. Execute simulation via BacktestService
      const output = await this.backtestService.runBacktest(params);

      // 3. Update job progress in queue repository
      const completedProgress: BacktestJobProgress = {
        jobId,
        progress: 100,
        status: "COMPLETED",
        result: output,
      };

      // 4. BacktestCompleted event was ALREADY emitted by BacktestService.runBacktest
      //    (single source of truth) — do not re-emit here.

      return completedProgress;
    } catch (error: any) {
      const errorMsg = error.message || "Backtest execution failed";
      logger.error({ jobId, err: errorMsg }, "BacktestWorker job failed");

      // Emit BacktestFailed event
      try {
        eventBus.publish("BacktestFailed", {
          jobId,
          error: errorMsg,
          failedAt: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ err: e, jobId }, "Failed to publish BacktestFailed event");
      }

      return {
        jobId,
        progress: 0,
        status: "FAILED",
        error: errorMsg,
      };
    }
  }
}

let workerInstance: BacktestWorker | null = null;

export function getBacktestWorker(): BacktestWorker {
  if (!workerInstance) {
    workerInstance = new BacktestWorker();
  }
  return workerInstance;
}
