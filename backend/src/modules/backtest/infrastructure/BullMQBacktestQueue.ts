import { Queue } from "bullmq";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";
import { getRedisConnectionOptions } from "../../../shared/queue";
import type { RunBacktestParams } from "../application/BacktestService";
import type { BacktestJobProgress } from "./BacktestQueue";
import { getBullMQBacktestWorker } from "./BullMQBacktestWorker";

export const BACKTEST_QUEUE_NAME = "backtest";
export { getRedisConnectionOptions };

export class BullMQBacktestQueue {
  private static instance: BullMQBacktestQueue | null = null;
  private queue: Queue | null = null;
  private readonly jobProgressMap: Map<string, BacktestJobProgress>;

  private constructor() {
    this.jobProgressMap = new Map();
    try {
      const connection = getRedisConnectionOptions();
      this.queue = new Queue(BACKTEST_QUEUE_NAME, { connection });
      logger.info({ queue: BACKTEST_QUEUE_NAME, host: connection.host, port: connection.port }, "BullMQ BacktestQueue initialized");
    } catch (err: any) {
      logger.warn({ err: err.message }, "BullMQ Redis queue initialization failed; using in-memory fallback");
    }

    try {
      getEventBus().subscribe<{ candidateId?: string }>("StrategyGenerated", (payload) => {
        if (payload && payload.candidateId) {
          logger.info({ candidateId: payload.candidateId }, "BullMQBacktestQueue auto-enqueuing generated Strategy Candidate");
          void this.addJob({ candidateId: payload.candidateId, strategyName: "CandidateStrategy" });
        }
      });
    } catch (eventErr: any) {
      logger.warn({ err: eventErr.message }, "Failed to subscribe StrategyGenerated event in BullMQBacktestQueue");
    }
  }

  public static getInstance(): BullMQBacktestQueue {
    if (!BullMQBacktestQueue.instance) {
      BullMQBacktestQueue.instance = new BullMQBacktestQueue();
    }
    return BullMQBacktestQueue.instance;
  }

  /**
   * Enqueues a backtest job into BullMQ and records persistence in DB (`queue_jobs` table).
   */
  public async addJob(params: RunBacktestParams): Promise<BacktestJobProgress> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const jobProgress: BacktestJobProgress = {
      jobId,
      progress: 0,
      status: "WAITING",
    };

    this.jobProgressMap.set(jobId, jobProgress);

    // 1. Record job persistence in DB (queue_jobs table per docs/Solution.md §13)
    try {
      const prisma = getPrismaClient();
      await prisma.queueJob.upsert({
        where: { jobId },
        update: {
          status: "WAITING",
          payload: params as any,
        },
        create: {
          jobId,
          queueName: BACKTEST_QUEUE_NAME,
          jobType: "backtest.run",
          payload: params as any,
          status: "WAITING",
          maxAttempts: 3,
        },
      });
    } catch (dbErr: any) {
      logger.warn({ err: dbErr.message, jobId }, "Could not record queueJob in DB; proceeding with Queue dispatch");
    }

    // 2. Dispatch to BullMQ Queue (or fallback to in-memory worker if Redis is offline)
    let enqueued = false;
    if (this.queue) {
      try {
        await this.queue.add(
          "backtest.run",
          { jobId, params },
          {
            jobId,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 1000,
            },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        );
        enqueued = true;
        logger.info(
          {
            tag: "[BULLMQ_QUEUE]",
            jobId,
            queueName: BACKTEST_QUEUE_NAME,
            jobType: "backtest.run",
            candidateId: params.candidateId,
            symbol: params.symbol,
            timeframe: params.timeframe,
            strategyName: params.strategyName,
          },
          "BullMQ: Backtest job successfully enqueued",
        );
      } catch (queueErr: any) {
        logger.warn({ err: queueErr.message, jobId }, "Redis BullMQ queue unavailable; using in-memory worker fallback");
      }
    }

    if (!enqueued) {
      setImmediate(() => {
        const worker = getBullMQBacktestWorker();
        worker.processJob(jobId, params).catch((err) => {
          logger.error({ err, jobId }, "In-memory fallback backtest worker error");
        });
      });
    }

    return jobProgress;
  }

  /**
   * Retrieves status for a given jobId.
   */
  public getJobProgress(jobId: string): BacktestJobProgress | null {
    return this.jobProgressMap.get(jobId) || null;
  }

  /**
   * Updates in-memory job progress cache.
   */
  public updateJobProgress(progress: BacktestJobProgress): void {
    this.jobProgressMap.set(progress.jobId, progress);
  }

  public async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  /**
   * Cleans up stale jobs left over from previous server runs / crashes.
   *
   * Called once on boot to remove:
   *  - `failed` jobs older than 24 h (already exhausted retries)
   *  - `completed` jobs older than 1 h (already consumed)
   *  - `delayed` jobs older than 24 h (no longer relevant)
   *
   * No-op when Redis is unavailable.
   */
  public async cleanStaleJobsOnBoot(): Promise<void> {
    if (!this.queue) {
      logger.warn("[BacktestQueue] Redis unavailable; skipping stale-job cleanup");
      return;
    }

    try {
      const failed = await this.queue.clean(24 * 60 * 60 * 1000, 1000, "failed");
      const completed = await this.queue.clean(60 * 60 * 1000, 1000, "completed");
      const delayed = await this.queue.clean(24 * 60 * 60 * 1000, 1000, "delayed");

      logger.info(
        { failed, completed, delayed },
        "[BacktestQueue] Stale jobs cleaned on boot",
      );
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "[BacktestQueue] Stale-job cleanup failed (non-fatal)");
    }
  }
}

export function getBullMQBacktestQueue(): BullMQBacktestQueue {
  return BullMQBacktestQueue.getInstance();
}
