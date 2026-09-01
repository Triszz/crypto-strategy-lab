import { describe, expect, it } from "vitest";
import { getBacktestWorker } from "../src/modules/backtest/infrastructure/BacktestWorker";
import { getSearchExecutionService } from "../src/modules/backtest/application/SearchExecutionService";
import { getBacktestQueue } from "../src/modules/backtest/infrastructure/BacktestQueue";

describe("BacktestWorker & SearchExecutionService Integration", () => {
  it("BacktestWorker should process a run job successfully and return completed progress", async () => {
    const worker = getBacktestWorker();
    worker.start();

    const jobId = `test-job-${Date.now()}`;
    const result = await worker.processJob(jobId, {
      symbol: "BTCUSDT",
      timeframe: "5m",
      strategyName: "MA Crossover",
      initialCapital: 10000,
    });

    expect(result.jobId).toBe(jobId);
    expect(result.status).toBe("COMPLETED");
    expect(result.progress).toBe(100);
    expect(result.result).toBeDefined();
    expect(result.result.result.metrics.initialCapital).toBe(10000);
    expect(result.result.result.trades).toBeDefined();
  });

  it("SearchExecutionService should execute candidate backtest", async () => {
    const searchExec = getSearchExecutionService();

    const res = await searchExec.executeCandidateBacktest({
      candidateId: "cand-001",
      strategyName: "RSI Momentum",
      symbol: "ETHUSDT",
      timeframe: "15m",
    });

    expect(res.candidateId).toBe("cand-001");
    expect(res.status).toBe("COMPLETED");
    expect(res.result).toBeDefined();
    expect(res.result?.metrics.initialCapital).toBe(10000);
  });

  it("SearchExecutionService should process batch candidates backtesting", async () => {
    const searchExec = getSearchExecutionService();

    const results = await searchExec.executeBatchBacktests([
      { candidateId: "cand-101", strategyName: "MA Crossover" },
      { candidateId: "cand-102", strategyName: "Bollinger Bands" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("COMPLETED");
    expect(results[1].status).toBe("COMPLETED");
  });

  it("BacktestQueue should add jobs and retrieve progress", async () => {
    const queue = getBacktestQueue();
    const progress = await queue.addJob({
      symbol: "SOLUSDT",
      timeframe: "1h",
      strategyName: "MA Crossover",
    });

    expect(progress.jobId).toBeDefined();
    expect(progress.status).toBe("WAITING");

    const fetchedProgress = queue.getJobProgress(progress.jobId);
    expect(fetchedProgress).toBeDefined();
  });
});
