import { logger } from "../../../shared/logger/logger";
import { BacktestService, type RunBacktestParams } from "../application/BacktestService";

export interface BacktestJobData {
  jobId: string;
  params: RunBacktestParams;
  createdAt: string;
}

export interface BacktestJobProgress {
  jobId: string;
  progress: number;
  status: "WAITING" | "RUNNING" | "COMPLETED" | "FAILED";
  result?: any;
  error?: string;
}

export class BacktestQueue {
  private static instance: BacktestQueue | null = null;
  private readonly backtestService: BacktestService;
  private readonly jobProgressMap: Map<string, BacktestJobProgress>;

  private constructor() {
    this.backtestService = new BacktestService();
    this.jobProgressMap = new Map();
  }

  public static getInstance(): BacktestQueue {
    if (!BacktestQueue.instance) {
      BacktestQueue.instance = new BacktestQueue();
    }
    return BacktestQueue.instance;
  }

  /**
   * Adds a backtest job to the async queue.
   */
  public async addJob(params: RunBacktestParams): Promise<BacktestJobProgress> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const jobProgress: BacktestJobProgress = {
      jobId,
      progress: 0,
      status: "WAITING",
    };

    this.jobProgressMap.set(jobId, jobProgress);

    // Process job asynchronously on next tick
    setImmediate(() => {
      this.processJob(jobId, params).catch((err) => {
        logger.error({ err, jobId }, "Error processing backtest queue job");
      });
    });

    return jobProgress;
  }

  /**
   * Checks current job status and progress.
   */
  public getJobProgress(jobId: string): BacktestJobProgress | null {
    return this.jobProgressMap.get(jobId) || null;
  }

  /**
   * Processes the backtest job in steps to simulate progress feedback.
   */
  private async processJob(jobId: string, params: RunBacktestParams): Promise<void> {
    const job = this.jobProgressMap.get(jobId);
    if (!job) return;

    try {
      job.status = "RUNNING";
      job.progress = 20;

      await new Promise((res) => setTimeout(res, 150));
      job.progress = 50;

      // Execute actual backtest calculation
      const output = await this.backtestService.runBacktest(params);

      job.progress = 90;
      await new Promise((res) => setTimeout(res, 100));

      job.progress = 100;
      job.status = "COMPLETED";
      job.result = output;
      logger.info({ jobId, experimentId: output.experimentId }, "Backtest job completed successfully");
    } catch (err: any) {
      job.status = "FAILED";
      job.error = err.message || "Unknown backtest job error";
      logger.error({ err, jobId }, "Backtest job failed");
    }
  }
}

export function getBacktestQueue(): BacktestQueue {
  return BacktestQueue.getInstance();
}
