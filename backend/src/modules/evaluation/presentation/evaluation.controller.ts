/**
 * Evaluation Controller.
 *
 * Handles HTTP endpoints for the Evaluation module:
 *  - GET  /evaluation/:experimentId  — fetch computed metrics for a backtest run
 *  - GET  /evaluation/:experimentId/queue  — fetch BullMQ job status for an experiment
 *
 * The controller delegates to `getEvaluationQueue()` which is a thin wrapper around
 * the BullMQ queue singleton. It does NOT contain business logic — that lives
 * in `BullMQEvaluationWorker`.
 */

import { type Request, type Response } from "express";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEvaluationQueue, type BullMQEvaluationQueue as EvaluationQueue } from "../infrastructure/evaluation.queue";
import type { ApiResponse } from "../../../shared/types";

export class EvaluationController {
  private readonly prisma = getPrismaClient();

  /**
   * GET /api/evaluation/:experimentId
   *
   * Returns all evaluation data for a single experiment:
   *  - The `BacktestResult` row (all 10+ computed metrics + equity curve)
   *  - The `EvaluationMetric` rows grouped by group (PROFITABILITY / RISK / COMPOSITE)
   *  - The `EvaluationSetting` values that were used (or defaults)
   *
   * Responds 404 if no result has been computed yet.
   */
  public getMetrics = async (req: Request, res: Response): Promise<void> => {
    const { experimentId } = req.params;

    if (!experimentId) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "MISSING_EXPERIMENT_ID", message: "experimentId path parameter is required" },
      };
      res.status(400).json(response);
      return;
    }

    try {
      const [backtestResult, evaluationMetrics] = await Promise.all([
        this.prisma.backtestResult.findUnique({ where: { experimentId } }),
        this.prisma.evaluationMetric.findMany({
          where: { experimentId },
          orderBy: { metricCode: "asc" },
        }),
      ]);

      if (!backtestResult) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: "EVALUATION_NOT_FOUND",
            message: `No evaluation result found for experimentId=${experimentId}. The backtest may not have completed yet.`,
          },
        };
        res.status(404).json(response);
        return;
      }

      // Group metrics by group name
      const metricsByGroup = evaluationMetrics.reduce<Record<string, Record<string, number>>>(
        (acc, m) => {
          const group = m.metricGroup ?? "OTHER";
          if (!acc[group]) acc[group] = {};
          acc[group]![m.metricCode] = Number(m.metricValue);
          return acc;
        },
        {},
      );

      const data = {
        experimentId: backtestResult.experimentId,
        symbolId: backtestResult.symbolId,
        timeframe: backtestResult.timeframe,
        fromTime: backtestResult.fromTime.toString(),
        toTime: backtestResult.toTime.toString(),
        initialCapital: Number(backtestResult.initialCapital),
        finalCapital: Number(backtestResult.finalCapital),
        metrics: {
          totalReturn: Number(backtestResult.totalReturn),
          winRate: Number(backtestResult.winRate),
          maxDrawdown: Number(backtestResult.maxDrawdown),
          sharpeRatio: backtestResult.sharpeRatio != null ? Number(backtestResult.sharpeRatio) : null,
          sortinoRatio: backtestResult.sortinoRatio != null ? Number(backtestResult.sortinoRatio) : null,
          calmarRatio: backtestResult.calmarRatio != null ? Number(backtestResult.calmarRatio) : null,
          profitFactor: backtestResult.profitFactor != null ? Number(backtestResult.profitFactor) : null,
          overallScore: Number(backtestResult.overallScore),
          numTrades: backtestResult.numTrades,
          numWinningTrades: backtestResult.numWinningTrades,
          numLosingTrades: backtestResult.numLosingTrades,
        },
        metricsByGroup,
        equityCurve:
          typeof backtestResult.equityCurve === "string"
            ? JSON.parse(backtestResult.equityCurve)
            : backtestResult.equityCurve,
        evaluatedAt: backtestResult.createdAt.toISOString(),
        createdAt: backtestResult.createdAt.toISOString(),
      };

      const response: ApiResponse<typeof data> = {
        success: true,
        data,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "EVALUATION_FETCH_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };

  /**
   * GET /api/evaluation/:experimentId/queue
   *
   * Returns the current BullMQ job status for the given experiment.
   * Useful for polling the UI to know when evaluation has finished.
   *
   * Returns 404 if no job has ever been enqueued for this experiment.
   */
  public getQueueStatus = async (req: Request, res: Response): Promise<void> => {
    const { experimentId } = req.params;

    if (!experimentId) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "MISSING_EXPERIMENT_ID", message: "experimentId path parameter is required" },
      };
      res.status(400).json(response);
      return;
    }

    try {
      const queue: EvaluationQueue = getEvaluationQueue();

      if (!queue.isReady()) {
        const response: ApiResponse<null> = {
          success: false,
          error: {
            code: "QUEUE_UNAVAILABLE",
            message: "BullMQ evaluation queue is not connected. Redis may be unavailable.",
          },
        };
        res.status(503).json(response);
        return;
      }

      const jobId = `eval-${experimentId}`;
      const [counts, job] = await Promise.all([
        queue.getJobCounts(),
        queue.getJob(jobId),
      ]);

      const jobState = job ? await job.getState() : null;

      const data = {
        experimentId,
        jobId,
        queueName: queue.getQueueName(),
        counts: {
          waiting: counts.waiting,
          active: counts.active,
          completed: counts.completed,
          failed: counts.failed,
          delayed: counts.delayed,
        },
        job: job
          ? {
              id: job.id,
              status: jobState,
              progress: typeof job.progress === "number" ? job.progress : null,
              attemptsMade: job.attemptsMade,
              createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
              finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
              failedReason: job.failedReason,
            }
          : null,
      };

      const response: ApiResponse<typeof data> = {
        success: true,
        data,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "QUEUE_STATUS_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };
}
