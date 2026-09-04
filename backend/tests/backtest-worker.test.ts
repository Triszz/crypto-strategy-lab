import { describe, expect, it, vi } from "vitest";
import { BacktestCompletionTracker } from "../src/modules/backtest/application/BacktestCompletionTracker";
import { BullMQBacktestQueue, getBullMQBacktestQueue } from "../src/modules/backtest/infrastructure/BullMQBacktestQueue";
import { BullMQBacktestWorker } from "../src/modules/backtest/infrastructure/BullMQBacktestWorker";
import { getEventBus } from "../src/shared/event-bus/EventBus";

describe("BullMQ Backtest Worker & Completion Tracker", () => {
  it("should initialize BullMQBacktestQueue instance cleanly", () => {
    const queue = getBullMQBacktestQueue();
    expect(queue).toBeInstanceOf(BullMQBacktestQueue);
  });

  it("should add job and return WAITING status progress object", async () => {
    const queue = getBullMQBacktestQueue();
    const progress = await queue.addJob({
      symbol: "BTCUSDT",
      timeframe: "1h",
      strategyName: "MA Crossover",
      initialCapital: 10000,
    });

    expect(progress.jobId).toBeDefined();
    expect(progress.status).toBe("WAITING");

    const fetched = queue.getJobProgress(progress.jobId);
    expect(fetched?.jobId).toBe(progress.jobId);
  });

  it("should process job in BullMQBacktestWorker and publish BacktestCompleted event", async () => {
    const worker = BullMQBacktestWorker.getInstance({ concurrency: 2 });
    const eventBus = getEventBus();

    let completedEventReceived = false;
    const handler = (payload: any) => {
      if (payload.symbol === "ETHUSDT") {
        completedEventReceived = true;
      }
    };
    eventBus.subscribe("BacktestCompleted", handler);

    const result = await worker.processJob("test-job-eth", {
      symbol: "ETHUSDT",
      timeframe: "15m",
      strategyName: "RSI",
      initialCapital: 5000,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.result).toBeDefined();
    expect(result.result?.symbol).toBe("ETHUSDT");
    expect(completedEventReceived).toBe(true);

    eventBus.unsubscribe("BacktestCompleted", handler);
  });

  it("should track candidate completion gracefully when candidateId is missing or valid", async () => {
    const tracker = new BacktestCompletionTracker();
    const result = await tracker.checkCompletionByCandidateId(undefined);

    expect(result.isCompleted).toBe(false);
    expect(result.finishedCount).toBe(0);
  });
});
