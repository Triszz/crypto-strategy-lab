import type { Request, Response } from "express";
import { getPrismaClient } from "../../../infrastructure/database";
import { logger } from "../../../shared/logger/logger";
import { BacktestService } from "../application/BacktestService";
import { getBacktestQueue } from "../infrastructure/BacktestQueue";

const backtestService = new BacktestService();
const backtestQueue = getBacktestQueue();

/**
 * Controller handling HTTP requests for the Backtesting engine.
 */
export class BacktestController {
  /**
   * POST /api/backtests/run
   * Triggers a backtest job asynchronously via BacktestQueue or executes synchronously if requested.
   *
   * Accepts either:
   *   - candidateId (UUID of a CandidateStrategy from Search) → candidate-driven backtest
   *   - strategyName (string, legacy) → name-based backtest
   *
   * symbol / timeframe are optional overrides. When `candidateId` is
   * supplied WITHOUT explicit symbol/timeframe, the controller passes
   * `undefined` so `runBacktest` falls through to the candidate's
   * SearchRun values. The defaults below only apply when no candidateId
   * is provided (the legacy strategyName path).
   */
  public async runBacktest(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const candidateId = body.candidateId as string | undefined;

      // If candidateId is supplied, only override symbol/timeframe when the
      // caller explicitly passed them — otherwise the candidate's own
      // SearchRun values should win.
      const symbol =
        body.symbol ?? (candidateId ? undefined : "BTCUSDT");
      const timeframe =
        body.timeframe ?? (candidateId ? undefined : "5m");
      const strategyName = body.strategyName ?? "MA Crossover";
      const initialCapital = body.initialCapital ?? 10000;
      const feePercent = body.feePercent ?? 0.08;
      const slippageBps = body.slippageBps ?? 5;
      const stopLossPct = body.stopLossPct;
      const takeProfitPct = body.takeProfitPct;
      const sync = body.sync ?? false;

      const fromTime = body.fromTime ? Number(body.fromTime) : undefined;
      const toTime = body.toTime ? Number(body.toTime) : undefined;

      const params = {
        candidateId,
        symbol,
        timeframe,
        strategyName,
        initialCapital: Number(initialCapital),
        feePercent: Number(feePercent),
        slippageBps: Number(slippageBps),
        fromTime,
        toTime,
        stopLossPct: stopLossPct !== undefined ? Number(stopLossPct) : undefined,
        takeProfitPct: takeProfitPct !== undefined ? Number(takeProfitPct) : undefined,
      };

      if (sync) {
        const result = await backtestService.runBacktest(params);
        res.status(200).json({
          success: true,
          data: result,
        });
        return;
      }

      const jobProgress = await backtestQueue.addJob(params);
      res.status(202).json({
        success: true,
        data: jobProgress,
      });
    } catch (err: any) {
      logger.error({ err }, "Error running backtest endpoint");
      res.status(500).json({
        success: false,
        error: { code: "BACKTEST_ERROR", message: err.message || "Failed to execute backtest" },
      });
    }
  }

  /**
   * GET /api/backtests/jobs/:jobId
   * Gets real-time progress and status of a queued backtest job.
   */
  public async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const jobId = req.params.jobId || "";
      const job = backtestQueue.getJobProgress(jobId);

      if (!job) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: `Backtest job '${jobId}' not found` },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: job,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: "JOB_STATUS_ERROR", message: err.message },
      });
    }
  }

  /**
   * GET /api/backtests/:id
   * Retrieves full result of an experiment by ID.
   */
  public async getBacktestById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const prisma = getPrismaClient();

      const experiment = await prisma.experiment.findUnique({
        where: { id },
        include: {
          backtestResult: true,
          trades: true,
        },
      });

      if (!experiment) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: `Backtest experiment '${id}' not found` },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: experiment,
      });
    } catch (err: any) {
      logger.error({ err, id: req.params.id }, "Error fetching backtest by ID");
      res.status(500).json({
        success: false,
        error: { code: "FETCH_ERROR", message: err.message },
      });
    }
  }

  /**
   * GET /api/backtests/:id/trades
   * Fetches trade list for an experiment.
   */
  public async getTradesByExperimentId(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const prisma = getPrismaClient();

      const trades = await prisma.trade.findMany({
        where: { experimentId: id },
        orderBy: { entryTime: "asc" },
      });

      res.status(200).json({
        success: true,
        data: trades,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: "TRADES_FETCH_ERROR", message: err.message },
      });
    }
  }

  /**
   * GET /api/backtests
   * Lists recent backtest experiments.
   */
  public async listBacktests(_req: Request, res: Response): Promise<void> {
    try {
      const prisma = getPrismaClient();

      const experiments = await prisma.experiment.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          backtestResult: true,
        },
      });

      res.status(200).json({
        success: true,
        data: experiments,
      });
    } catch (err: any) {
      logger.error({ err }, "Error listing backtests");
      res.status(500).json({
        success: false,
        error: { code: "LIST_ERROR", message: err.message },
      });
    }
  }
}
