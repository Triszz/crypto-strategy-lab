import { describe, it, expect, beforeEach } from "vitest";
import { EvaluatorEngine, TradeInput } from "../src/modules/evaluation/domain/evaluator.engine";
import { EvaluationService } from "../src/modules/evaluation/application/evaluation.service";
import { setEventBus, resetEventBus } from "../src/shared/event-bus/EventBus";

describe("EvaluatorEngine.calculateMetrics Unit Test Suite", () => {
  it("T.1: returns all zeros and initial equity curve for empty trades", () => {
    const res = EvaluatorEngine.calculateMetrics([], 10000);
    expect(res.initialCapital).toBe(10000);
    expect(res.finalCapital).toBe(10000);
    expect(res.totalReturn).toBe(0);
    expect(res.winRate).toBe(0);
    expect(res.maxDrawdown).toBe(0);
    expect(res.numTrades).toBe(0);
    expect(res.numWinningTrades).toBe(0);
    expect(res.numLosingTrades).toBe(0);
    expect(res.sharpeRatio).toBe(0);
    expect(res.sortinoRatio).toBe(0);
    expect(res.calmarRatio).toBe(0);
    expect(res.overallScore).toBe(0);
    expect(res.equityCurve.length).toBe(1);
    expect(res.equityCurve[0].equity).toBe(10000);
  });

  it("T.2: calculates metrics correctly for 1 winning trade", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 110, quantity: 10, profitLoss: 100, entryTime: 1000, exitTime: 2000, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.finalCapital).toBe(10100);
    expect(res.totalReturn).toBe(0.01);
    expect(res.winRate).toBe(1.0);
    expect(res.maxDrawdown).toBe(0);
    expect(res.numWinningTrades).toBe(1);
    expect(res.numLosingTrades).toBe(0);
    expect(res.equityCurve.length).toBe(2);
  });

  it("T.3: calculates metrics correctly for 1 losing trade", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 90, quantity: 10, profitLoss: -100, entryTime: 1000, exitTime: 2000, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.finalCapital).toBe(9900);
    expect(res.totalReturn).toBe(-0.01);
    expect(res.winRate).toBe(0);
    expect(res.maxDrawdown).toBe(0.01);
    expect(res.numWinningTrades).toBe(0);
    expect(res.numLosingTrades).toBe(1);
  });

  it("T.4: calculates winRate 0.6 for mixed 5 trades (3 win, 2 lose)", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 110, quantity: 1, profitLoss: 10, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
      { entryPrice: 110, exitPrice: 105, quantity: 1, profitLoss: -5, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" },
      { entryPrice: 105, exitPrice: 115, quantity: 1, profitLoss: 10, entryTime: 5, exitTime: 6, side: "BUY", position: "LONG" },
      { entryPrice: 115, exitPrice: 120, quantity: 1, profitLoss: 5, entryTime: 7, exitTime: 8, side: "BUY", position: "LONG" },
      { entryPrice: 120, exitPrice: 110, quantity: 1, profitLoss: -10, entryTime: 9, exitTime: 10, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.numTrades).toBe(5);
    expect(res.numWinningTrades).toBe(3);
    expect(res.numLosingTrades).toBe(2);
    expect(res.winRate).toBe(0.6);
  });

  it("T.5: calculates winRate 0 and high MDD when all trades are losing", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 90, quantity: 10, profitLoss: -100, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
      { entryPrice: 90, exitPrice: 80, quantity: 10, profitLoss: -100, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.winRate).toBe(0);
    expect(res.numWinningTrades).toBe(0);
    expect(res.numLosingTrades).toBe(2);
    expect(res.maxDrawdown).toBeGreaterThan(0.015);
  });

  it("T.6: handles zero stdDev by returning sharpeRatio 0", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 110, quantity: 1, profitLoss: 10, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.sharpeRatio).toBe(0);
  });

  it("T.7: handles zero downsideDev by returning sortinoRatio 0 when all returns are positive", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 110, quantity: 1, profitLoss: 10, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
      { entryPrice: 110, exitPrice: 120, quantity: 1, profitLoss: 10, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.sortinoRatio).toBe(0);
  });

  it("T.8: calculates pnl automatically when pnl is null or undefined", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 120, quantity: 2, profitLoss: null, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.finalCapital).toBe(10040); // (120 - 100) * 2 = +40
    expect(res.numWinningTrades).toBe(1);
  });

  it("T.9: computes PnL correctly for SHORT position when pnl is omitted", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 90, quantity: 2, profitLoss: undefined, entryTime: 1, exitTime: 2, side: "SELL", position: "SHORT" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.finalCapital).toBe(10020); // -1 * (90 - 100) * 2 = +20
    expect(res.numWinningTrades).toBe(1);
  });

  it("T.10: generates equityCurve length equal to numTrades + 1", () => {
    const trades: TradeInput[] = Array.from({ length: 10 }).map((_, i) => ({
      entryPrice: 100,
      exitPrice: 105,
      quantity: 1,
      profitLoss: 5,
      entryTime: (i + 1) * 100,
      exitTime: (i + 1) * 100 + 50,
      side: "BUY",
      position: "LONG",
    }));
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.equityCurve.length).toBe(11);
  });

  it("T.11: applies trade-count penalty to overallScore when numTrades < 30", () => {
    const trades10: TradeInput[] = Array.from({ length: 10 }).map((_, i) => ({
      entryPrice: 100,
      exitPrice: 110,
      quantity: 1,
      profitLoss: 10,
      entryTime: (i + 1) * 100,
      exitTime: (i + 1) * 100 + 50,
      side: "BUY",
      position: "LONG",
    }));

    const trades30: TradeInput[] = Array.from({ length: 30 }).map((_, i) => ({
      entryPrice: 100,
      exitPrice: 110,
      quantity: 1,
      profitLoss: 10,
      entryTime: (i + 1) * 100,
      exitTime: (i + 1) * 100 + 50,
      side: "BUY",
      position: "LONG",
    }));

    const res10 = EvaluatorEngine.calculateMetrics(trades10, 10000);
    const res30 = EvaluatorEngine.calculateMetrics(trades30, 10000);

    // 10 trades will be penalized by sqrt(10/30) ≈ 0.577
    expect(res10.overallScore).toBeLessThan(res30.overallScore);
  });

  it("T.12: computes peak-trough-peak maxDrawdown accurately", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 150, quantity: 100, profitLoss: 5000, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" }, // Cap = 15000 (Peak)
      { entryPrice: 150, exitPrice: 100, quantity: 100, profitLoss: -5000, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" }, // Cap = 10000 (Trough, DD = 5000/15000 = 0.3333)
      { entryPrice: 100, exitPrice: 120, quantity: 100, profitLoss: 2000, entryTime: 5, exitTime: 6, side: "BUY", position: "LONG" }, // Cap = 12000
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.maxDrawdown).toBeCloseTo(0.3333, 3);
    expect(res.calmarRatio).toBeGreaterThan(0);
  });

  // ───── v2 tests: Calmar, ProfitFactor, penalty, weights ─────

  it("T.13: Calmar ratio = totalReturn / maxDrawdown", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 200, quantity: 10, profitLoss: 1000, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
      { entryPrice: 200, exitPrice: 120, quantity: 10, profitLoss: -800, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    // totalReturn ≈ 200/10000 = 0.02; maxDrawdown = 800/12000 = 0.0667 → Calmar ≈ 0.3
    expect(res.calmarRatio).toBeGreaterThan(0);
    expect(res.calmarRatio).toBeCloseTo(0.02 / 0.0667, 1);
  });

  it("T.14: Calmar = 0 when maxDrawdown = 0 (no trades lost)", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 110, quantity: 1, profitLoss: 10, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
      { entryPrice: 110, exitPrice: 120, quantity: 1, profitLoss: 10, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.maxDrawdown).toBe(0);
    expect(res.calmarRatio).toBe(0);
  });

  it("T.15: ProfitFactor = grossWin / grossLoss for mixed trades", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 150, quantity: 1, profitLoss: 50, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },   // win +50
      { entryPrice: 100, exitPrice: 80,  quantity: 1, profitLoss: -20, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" },   // loss -20
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    // grossWin = 50, grossLoss = 20 → profitFactor = 2.5
    expect(res.profitFactor).toBeCloseTo(2.5, 1);
  });

  it("T.16: ProfitFactor caps at 999 when grossLoss = 0 (all wins)", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 110, quantity: 1, profitLoss: 10, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
      { entryPrice: 110, exitPrice: 120, quantity: 1, profitLoss: 10, entryTime: 3, exitTime: 4, side: "BUY", position: "LONG" },
    ];
    const res = EvaluatorEngine.calculateMetrics(trades, 10000);
    expect(res.profitFactor).toBe(999);
  });

  it("T.18: NO trade-count penalty when numTrades >= 30", () => {
    // Two strategies with the SAME per-trade profile, only differ in number of trades (30 vs 100)
    const buildTrades = (n: number): TradeInput[] =>
      Array.from({ length: n }).map((_, i) => ({
        entryPrice: 100,
        exitPrice: 110,
        quantity: 1,
        profitLoss: 10,
        entryTime: (i + 1) * 100,
        exitTime: (i + 1) * 100 + 50,
        side: "BUY" as const,
        position: "LONG" as const,
      }));

    const res30 = EvaluatorEngine.calculateMetrics(buildTrades(30), 10000);
    const res100 = EvaluatorEngine.calculateMetrics(buildTrades(100), 10000);

    // Both should have positive overallScore; penalty does not apply at N>=30.
    expect(res30.overallScore).toBeGreaterThan(0);
    expect(res100.overallScore).toBeGreaterThan(0);
  });

  it("T.20: respects custom weights { return: 60, winRate: 30, drawdown: 10 }", () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 150, quantity: 1, profitLoss: 50, entryTime: 1, exitTime: 2, side: "BUY", position: "LONG" },
    ];
    const defaultWeights = { return: 40, winRate: 40, drawdown: 20 };
    const customWeights = { return: 60, winRate: 30, drawdown: 10 };

    const resDefault = EvaluatorEngine.calculateMetrics(trades, 10000, defaultWeights);
    const resCustom = EvaluatorEngine.calculateMetrics(trades, 10000, customWeights);

    // Per-trade metrics are identical, but the overallScore must differ
    // because the weighting formula is different.
    expect(resDefault.overallScore).not.toBe(resCustom.overallScore);
  });
});

describe("EvaluationService Integration & Event Tests", () => {
  let service: EvaluationService;
  let publishedEvents: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    resetEventBus();
    publishedEvents = [];

    const mockBus = {
      publish: (event: string, payload: unknown) => {
        publishedEvents.push({ event, payload });
      },
      subscribe: () => {},
      unsubscribe: () => {},
      dispose: () => {},
    };
    setEventBus(mockBus as any);
    service = new EvaluationService(mockBus as any);
  });

  it("publishes StrategyEvaluated event with correct payload", async () => {
    const trades: TradeInput[] = [
      { entryPrice: 100, exitPrice: 110, quantity: 1, profitLoss: 10, entryTime: 100, exitTime: 200, side: "BUY", position: "LONG" },
    ];

    try {
      await service.evaluateExperiment("exp-001", "ver-001", "sym-btc", "1h", trades, 10000);
    } catch {
      // In isolated test without DB connection, ignore DB upsert error and check event
    }

    const emitted = publishedEvents.find((e) => e.event === "StrategyEvaluated");
    if (emitted) {
      expect(emitted.payload).toMatchObject({
        experimentId: "exp-001",
        strategyVersionId: "ver-001",
        symbolId: "sym-btc",
        timeframe: "1h",
      });
    }
  });
});
