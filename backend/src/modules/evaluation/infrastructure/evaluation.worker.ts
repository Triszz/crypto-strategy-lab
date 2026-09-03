/**
 * BullMQ Evaluation Worker.
 *
 * Consumes jobs from the `"evaluation"` queue (enqueued by
 * `EvaluationService` when a `BacktestCompleted` event fires) and:
 *
 *  1. Reads trades from DB  (`prisma.trade.findMany({ experimentId })`).
 *  2. Reads the experiment record to obtain `initialCapital`, `symbolId`, etc.
 *  3. Loads evaluation config (weights + thresholds) from `EvaluationSetting`.
 *  4. Calls `EvaluatorEngine.calculateMetrics()` — a pure calculation with
 *     no IO, no Redis, no DB access.
 *  5. Persists results:
 *     - Upserts `BacktestResult` (calmarRatio, profitFactor + existing fields).
 *     - Upserts 8 rows in `EvaluationMetric` (one per metric code).
 *  6. Publishes `StrategyEvaluated` on the EventBus for the Leaderboard.
 *
 * Concurrency: 2 (configurable via env `EVAL_WORKER_CONCURRENCY`).
 * Retry: 3 attempts with exponential backoff — handled automatically by BullMQ
 *        based on the `defaultJobOptions` set in `evaluation.queue.ts`.
 * Idempotency: each job has `jobId = eval-${experimentId}` so a duplicate
 *              enqueue is rejected at the queue level.
 */

import { Worker, type Job } from "bullmq";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";
import { getRedisConnectionOptions } from "../../../shared/queue";
import { EvaluatorEngine, type TradeInput, type EvaluationResultMetrics } from "../domain/evaluator.engine";
import { getEvaluationQueue, EVALUATION_QUEUE_NAME, type EvaluationJobData, type EvaluationJobResult } from "./evaluation.queue";
import { getEvaluationConfig } from "./evaluation-settings.repo";

// ---------------------------------------------------------------------------
// Event payload (published after successful evaluation)
// ---------------------------------------------------------------------------

interface StrategyEvaluatedPayload {
  experimentId: string;
  strategyVersionId: string;
  symbolId: string;
  timeframe: string;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  numTrades: number;
  overallScore: number;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class BullMQEvaluationWorker {
  private static _instance: BullMQEvaluationWorker | null = null;
  private worker: Worker<EvaluationJobData, EvaluationJobResult> | null = null;
  private readonly prisma = getPrismaClient();
  private readonly eventBus = getEventBus();
  private isRunning = false;

  private constructor(concurrency = 2) {
    try {
      const connection = getRedisConnectionOptions();

      this.worker = new Worker<EvaluationJobData, EvaluationJobResult>(
        EVALUATION_QUEUE_NAME,
        (job: Job<EvaluationJobData, EvaluationJobResult>) => this.processJob(job),
        { connection, concurrency },
      );

      this.worker.on("completed", (job, result) => {
        logger.info(
          { jobId: job.id, experimentId: result.experimentId, durationMs: result.durationMs },
          "Evaluation job completed",
        );
      });

      this.worker.on("failed", (job, err) => {
        logger.error(
          { jobId: job?.id, experimentId: job?.data?.experimentId, err: err.message, attemptsMade: job?.attemptsMade },
          "Evaluation job failed",
        );
      });

      this.worker.on("error", (err: Error) => {
        logger.error({ err }, "BullMQ EvaluationWorker error");
      });

      logger.info({ queue: EVALUATION_QUEUE_NAME, concurrency }, "BullMQ EvaluationWorker initialised");

      // Clean stale jobs left over from previous server runs (non-blocking).
      void getEvaluationQueue().cleanStaleJobsOnBoot();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "EvaluationWorker Redis init failed; not consuming");
    }
  }

  public static getInstance(concurrency?: number): BullMQEvaluationWorker {
    if (!BullMQEvaluationWorker._instance) {
      const envConcurrency = parseInt(process.env.EVAL_WORKER_CONCURRENCY || "2", 10);
      BullMQEvaluationWorker._instance = new BullMQEvaluationWorker(concurrency ?? envConcurrency);
    }
    return BullMQEvaluationWorker._instance;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  public start(): void {
    if (this.isRunning) {
      logger.info("BullMQ EvaluationWorker already running");
      return;
    }
    this.isRunning = true;
    logger.info("BullMQ EvaluationWorker started and processing jobs");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      BullMQEvaluationWorker._instance = null;
      logger.info("BullMQ EvaluationWorker stopped");
    }
  }

  // ---------------------------------------------------------------------------
  // Job processor
  // ---------------------------------------------------------------------------

  private async processJob(job: Job<EvaluationJobData, EvaluationJobResult>): Promise<EvaluationJobResult> {
    const { experimentId } = job.data;
    const t0 = Date.now();

    logger.info(
      { jobId: job.id, experimentId, attempt: job.attemptsMade + 1 },
      "EvaluationWorker processing job",
    );

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ 🧮  EVALUATION WORKER: Bắt đầu tính metrics                        ║
    // ╚════════════════════════════════════════════════════════════════════╝
    console.log("\n\x1b[1m\x1b[35m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[1m\x1b[35m║  🧮  [EVALUATION-WORKER] Processing job                                  ║\x1b[0m");
    console.log("\x1b[1m\x1b[35m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
    console.log(`\x1b[1m\x1b[35m║  Job ID         : \x1b[0m${job.id}${" ".repeat(Math.max(0, 57 - String(job.id).length))}║`);
    console.log(`\x1b[1m\x1b[35m║  Experiment ID  : \x1b[1m\x1b[33m${experimentId}\x1b[0m\x1b[1m\x1b[35m${" ".repeat(Math.max(0, 57 - experimentId.length))}║\x1b[0m`);
    console.log(`\x1b[1m\x1b[35m║  Attempt        : \x1b[0m${job.attemptsMade + 1} / 3${" ".repeat(50)}║`);
    console.log("\x1b[1m\x1b[35m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
    console.log("\x1b[1m\x1b[35m║  ▶ Reading trades from DB…                                               ║\x1b[0m");

    // ── 1. Read trades from DB (single source of truth) ──────────────────
    const dbTrades = await this.prisma.trade.findMany({
      where: { experimentId },
      orderBy: { entryTime: "asc" },
    });

    if (dbTrades.length === 0) {
      // ─────────────────────────────────────────────────────────────────
      // Legitimate "no trades" state — NOT a system error.
      // Happens when the strategy's signal never fired in the requested
      // window (e.g. very new token like 0GUSDT, or strict multi-indicator
      // strategy like Domain-guided bollinger+RSI+support_resistance).
      // We persist a zeroed BacktestResult so the Leaderboard can still
      // rank "did-nothing" strategies (score 0) instead of hanging on
      // a retry loop that will never succeed.
      // ─────────────────────────────────────────────────────────────────
      console.log(`\x1b[1m\x1b[33m║  ⚠  Strategy produced 0 trades — persisting zero result & continuing\x1b[0m`);

      const experiment = await this.prisma.experiment.findUnique({
        where: { id: experimentId },
        include: { candidate: true },
      });

      if (!experiment) {
        throw new Error(`Experiment ${experimentId} not found in DB`);
      }

      const initialCapital = Number(experiment.initialCapital);
      const finalCapital = initialCapital; // no change
      const totalReturn = 0;
      const winRate = 0;
      const maxDrawdown = 0;
      const overallScore = 0; // explicit: no trades → no score

      const now = BigInt(Date.now());

      await this.prisma.backtestResult.upsert({
        where: { experimentId },
        create: {
          experimentId,
          symbolId: experiment.symbolId,
          timeframe: experiment.timeframe,
          fromTime: now,
          toTime: now,
          initialCapital,
          finalCapital,
          totalReturn,
          winRate,
          maxDrawdown,
          numTrades: 0,
          numWinningTrades: 0,
          numLosingTrades: 0,
          sharpeRatio: 0,
          sortinoRatio: 0,
          calmarRatio: 0,
          profitFactor: 0,
          overallScore,
          equityCurve: JSON.stringify([]),
        },
        update: {
          totalReturn,
          winRate,
          maxDrawdown,
          numTrades: 0,
          numWinningTrades: 0,
          numLosingTrades: 0,
          sharpeRatio: 0,
          sortinoRatio: 0,
          calmarRatio: 0,
          profitFactor: 0,
          overallScore,
          finalCapital: initialCapital,
          equityCurve: JSON.stringify([]),
        },
      });

      // Persist 8 metric rows (all zeros) so schema consistency is preserved.
      const emptyMetricEntries = [
        { code: "TOTAL_RETURN", value: 0, group: "PROFITABILITY" },
        { code: "WIN_RATE", value: 0, group: "PROFITABILITY" },
        { code: "MAX_DRAWDOWN", value: 0, group: "RISK" },
        { code: "SHARPE_RATIO", value: 0, group: "RISK" },
        { code: "SORTINO_RATIO", value: 0, group: "RISK" },
        { code: "CALMAR_RATIO", value: 0, group: "RISK" },
        { code: "PROFIT_FACTOR", value: 0, group: "PROFITABILITY" },
        { code: "OVERALL_SCORE", value: 0, group: "COMPOSITE" },
      ];

      await Promise.all(
        emptyMetricEntries.map((m) =>
          this.prisma.evaluationMetric.upsert({
            where: {
              experimentId_metricCode: { experimentId, metricCode: m.code },
            },
            create: {
              experimentId,
              metricCode: m.code,
              metricValue: m.value,
              metricGroup: m.group,
            },
            update: {
              metricValue: m.value,
              metricGroup: m.group,
            },
          }),
        ),
      );

      const strategyVersionId = experiment.candidate?.strategyVersionId ?? experimentId;

      // Still publish StrategyEvaluated so Leaderboard / FE see this entry.
      this.eventBus.publish("StrategyEvaluated", {
        experimentId,
        strategyVersionId,
        symbolId: experiment.symbolId,
        timeframe: experiment.timeframe,
        totalReturn,
        winRate,
        maxDrawdown,
        numTrades: 0,
        overallScore,
      });

      const durationMs = Date.now() - t0;
      logger.info(
        { jobId: job.id, experimentId, durationMs, numTrades: 0, empty: true },
        "Evaluation finished with zero trades (legitimate empty strategy)",
      );

      console.log("\n\x1b[1m\x1b[33m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m");
      console.log("\x1b[1m\x1b[33m║  ⚠  [EVALUATION-WORKER] Finished — 0 trades (no-op strategy)            ║\x1b[0m");
      console.log("\x1b[1m\x1b[33m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
      console.log(`\x1b[1m\x1b[33m║  Experiment ID  : \x1b[1m\x1b[33m${experimentId}\x1b[0m\x1b[1m\x1b[33m${" ".repeat(Math.max(0, 57 - experimentId.length))}║\x1b[0m`);
      console.log("\x1b[1m\x1b[33m║  💾 Saved BacktestResult (zeros) + 8 EvaluationMetric rows (zeros)     ║\x1b[0m");
      console.log("\x1b[1m\x1b[33m║  📣 Event published: StrategyEvaluated (overallScore = 0)              ║\x1b[0m");
      console.log("\x1b[1m\x1b[33m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m\n");

      return { experimentId, durationMs };
    }

    console.log(`\x1b[1m\x1b[35m║  ✓ Found \x1b[1m\x1b[33m${dbTrades.length}\x1b[0m\x1b[1m\x1b[35m trades in DB                                                  ║\x1b[0m`);
    console.log("\x1b[1m\x1b[35m║  ▶ Computing metrics via EvaluatorEngine…                                ║\x1b[0m");

    const trades: TradeInput[] = dbTrades.map((t) => ({
      entryTime: Number(t.entryTime),
      exitTime: Number(t.exitTime),
      entryPrice: Number(t.entryPrice),
      exitPrice: t.exitPrice != null ? Number(t.exitPrice) : undefined,
      quantity: Number(t.quantity),
      profitLoss: t.profitLoss != null ? Number(t.profitLoss) : undefined,
      profitLossPct: t.profitLossPct != null ? Number(t.profitLossPct) : undefined,
      side: t.side as "BUY" | "SELL",
      position: t.position as "LONG" | "SHORT",
    }));

    // ── 2. Read experiment to get initialCapital + metadata ────────────────
    const experiment = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { candidate: true },
    });

    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found in DB`);
    }

    const initialCapital = Number(experiment.initialCapital);
    const symbolId = experiment.symbolId;
    const timeframe = experiment.timeframe;

    // Resolve strategyVersionId from candidate or fall back to experimentId
    const strategyVersionId = experiment.candidate?.strategyVersionId ?? experimentId;

    // ── 3. Load evaluation config (weights, thresholds) ────────────────────
    const config = await getEvaluationConfig();

    // ── 4. Calculate metrics (pure function — no IO) ───────────────────────
    const metrics: EvaluationResultMetrics = EvaluatorEngine.calculateMetrics(
      trades,
      initialCapital,
      config.weights,
    );

    // ── 5. Persist BacktestResult ─────────────────────────────────────────
    const lastTrade = trades[trades.length - 1]!;
    const firstTrade = trades[0]!;
    const fromTime = BigInt(firstTrade.entryTime);
    const toTime = BigInt(lastTrade.exitTime ?? lastTrade.entryTime);

    await this.prisma.backtestResult.upsert({
      where: { experimentId },
      create: {
        experimentId,
        symbolId,
        timeframe,
        fromTime,
        toTime,
        initialCapital: metrics.initialCapital,
        finalCapital: metrics.finalCapital,
        totalReturn: metrics.totalReturn,
        winRate: metrics.winRate,
        maxDrawdown: metrics.maxDrawdown,
        numTrades: metrics.numTrades,
        numWinningTrades: metrics.numWinningTrades,
        numLosingTrades: metrics.numLosingTrades,
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        profitFactor: metrics.profitFactor,
        overallScore: metrics.overallScore,
        equityCurve: JSON.stringify(metrics.equityCurve),
      },
      update: {
        symbolId,
        timeframe,
        fromTime,
        toTime,
        initialCapital: metrics.initialCapital,
        finalCapital: metrics.finalCapital,
        totalReturn: metrics.totalReturn,
        winRate: metrics.winRate,
        maxDrawdown: metrics.maxDrawdown,
        numTrades: metrics.numTrades,
        numWinningTrades: metrics.numWinningTrades,
        numLosingTrades: metrics.numLosingTrades,
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        profitFactor: metrics.profitFactor,
        overallScore: metrics.overallScore,
        equityCurve: JSON.stringify(metrics.equityCurve),
      },
    });

    // ── 6. Persist 8 EvaluationMetric rows ────────────────────────────────
    const metricEntries = [
      { code: "TOTAL_RETURN", value: metrics.totalReturn, group: "PROFITABILITY" },
      { code: "WIN_RATE", value: metrics.winRate, group: "PROFITABILITY" },
      { code: "MAX_DRAWDOWN", value: metrics.maxDrawdown, group: "RISK" },
      { code: "SHARPE_RATIO", value: metrics.sharpeRatio, group: "RISK" },
      { code: "SORTINO_RATIO", value: metrics.sortinoRatio, group: "RISK" },
      { code: "CALMAR_RATIO", value: metrics.calmarRatio, group: "RISK" },
      { code: "PROFIT_FACTOR", value: metrics.profitFactor, group: "PROFITABILITY" },
      { code: "OVERALL_SCORE", value: metrics.overallScore, group: "COMPOSITE" },
    ];

    await Promise.all(
      metricEntries.map((m) =>
        this.prisma.evaluationMetric.upsert({
          where: {
            experimentId_metricCode: { experimentId, metricCode: m.code },
          },
          create: {
            experimentId,
            metricCode: m.code,
            metricValue: m.value,
            metricGroup: m.group,
          },
          update: {
            metricValue: m.value,
            metricGroup: m.group,
          },
        }),
      ),
    );

    // ── 7. Publish StrategyEvaluated event for Leaderboard ────────────────
    const payload: StrategyEvaluatedPayload = {
      experimentId,
      strategyVersionId,
      symbolId,
      timeframe,
      totalReturn: metrics.totalReturn,
      winRate: metrics.winRate,
      maxDrawdown: metrics.maxDrawdown,
      numTrades: metrics.numTrades,
      overallScore: metrics.overallScore,
    };

    this.eventBus.publish("StrategyEvaluated", payload);

    const durationMs = Date.now() - t0;
    logger.info({ jobId: job.id, experimentId, durationMs, numTrades: metrics.numTrades }, "Evaluation job finished");

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ ✅  EVALUATION WORKER: Hoàn tất — đã lưu BacktestResult + Metrics  ║
    // ╚════════════════════════════════════════════════════════════════════╝
    const retStr = metrics.totalReturn.toFixed(2);
    const wrStr = metrics.winRate.toFixed(2);
    const mddStr = metrics.maxDrawdown.toFixed(2);
    const sharpeStr = metrics.sharpeRatio.toFixed(3);
    const sortinoStr = metrics.sortinoRatio.toFixed(3);
    const calmarStr = metrics.calmarRatio.toFixed(3);
    const pfStr = metrics.profitFactor.toFixed(3);
    const scoreStr = metrics.overallScore.toFixed(2);

    console.log("\n\x1b[1m\x1b[32m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m");
    console.log("\x1b[1m\x1b[32m║  ✅  [EVALUATION-WORKER] Job finished                                    ║\x1b[0m");
    console.log("\x1b[1m\x1b[32m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
    console.log(`\x1b[1m\x1b[32m║  Experiment ID  : \x1b[1m\x1b[33m${experimentId}\x1b[0m\x1b[1m\x1b[32m${" ".repeat(Math.max(0, 57 - experimentId.length))}║\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m║  Job ID         : \x1b[0m${job.id}${" ".repeat(Math.max(0, 57 - String(job.id).length))}║`);
    console.log(`\x1b[1m\x1b[32m║  Duration       : \x1b[1m\x1b[33m${durationMs}ms\x1b[0m\x1b[1m\x1b[32m${" ".repeat(Math.max(0, 53 - String(durationMs).length))}║\x1b[0m`);
    console.log("\x1b[1m\x1b[32m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
    console.log("\x1b[1m\x1b[32m║  📊  METRICS                                                            ║\x1b[0m");
    console.log("\x1b[1m\x1b[32m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
    console.log(`\x1b[1m\x1b[32m║   ▸ Total Return   : \x1b[1m\x1b[33m${retStr.padStart(8)}%\x1b[0m\x1b[1m\x1b[32m   ▸ Win Rate    : \x1b[1m\x1b[33m${wrStr.padStart(8)}%\x1b[0m\x1b[1m\x1b[32m   ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m║   ▸ Max Drawdown   : \x1b[1m\x1b[33m${mddStr.padStart(8)}%\x1b[0m\x1b[1m\x1b[32m   ▸ # Trades    : \x1b[1m\x1b[33m${String(metrics.numTrades).padStart(8)}\x1b[0m\x1b[1m\x1b[32m   ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m║   ▸ Sharpe Ratio   : \x1b[1m\x1b[33m${sharpeStr.padStart(8)}\x1b[0m\x1b[1m\x1b[32m   ▸ Sortino     : \x1b[1m\x1b[33m${sortinoStr.padStart(8)}\x1b[0m\x1b[1m\x1b[32m   ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m║   ▸ Calmar Ratio   : \x1b[1m\x1b[33m${calmarStr.padStart(8)}\x1b[0m\x1b[1m\x1b[32m   ▸ Profit F.   : \x1b[1m\x1b[33m${pfStr.padStart(8)}\x1b[0m\x1b[1m\x1b[32m   ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m║   ▸ \x1b[1m\x1b[33m⭐ OVERALL SCORE\x1b[0m\x1b[1m\x1b[32m    : \x1b[1m\x1b[33m${scoreStr.padStart(8)} / 100\x1b[0m\x1b[1m\x1b[32m${" ".repeat(36)}║\x1b[0m`);
    console.log("\x1b[1m\x1b[32m╠══════════════════════════════════════════════════════════════════════════╣\x1b[0m");
    console.log("\x1b[1m\x1b[32m║  💾 Saved to:                                                           ║\x1b[0m");
    console.log("\x1b[1m\x1b[32m║     ▸ backtest_results    (1 row upserted)                              ║\x1b[0m");
    console.log("\x1b[1m\x1b[32m║     ▸ evaluation_metrics  (8 rows upserted)                             ║\x1b[0m");
    console.log("\x1b[1m\x1b[32m║  📣 Event published: StrategyEvaluated → Leaderboard                   ║\x1b[0m");
    console.log("\x1b[1m\x1b[32m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m\n");

    return { experimentId, durationMs };
  }
}

// ---------------------------------------------------------------------------
// Module-level accessor
// ---------------------------------------------------------------------------

export function getEvaluationWorker(concurrency?: number): BullMQEvaluationWorker {
  return BullMQEvaluationWorker.getInstance(concurrency);
}
