import { logger } from "../../../shared/logger/logger";
import type { RunBacktestParams } from "./BacktestService";
import type { BacktestJobProgress } from "../infrastructure/BacktestQueue";
import { getBacktestWorker } from "../infrastructure/BacktestWorker";
import type { BacktestResultDomain } from "../domain/types";

export interface CandidateExecutionParams {
  candidateId: string;
  strategyName: string;
  symbol?: string;
  timeframe?: string;
  initialCapital?: number;
  feePercent?: number;
  slippageBps?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
}

export interface CandidateExecutionResult {
  candidateId: string;
  jobId?: string;
  experimentId?: string;
  status: "COMPLETED" | "FAILED" | "QUEUED";
  result?: BacktestResultDomain;
  error?: string;
}

export class SearchExecutionService {
  public async executeCandidateBacktest(
    params: CandidateExecutionParams
  ): Promise<CandidateExecutionResult> {
    logger.info(
      { candidateId: params.candidateId, strategyName: params.strategyName },
      "Executing candidate backtest in SearchExecutionService"
    );

    try {
      const runParams: RunBacktestParams = {
        symbol: params.symbol || "BTCUSDT",
        timeframe: params.timeframe || "5m",
        strategyName: params.strategyName,
        initialCapital: params.initialCapital || 10000,
        feePercent: params.feePercent ?? 0.08,
        slippageBps: params.slippageBps ?? 5,
        stopLossPct: params.stopLossPct,
        takeProfitPct: params.takeProfitPct,
      };

      const worker = getBacktestWorker();
      const jobId = `cand-${params.candidateId}-${Date.now()}`;
      const progress: BacktestJobProgress = await worker.processJob(jobId, runParams);

      if (progress.status === "COMPLETED" && progress.result) {
        return {
          candidateId: params.candidateId,
          jobId,
          experimentId: progress.result.experimentId,
          status: "COMPLETED",
          result: progress.result.result,
        };
      }

      return {
        candidateId: params.candidateId,
        jobId,
        status: "FAILED",
        error: progress.error || "Candidate backtest execution failed",
      };
    } catch (err: any) {
      logger.error({ err, candidateId: params.candidateId }, "SearchExecutionService candidate backtest error");
      return {
        candidateId: params.candidateId,
        status: "FAILED",
        error: err.message || "Failed to execute candidate backtest",
      };
    }
  }

  /**
   * Executes backtesting for a batch of candidate strategies in parallel/sequence.
   */
  public async executeBatchBacktests(
    candidates: CandidateExecutionParams[]
  ): Promise<CandidateExecutionResult[]> {
    logger.info({ count: candidates.length }, "Executing batch candidate backtests");
    const results: CandidateExecutionResult[] = [];

    for (const candidate of candidates) {
      const res = await this.executeCandidateBacktest(candidate);
      results.push(res);
    }

    return results;
  }
}

let searchExecutionInstance: SearchExecutionService | null = null;

export function getSearchExecutionService(): SearchExecutionService {
  if (!searchExecutionInstance) {
    searchExecutionInstance = new SearchExecutionService();
  }
  return searchExecutionInstance;
}
