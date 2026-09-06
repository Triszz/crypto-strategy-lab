import { describe, expect, it } from "vitest";
import { Backtester } from "../src/modules/backtest/domain/Backtester";
import type { CandleData, StrategySignalFunction } from "../src/modules/backtest/domain/types";

describe("Backtester Domain Engine", () => {
  const backtester = new Backtester();

  // Create sample candles (10 candles)
  const sampleCandles: CandleData[] = Array.from({ length: 10 }, (_, i) => ({
    openTime: 1700000000000 + i * 60000,
    closeTime: 1700000000000 + (i + 1) * 60000 - 1,
    open: 100 + i * 2,
    high: 105 + i * 2,
    low: 98 + i * 2,
    close: 102 + i * 2,
    volume: 1000,
  }));

  it("should return empty result when candle array is empty", () => {
    const result = backtester.run([], () => "HOLD", { initialCapital: 5000 });
    expect(result.metrics.initialCapital).toBe(5000);
    expect(result.metrics.finalCapital).toBe(5000);
    expect(result.metrics.numTrades).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it("should simulate BUY signal and SELL signal correctly", () => {
    // Buy at index 1 (close = 104), Sell at index 5 (close = 112)
    const mockSignalFn: StrategySignalFunction = (_candles, index) => {
      if (index === 1) return "BUY";
      if (index === 5) return "SELL";
      return "HOLD";
    };

    const result = backtester.run(sampleCandles, mockSignalFn, {
      initialCapital: 10000,
      feePercent: 0.1, // 0.1%
      slippageBps: 0, // 0 bps for deterministic math
    });

    expect(result.metrics.initialCapital).toBe(10000);
    expect(result.metrics.numTrades).toBeGreaterThanOrEqual(1);
    expect(result.trades[0].direction).toBe("LONG");
    expect(result.trades[0].entryPrice).toBe(104); // candle index 1 close
    expect(result.trades[0].exitPrice).toBe(112); // candle index 5 close
    expect(result.trades[0].profitLoss).toBeGreaterThan(0);
    expect(result.metrics.winRate).toBe(66.67);
  });

  it("should trigger Stop Loss exit when price drops", () => {
    const droppingCandles: CandleData[] = [
      { openTime: 1000, closeTime: 1999, open: 100, high: 102, low: 99, close: 100, volume: 100 },
      { openTime: 2000, closeTime: 2999, open: 100, high: 100, low: 90, close: 90, volume: 100 },
    ];

    const mockSignalFn: StrategySignalFunction = (_candles, index) => {
      if (index === 0) return "BUY";
      return "HOLD";
    };

    const result = backtester.run(droppingCandles, mockSignalFn, {
      initialCapital: 1000,
      stopLossPct: 5.0, // 5% stop loss
      feePercent: 0,
      slippageBps: 0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("STOP_LOSS");
    expect(result.trades[0].exitPrice).toBe(95); // 100 * (1 - 0.05)
    expect(result.metrics.numLosingTrades).toBe(1);
  });

  it("should trigger SIGNAL_REVERSAL exit when signal changes from BUY to SELL", () => {
    const mockSignalFn: StrategySignalFunction = (_candles, index) => {
      if (index === 0) return "BUY";
      if (index === 3) return "SELL";
      return "HOLD";
    };

    const result = backtester.run(sampleCandles, mockSignalFn, {
      initialCapital: 10000,
      feePercent: 0,
      slippageBps: 0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("SIGNAL_REVERSAL");
  });

  it("should close position with END_OF_DATA exit when candles run out", () => {
    const mockSignalFn: StrategySignalFunction = (_candles, index) => {
      if (index === 0) return "BUY";
      return "HOLD";
    };

    const result = backtester.run(sampleCandles, mockSignalFn, {
      initialCapital: 10000,
      feePercent: 0,
      slippageBps: 0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("END_OF_DATA");
  });

  it("should trigger intra-bar Stop Loss when candle low reaches SL price even if close recovers", () => {
    const candles: CandleData[] = [
      { openTime: 1000, closeTime: 1999, open: 100, high: 100, low: 100, close: 100, volume: 100 },
      // Candle 2: low drops to 94 (triggering 5% SL at 95), but close recovers to 98
      { openTime: 2000, closeTime: 2999, open: 100, high: 101, low: 94, close: 98, volume: 100 },
    ];

    const mockSignalFn: StrategySignalFunction = (_candles, index) => {
      if (index === 0) return "BUY";
      return "HOLD";
    };

    const result = backtester.run(candles, mockSignalFn, {
      initialCapital: 1000,
      stopLossPct: 5.0,
      feePercent: 0,
      slippageBps: 0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("STOP_LOSS");
    expect(result.trades[0].exitPrice).toBe(95);
  });

  it("should trigger intra-bar Take Profit when candle high reaches TP price even if close retraces", () => {
    const candles: CandleData[] = [
      { openTime: 1000, closeTime: 1999, open: 100, high: 100, low: 100, close: 100, volume: 100 },
      // Candle 2: high spikes to 112 (triggering 10% TP at 110), but close retraces to 103
      { openTime: 2000, closeTime: 2999, open: 100, high: 112, low: 99, close: 103, volume: 100 },
    ];

    const mockSignalFn: StrategySignalFunction = (_candles, index) => {
      if (index === 0) return "BUY";
      return "HOLD";
    };

    const result = backtester.run(candles, mockSignalFn, {
      initialCapital: 1000,
      takeProfitPct: 10.0,
      feePercent: 0,
      slippageBps: 0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("TAKE_PROFIT");
    expect(result.trades[0].exitPrice).toBe(110);
  });

  it("should trigger intra-bar Stop Loss and Take Profit correctly for SHORT position", () => {
    const candles: CandleData[] = [
      { openTime: 1000, closeTime: 1999, open: 100, high: 100, low: 100, close: 100, volume: 100 },
      // Candle 2: high spikes to 106 (triggering 5% SL at 105 for SHORT)
      { openTime: 2000, closeTime: 2999, open: 100, high: 106, low: 98, close: 99, volume: 100 },
    ];

    const mockSignalFn: StrategySignalFunction = (_candles, index) => {
      if (index === 0) return "SELL";
      return "HOLD";
    };

    const result = backtester.run(candles, mockSignalFn, {
      initialCapital: 1000,
      positionType: "SHORT",
      stopLossPct: 5.0,
      feePercent: 0,
      slippageBps: 0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].direction).toBe("SHORT");
    expect(result.trades[0].exitReason).toBe("STOP_LOSS");
    expect(result.trades[0].exitPrice).toBe(105);
  });
});
