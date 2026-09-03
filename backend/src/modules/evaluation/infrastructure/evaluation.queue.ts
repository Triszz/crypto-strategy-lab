/**
 * BullMQ Evaluation Queue.
 *
 * Singleton that wraps a BullMQ `Queue` named `"evaluation"`. Jobs are
 * enqueued by `EvaluationService` when a `BacktestCompleted` event fires.
 * The queue is consumed by `BullMQEvaluationWorker` in a separate process
 * (or thread) so that slow evaluation work does not block the backtest
 * worker or the HTTP server.
 *
 * Graceful degradation: if Redis is unavailable at startup, the queue
 * instance is `null` and `enqueue()` becomes a no-op with a warning log.
 * This lets the server start even when Redis is temporarily down.
 */

import { Queue, type JobsOptions, type Job } from "bullmq";
import { getRedisConnectionOptions } from "../../../shared/queue";
import { logger } from "../../../shared/logger/logger";

export const EVALUATION_QUEUE_NAME = "evaluation";

// ---------------------------------------------------------------------------
// Job data contract
// ---------------------------------------------------------------------------

export interface EvaluationJobData {
  experimentId: string;
  enqueuedAt: number; // epoch ms — useful for latency debugging
  attempt: number;     // managed by BullMQ; echoed here for convenience
}

// ---------------------------------------------------------------------------
// Job result contract
// ---------------------------------------------------------------------------

export interface EvaluationJobResult {
  experimentId: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export class BullMQEvaluationQueue {
  private static _instance: BullMQEvaluationQueue | null = null;
  private queue: Queue<EvaluationJobData, EvaluationJobResult> | null = null;

  private constructor() {
    try {
      const connection = getRedisConnectionOptions();
      const defaultJobOptions: JobsOptions = {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600, // 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 86400, // 24 hours
        },
      };

      this.queue = new Queue<EvaluationJobData, EvaluationJobResult>(
        EVALUATION_QUEUE_NAME,
        { connection, defaultJobOptions },
      );

      logger.info(
        { queue: EVALUATION_QUEUE_NAME, host: connection.host, port: connection.port },
        "BullMQ EvaluationQueue initialised",
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "EvaluationQueue Redis init failed; running in mock mode");
    }
  }

  public static getInstance(): BullMQEvaluationQueue {
    if (!BullMQEvaluationQueue._instance) {
      BullMQEvaluationQueue._instance = new BullMQEvaluationQueue();
    }
    return BullMQEvaluationQueue._instance;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the BullMQ queue is connected and ready to accept jobs.
   * Useful for health-check endpoints.
   */
  public isReady(): boolean {
    return this.queue !== null;
  }

  /**
   * Returns the name of this queue. Exposed for monitoring / health endpoints.
   */
  public getQueueName(): string {
    return EVALUATION_QUEUE_NAME;
  }

  /**
   * Returns aggregate job counts for the entire queue.
   * Useful for the `/api/evaluation/queue/stats` endpoint.
   */
  public async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    if (!this.queue) return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    return this.queue.getJobCounts() as Promise<{ waiting: number; active: number; completed: number; failed: number; delayed: number }>;
  }

  /**
   * Retrieves a single job by its `jobId`.
   * Returns `null` if the queue is unavailable or the job does not exist.
   */
  public async getJob(jobId: string): Promise<Job<EvaluationJobData, EvaluationJobResult> | null> {
    if (!this.queue) return null;
    return (await this.queue.getJob(jobId)) ?? null;
  }

  /**
   * Enqueues an evaluation job for the given `experimentId`.
   *
   * Uses `experimentId` as the BullMQ `jobId` so that duplicate enqueues
   * for the same experiment are automatically rejected — guaranteeing
   * idempotency at the queue level.
   *
   * @param experimentId — the backtest experiment to evaluate
   */
  public async enqueue(experimentId: string): Promise<void> {
    if (!this.queue) {
      logger.warn({ experimentId }, "EvaluationQueue not initialised; skipping enqueue");
      return;
    }

    const jobId = `eval-${experimentId}`;

    await this.queue.add("evaluation.run", {
      experimentId,
      enqueuedAt: Date.now(),
      attempt: 1,
    }, { jobId });

    logger.info({ experimentId, jobId }, "Evaluation job enqueued");
  }

  /**
   * Gracefully closes the queue connection.
   * Call this during server shutdown to let in-flight jobs finish their
   * enqueue operations before the process exits.
   */
  public async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      logger.info("BullMQ EvaluationQueue closed");
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level accessor (matches the pattern used by the backtest module)
// ---------------------------------------------------------------------------

export function getEvaluationQueue(): BullMQEvaluationQueue {
  return BullMQEvaluationQueue.getInstance();
}
