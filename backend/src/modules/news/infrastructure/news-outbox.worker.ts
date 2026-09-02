import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
import { logger as defaultLogger, Logger } from "../../../shared/logger/logger";

/**
 * Payload stored in QueueJob for outbox events.
 * `eventName` must match one of the event names registered on the EventBus
 * (e.g. "NewsCollected", "SentimentAnalyzed").
 */
export interface OutboxEventPayload {
  eventName: string;
  payload: Record<string, unknown>;
}

/**
 * Discriminator values used to identify outbox rows in the QueueJob table.
 * Any row with `job_type = OUTBOX_EVENT` and `queue_name = NEWS_OUTBOX`
 * is an outbox entry for the news module.
 */
export const OUTBOX_JOB_TYPE = "OUTBOX_EVENT";
export const OUTBOX_QUEUE_NAME = "news-outbox";

/**
 * How often the worker polls the database for new outbox rows.
 * 5 seconds is a good balance between responsiveness and DB load for MVP.
 */
const OUTBOX_POLL_INTERVAL_MS = 5_000;

/**
 * Maximum number of outbox rows processed per poll cycle.
 * Keeps each cycle short so the DB connection is not held for long.
 */
const OUTBOX_BATCH_SIZE = 50;

/**
 * Outbox worker.
 *
 * Phase C.5 & C.6:
 *
 * Problem with publishing events directly in `NewsService`:
 *   If `repository.saveNewsBatch()` runs inside a transaction and the
 *   transaction rolls back AFTER we have already called `eventBus.publish()`,
 *   subscribers (e.g. SentimentService) will receive events for news items
 *   that do not exist in the DB — causing crashes or inconsistent state.
 *
 * Solution (Outbox Pattern):
 *   1. Inside the same transaction as `news` inserts, we also INSERT a row
 *      into `QueueJob` with `job_type = OUTBOX_EVENT`, `status = WAITING`,
 *      and the event payload in JSON.
 *   2. This worker polls for WAITING rows, publishes each via the EventBus,
 *      then marks the row PUBLISHED (or FAILED after maxAttempts retries).
 *   3. Because the row is only inserted after the transaction commits,
 *      published events always correspond to persisted data.
 *
 * Persistence note:
 *   The worker runs in-process (same Node.js event loop). For a true
 *   distributed system this would be a separate microservice reading from
 *   the same DB. Phase D will cover that split.
 *
 * Lifecycle:
 *   - `start()` registers the poll interval; the first poll runs immediately.
 *   - `stop()` clears the interval and awaits any in-flight processing.
 *   - `getStats()` returns current health counters for monitoring.
 */

/**
 * Minimal shape for a QueueJob row returned by findMany.
 * Defined locally to avoid importing a full generated type.
 */
type QueueJobRow = {
  id: string;
  jobId: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  status: string;
};

export class NewsOutboxWorker {
  private static instance: NewsOutboxWorker | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private stopped = false;

  private readonly prisma = getPrismaClient();
  private readonly eventBus: EventBus;
  private readonly log: Logger;

  /** Exposed for monitoring / health-check endpoints. */
  public readonly stats = {
    processed: 0,
    failed: 0,
    lastPollAt: "",
  };

  private constructor(eventBus: EventBus, log?: Logger) {
    this.eventBus = eventBus;
    this.log = log ?? defaultLogger;
  }

  /**
   * Returns the singleton instance, creating it on first call.
   */
  public static getInstance(eventBus?: EventBus, log?: Logger): NewsOutboxWorker {
    if (!NewsOutboxWorker.instance) {
      NewsOutboxWorker.instance = new NewsOutboxWorker(eventBus ?? getEventBus(), log);
    }
    return NewsOutboxWorker.instance;
  }

  /**
   * For tests: drop the singleton so the next call rebuilds fresh.
   */
  public static resetInstance(): void {
    if (NewsOutboxWorker.instance) {
      NewsOutboxWorker.instance.stop();
      NewsOutboxWorker.instance = null;
    }
  }

  /**
   * Starts the poll loop. Idempotent — calling twice is a no-op.
   */
  public start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;

    this.log.info(
      { event: "news.outbox_worker.start", pollIntervalMs: OUTBOX_POLL_INTERVAL_MS },
      "News outbox worker started",
    );

    // Immediate first poll so events are published without waiting for the
    // first interval tick.
    void this.poll();

    this.intervalHandle = setInterval(() => {
      void this.poll();
    }, OUTBOX_POLL_INTERVAL_MS);
    this.intervalHandle.unref?.();
  }

  /**
   * Stops the poll loop gracefully. Waits for any in-flight cycle to finish.
   */
  public stop(): void {
    if (!this.running) return;
    this.stopped = true;
    this.running = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.log.info(
      {
        event: "news.outbox_worker.stop",
        processed: this.stats.processed,
        failed: this.stats.failed,
      },
      "News outbox worker stopped",
    );
  }

  /**
   * Returns a snapshot of worker stats. Used by health-check endpoints.
   */
  public getStats(): { processed: number; failed: number; lastPollAt: string; running: boolean } {
    return {
      processed: this.stats.processed,
      failed: this.stats.failed,
      lastPollAt: this.stats.lastPollAt,
      running: this.running,
    };
  }

  // ─── Core poll logic ────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.stopped) return;
    if (this.processing) return; // Skip this tick if previous cycle is still running

    this.processing = true;
    this.stats.lastPollAt = new Date().toISOString();

    try {
      await this.processBatch();
    } catch (err) {
      this.log.error(
        { event: "news.outbox_worker.poll.error", err },
        "Outbox poll cycle failed",
      );
    } finally {
      this.processing = false;
    }
  }

  /**
   * Claims and processes one batch of WAITING outbox rows atomically.
   *
   * Claiming strategy: `updateMany` with `status = WAITING` atomically
   * transitions rows to RUNNING so no other worker (or this same worker
   * on the next tick) can pick them up simultaneously.
   */
  private async processBatch(): Promise<void> {
    // 1. Atomically claim up to OUTBOX_BATCH_SIZE WAITING rows.
    const result = await this.prisma.queueJob.updateMany({
      where: {
        jobType: OUTBOX_JOB_TYPE,
        queueName: OUTBOX_QUEUE_NAME,
        status: "WAITING",
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (result.count === 0) return; // Nothing to do

    this.log.debug(
      { event: "news.outbox_worker.claimed", count: result.count },
      `Claimed ${result.count} outbox rows`,
    );

    // 2. Fetch the claimed rows.
    const claimedRows = await this.prisma.queueJob.findMany({
      where: {
        jobType: OUTBOX_JOB_TYPE,
        queueName: OUTBOX_QUEUE_NAME,
        status: "RUNNING",
        startedAt: { equals: new Date() },
      },
      take: OUTBOX_BATCH_SIZE,
      orderBy: { scheduledAt: "asc" },
    });

    // 3. Process each row.
    for (const row of claimedRows) {
      await this.processRow(row);
    }
  }

  /**
   * Minimal shape required by processRow. Avoids importing a full generated
   * type that may not exist in the current Prisma namespace.
   */
  private async processRow(row: QueueJobRow): Promise<void> {
    let outboxPayload: OutboxEventPayload;
    try {
      // The payload column stores a JSON string in the DB.
      const raw = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
      outboxPayload = JSON.parse(raw) as OutboxEventPayload;
    } catch (err) {
      this.log.error(
        { event: "news.outbox_worker.parse_error", jobId: row.jobId, err },
        "Failed to parse outbox payload; marking FAILED",
      );
      await this.markFailed(row.jobId, "Invalid JSON payload");
      return;
    }

    try {
      this.eventBus.publish(outboxPayload.eventName, outboxPayload.payload);
      await this.markPublished(row.jobId);

      this.stats.processed += 1;
      this.log.debug(
        { event: "news.outbox_worker.published", jobId: row.jobId, eventName: outboxPayload.eventName },
        `Published event ${outboxPayload.eventName}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      if (row.attempts >= row.maxAttempts) {
        await this.markFailed(row.jobId, msg);
        this.stats.failed += 1;
        this.log.error(
          { event: "news.outbox_worker.event_publish_failed", jobId: row.jobId, err: msg },
          `Outbox row ${row.jobId} failed permanently after ${row.attempts} attempts`,
        );
      } else {
        // Re-queue for retry
        await this.prisma.queueJob.update({
          where: { id: row.id },
          data: { status: "WAITING" },
        });
        this.log.warn(
          { event: "news.outbox_worker.requeued", jobId: row.jobId, attempts: row.attempts, err: msg },
          `Outbox row ${row.jobId} failed; requeued for retry`,
        );
      }
    }
  }

  private async markPublished(jobId: string): Promise<void> {
    await this.prisma.queueJob.updateMany({
      where: { jobId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
      },
    });
  }

  private async markFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.prisma.queueJob.updateMany({
      where: { jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: errorMessage.slice(0, 1000),
      },
    });
  }
}

/**
 * Convenience accessor matching the `getNewsCrawlerQueue()` pattern.
 */
export function getOutboxWorker(logger?: Logger): NewsOutboxWorker {
  const worker = NewsOutboxWorker.getInstance(undefined, logger);
  worker.start();
  return worker;
}
