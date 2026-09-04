import { Worker, type Job } from "bullmq";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus } from "../../../shared/event-bus/EventBus";
import { getRedisConnectionOptions } from "../../../shared/queue";
import { logger } from "../../../shared/logger/logger";

import { BacktestCompletionTracker } from "../application/BacktestCompletionTracker";
import { BacktestService, type RunBacktestParams } from "../application/BacktestService";
import { BACKTEST_QUEUE_NAME, getBullMQBacktestQueue } from "./BullMQBacktestQueue";
import type { BacktestJobProgress } from "./BacktestQueue";

export interface BullMQBacktestWorkerConfig {
  concurrency?: number;
}

export class BullMQBacktestWorker {
  private static instance: BullMQBacktestWorker | null = null;
  private worker: Worker | null = null;
  private readonly backtestService: BacktestService;
  private readonly tracker: BacktestCompletionTracker;
  private isRunning: boolean = false;

  private constructor(config?: BullMQBacktestWorkerConfig) {
    this.backtestService = new BacktestService();
    this.tracker = new BacktestCompletionTracker();

    const concurrency = config?.concurrency || parseInt(process.env.BACKTEST_WORKER_CONCURRENCY || "4", 10);

    try {
      const connection = getRedisConnectionOptions();
      this.worker = new Worker(
        BACKTEST_QUEUE_NAME,
        async (job: Job) => {
          return this.processBullMQJob(job);
        },
        {
          connection,
          concurrency,
        },
      );

      this.worker.on("failed", (job, err) => {
        logger.error({ jobId: job?.id, err: err.message }, "BullMQ Worker job failed");
      });

      logger.info({ queue: BACKTEST_QUEUE_NAME, concurrency }, "BullMQ BacktestWorker initialized");

      // Clean stale jobs left over from previous server runs (non-blocking).
      void getBullMQBacktestQueue().cleanStaleJobsOnBoot();
    } catch (err: any) {
      logger.warn({ err: err.message }, "BullMQ Redis worker initialization failed; running in standalone mode");
    }
  }

  public static getInstance(config?: BullMQBacktestWorkerConfig): BullMQBacktestWorker {
    if (!BullMQBacktestWorker.instance) {
      BullMQBacktestWorker.instance = new BullMQBacktestWorker(config);
    }
    return BullMQBacktestWorker.instance;
  }

  public start(): void {
    if (this.isRunning) {
      logger.info("BullMQBacktestWorker is already running");
      return;
    }
    this.isRunning = true;
    logger.info("BullMQBacktestWorker started and processing jobs");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    logger.info("BullMQBacktestWorker stopped");
  }

  /**
   * BullMQ Job Processor callback. Handles status updates in DB (`queue_jobs` and `candidate_strategies`),
   * publishes EventBus events, and triggers search run completion checks.
   */
  public async processBullMQJob(job: Job): Promise<BacktestJobProgress> {
    const { jobId, params } = job.data as { jobId: string; params: RunBacktestParams };
    return this.processJob(jobId, params, job.attemptsMade + 1);
  }

  /**
   * Process job execution with full status persistence and EventBus lifecycle events.
   */
  public async processJob(
    jobId: string,
    params: RunBacktestParams,
    attemptsMade: number = 1,
  ): Promise<BacktestJobProgress> {
    const eventBus = getEventBus();
    const prisma = getPrismaClient();
    const queueProgress = getBullMQBacktestQueue();

    logger.info(
      {
        tag: "[BULLMQ_WORKER]",
        jobId,
        candidateId: params.candidateId,
        symbol: params.symbol,
        timeframe: params.timeframe,
        strategyName: params.strategyName,
        attemptsMade,
      },
      "BullMQ Worker: Processing backtest job",
    );

    console.log("\n================================================================================");
    console.log("==================== HUYyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy [START] ====================");
    console.log(`Job ID       : ${jobId}`);
    console.log(`Candidate ID : ${params.candidateId || "N/A"}`);
    console.log(`Strategy     : ${params.strategyName} (${params.symbol || "BTCUSDT"} ${params.timeframe || "1h"})`);
    console.log("================================================================================\n");

    // 1. Update CandidateStrategy & queue_jobs status to RUNNING in DB
    try {
      await prisma.queueJob.updateMany({
        where: { jobId },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          attempts: attemptsMade,
        },
      });

      if (params.candidateId) {
        await prisma.candidateStrategy.updateMany({
          where: { id: params.candidateId },
          data: { status: "RUNNING" },
        });
      }
    } catch (dbErr: any) {
      logger.warn({ err: dbErr.message, jobId }, "Could not update RUNNING status in DB");
    }

    // 2. Emit BacktestStarted event
    try {
      eventBus.publish("BacktestStarted", {
        jobId,
        params,
        startedAt: new Date().toISOString(),
      });

      console.log("\n\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m");
      console.log("\x1b[1m\x1b[36m║  🚀  [BACKTEST-WORKER] BacktestStarted event emitted                    ║\x1b[0m");
      console.log("\x1b[1m\x1b[36m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
      console.log(`\x1b[1m\x1b[36m║  Job ID    : \x1b[0m${jobId}${" ".repeat(Math.max(0, 60 - String(jobId).length))}║`);
      console.log(`\x1b[1m\x1b[36m║  Symbol    : \x1b[1m\x1b[33m${String(params.symbol ?? "?")}\x1b[0m\x1b[1m\x1b[36m  Timeframe: \x1b[1m\x1b[33m${String(params.timeframe ?? "?")}\x1b[0m\x1b[1m\x1b[36m  Strategy: \x1b[1m\x1b[33m${String(params.strategyName ?? "?")}\x1b[0m\x1b[1m\x1b[36m${" ".repeat(Math.max(0, 17 - String(params.symbol ?? "?").length - String(params.timeframe ?? "?").length - String(params.strategyName ?? "?").length))}║\x1b[0m`);
      console.log("\x1b[1m\x1b[36m║  ▶ Running simulation…                                                   ║\x1b[0m");
      console.log("\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m\n");
    } catch (e: any) {
      logger.warn({ err: e.message, jobId }, "Failed to publish BacktestStarted event");
    }

    try {
      // 3. Execute core backtest simulation
      const output = await this.backtestService.runBacktest(params);

      // 4. Update CandidateStrategy & queue_jobs status to DONE/COMPLETED in DB
      try {
        await prisma.queueJob.updateMany({
          where: { jobId },
          data: {
            status: "COMPLETED",
            finishedAt: new Date(),
          },
        });

        if (params.candidateId) {
          await prisma.candidateStrategy.updateMany({
            where: { id: params.candidateId },
            data: { status: "DONE" },
          });
        }
      } catch (dbErr: any) {
        logger.warn({ err: dbErr.message, jobId }, "Could not update COMPLETED status in DB");
      }

      const completedProgress: BacktestJobProgress = {
        jobId,
        progress: 100,
        status: "COMPLETED",
        result: output,
      };

      queueProgress.updateJobProgress(completedProgress);

      // 5. BacktestCompleted event was ALREADY emitted by BacktestService.runBacktest
      //    (single source of truth) — no need to re-emit here.
      try {
        logger.info(
          {
            tag: "[BULLMQ_WORKER]",
            jobId,
            experimentId: output.experimentId,
            candidateId: params.candidateId,
            status: "COMPLETED",
            totalReturn: output.result.metrics.totalReturn,
            winRate: output.result.metrics.winRate,
            tradesCount: output.result.trades.length,
          },
          "BullMQ Worker: Backtest job completed successfully",
        );

        console.log("\n\x1b[1m\x1b[33m──────────────────────────────────────────────────────────────────────────────\x1b[0m");
        console.log(`\x1b[1m\x1b[33m✅  [BACKTEST-WORKER] Backtest completed — emitted BacktestCompleted (1×)  \x1b[0m`);
        console.log(`\x1b[1m\x1b[33m    Experiment ID: \x1b[1m\x1b[33m${output.experimentId}\x1b[0m`);
        console.log("\x1b[1m\x1b[33m──────────────────────────────────────────────────────────────────────────────\x1b[0m\n");

        console.log("\n================================================================================");
        console.log("==================== HUYyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy [DONE] ====================");
        console.log(`Job ID        : ${jobId} -> STATUS: COMPLETED`);
        console.log(`Candidate ID  : ${params.candidateId || "N/A"}`);
        console.log(`Experiment ID : ${output.experimentId}`);
        console.log(`Total Return  : ${output.result.metrics.totalReturn}%`);
        console.log(`Win Rate      : ${output.result.metrics.winRate}%`);
        console.log(`Total Trades  : ${output.result.trades.length}`);
        console.log("================================================================================\n");
      } catch (e: any) {
        logger.warn({ err: e.message, jobId }, "Backtest completion logging failed (non-fatal)");
      }

      // 6. Check 100% candidate completion for SearchRun
      await this.tracker.checkCompletionByCandidateId(params.candidateId);

      return completedProgress;
    } catch (error: any) {
      const errorMsg = error.message || "Backtest execution failed";
      logger.error({ jobId, err: errorMsg, candidateId: params.candidateId }, "BacktestWorker job failed");

      // Update CandidateStrategy & queue_jobs status to FAILED in DB
      try {
        await prisma.queueJob.updateMany({
          where: { jobId },
          data: {
            status: "FAILED",
            errorMessage: errorMsg,
            finishedAt: new Date(),
          },
        });

        if (params.candidateId) {
          await prisma.candidateStrategy.updateMany({
            where: { id: params.candidateId },
            data: {
              status: "FAILED",
              errorMessage: errorMsg,
            },
          });
        }
      } catch (dbErr: any) {
        logger.warn({ err: dbErr.message, jobId }, "Could not update FAILED status in DB");
      }

      // Emit BacktestFailed & CandidateFailed events
      try {
        eventBus.publish("BacktestFailed", {
          jobId,
          candidateId: params.candidateId,
          error: errorMsg,
          failedAt: new Date().toISOString(),
        });

        eventBus.publish("CandidateFailed", {
          candidateId: params.candidateId,
          error: errorMsg,
          failedAt: new Date().toISOString(),
        });
      } catch (e: any) {
        logger.warn({ err: e.message, jobId }, "Failed to publish BacktestFailed event");
      }

      const failedProgress: BacktestJobProgress = {
        jobId,
        progress: 0,
        status: "FAILED",
        error: errorMsg,
      };

      queueProgress.updateJobProgress(failedProgress);

      // Check candidate completion even on failure to ensure SearchRun doesn't hang
      await this.tracker.checkCompletionByCandidateId(params.candidateId);

      return failedProgress;
    }
  }
}

export function getBullMQBacktestWorker(config?: BullMQBacktestWorkerConfig): BullMQBacktestWorker {
  return BullMQBacktestWorker.getInstance(config);
}
