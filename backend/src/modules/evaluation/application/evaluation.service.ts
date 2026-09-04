/**
 * Evaluation Service (v2 — BullMQ).
 *
 * This service's ONLY responsibility is to bridge the EventBus and the
 * BullMQ evaluation queue: when a `BacktestCompleted` event fires, it
 * enqueues an evaluation job. All actual computation, DB writes, and
 * event publishing is handled by `BullMQEvaluationWorker` (a separate
 * consumer of the `"evaluation"` queue).
 *
 * This design keeps the service thin and decoupled — the worker can run
 * in a different process and scale independently without any changes here.
 *
 * Architecture:
 *   BacktestCompleted (EventBus)
 *       │
 *       ▼
 *   EvaluationService  ──enqueue──►  BullMQ "evaluation" queue
 *                                          │
 *                                          ▼
 *                                   BullMQEvaluationWorker
 *                                          │
 *                                          ├── Read trades from DB
 *                                          ├── Load config from DB
 *                                          ├── Calculate metrics (pure)
 *                                          ├── Upsert BacktestResult
 *                                          ├── Upsert EvaluationMetric × 8
 *                                          └── Publish StrategyEvaluated
 */

import { getEventBus, type EventBus } from "../../../shared/event-bus/EventBus";
import { getEvaluationQueue } from "../infrastructure/evaluation.queue";
import { logger } from "../../../shared/logger/logger";

// ---------------------------------------------------------------------------
// Payload shape that BacktestWorker publishes on BacktestCompleted
// ---------------------------------------------------------------------------

interface BacktestCompletedPayload {
  experimentId: string;
  jobId?: string;
  candidateId?: string;
  symbol?: string;
  timeframe?: string;
  strategyName?: string;
  metrics?: {
    initialCapital?: number;
    [key: string]: unknown;
  };
  trades?: unknown[];
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EvaluationService {
  private readonly evaluationQueue = getEvaluationQueue();

  constructor(private readonly eventBus: EventBus = getEventBus()) {
    this.eventBus.subscribe<BacktestCompletedPayload>("BacktestCompleted", (payload) => {
      if (!payload?.experimentId) {
        logger.warn({ payload }, "[EvaluationService] Received BacktestCompleted with no experimentId; ignoring");
        return;
      }

      // ╔════════════════════════════════════════════════════════════════════╗
      // ║ 📥  EVALUATION SERVICE: Nhận được event BacktestCompleted          ║
      // ╚════════════════════════════════════════════════════════════════════╝
      console.log("\n\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m");
      console.log("\x1b[1m\x1b[36m║  📥  [EVALUATION-SERVICE] Received BacktestCompleted event              ║\x1b[0m");
      console.log("\x1b[1m\x1b[36m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
      console.log(`\x1b[1m\x1b[36m║  Experiment ID : \x1b[1m\x1b[33m${payload.experimentId}\x1b[0m\x1b[1m\x1b[36m${" ".repeat(Math.max(0, 56 - payload.experimentId.length))}║\x1b[0m`);
      console.log(`\x1b[1m\x1b[36m║  Job ID        : \x1b[0m${payload.jobId ?? "N/A"}${" ".repeat(Math.max(0, 56 - (payload.jobId?.length ?? 3)))}║`);
      console.log(`\x1b[1m\x1b[36m║  Candidate ID  : \x1b[0m${payload.candidateId ?? "N/A"}${" ".repeat(Math.max(0, 56 - (payload.candidateId?.length ?? 3)))}║`);
      console.log(`\x1b[1m\x1b[36m║  Symbol        : \x1b[1m\x1b[33m${payload.symbol ?? "?"}\x1b[0m\x1b[1m\x1b[36m  Timeframe: \x1b[1m\x1b[33m${payload.timeframe ?? "?"}\x1b[0m\x1b[1m\x1b[36m${" ".repeat(Math.max(0, 26 - (payload.symbol?.length ?? 1) - (payload.timeframe?.length ?? 1)))}║\x1b[0m`);
      console.log(`\x1b[1m\x1b[36m║  Strategy      : \x1b[0m${payload.strategyName ?? "?"}${" ".repeat(Math.max(0, 56 - (payload.strategyName?.length ?? 1)))}║`);
      console.log("\x1b[1m\x1b[36m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
      console.log(`\x1b[1m\x1b[36m║  ▶ Enqueuing evaluation job (jobId = eval-${payload.experimentId})${" ".repeat(Math.max(0, 24 - payload.experimentId.length))}║\x1b[0m`);
      console.log("\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m\n");

      logger.info(
        {
          tag: "[EVALUATION-SERVICE]",
          experimentId: payload.experimentId,
          jobId: payload.jobId,
          symbol: payload.symbol,
          timeframe: payload.timeframe,
          strategyName: payload.strategyName,
        },
        "BacktestCompleted received; enqueuing evaluation",
      );

      void this.handleBacktestCompleted(payload);
    });

    logger.info("EvaluationService initialised — listening for BacktestCompleted events");
  }

  /**
   * Extracts `experimentId` from the event payload and enqueues an evaluation
   * job into the `"evaluation"` BullMQ queue.
   *
   * This method is intentionally fire-and-forget — we do NOT await the
   * result here. The worker processes the job asynchronously and publishes
   * `StrategyEvaluated` when it is done.
   */
  private handleBacktestCompleted(payload: BacktestCompletedPayload): void {
    const { experimentId, jobId } = payload;

    logger.debug(
      { experimentId, jobId, symbol: payload.symbol, timeframe: payload.timeframe },
      "BacktestCompleted received; enqueuing evaluation",
    );

    void this.evaluationQueue.enqueue(experimentId)
      .then(() => {
        console.log(`\x1b[1m\x1b[32m   ✅ [EVALUATION-SERVICE] Enqueued successfully → waiting for EvaluationWorker\x1b[0m\n`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`\x1b[1m\x1b[31m   ❌ [EVALUATION-SERVICE] FAILED to enqueue: ${message}\x1b[0m\n`);
        logger.error({ err: message, experimentId }, "Failed to enqueue evaluation job");
      });
  }
}
