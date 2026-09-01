import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
import { EvaluatorEngine, EvaluationResultMetrics, TradeInput } from "../domain/evaluator.engine";

export interface StrategyEvaluatedPayload {
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

export class EvaluationService {
  private prisma = getPrismaClient();

  constructor(private readonly eventBus: EventBus = getEventBus()) {}

  public async evaluateExperiment(
    experimentId: string,
    strategyVersionId: string,
    symbolId: string,
    timeframe: string,
    trades: TradeInput[],
    initialCapital = 10000
  ): Promise<EvaluationResultMetrics> {
    const metrics = EvaluatorEngine.calculateMetrics(trades, initialCapital);

    // Save BacktestResult
    const fromTime = trades.length > 0 ? BigInt(trades[0].entryTime) : BigInt(Date.now());
    const toTime = trades.length > 0 ? BigInt(trades[trades.length - 1].exitTime || trades[trades.length - 1].entryTime) : BigInt(Date.now());

    await this.prisma.backtestResult.upsert({
      where: { experimentId },
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
        overallScore: metrics.overallScore,
        equityCurve: JSON.stringify(metrics.equityCurve),
      },
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
        overallScore: metrics.overallScore,
        equityCurve: JSON.stringify(metrics.equityCurve),
      },
    });

    // Save detailed EvaluationMetric records
    const metricEntries = [
      { metricCode: "TOTAL_RETURN", metricValue: metrics.totalReturn, metricGroup: "PROFITABILITY" },
      { metricCode: "WIN_RATE", metricValue: metrics.winRate, metricGroup: "PROFITABILITY" },
      { metricCode: "MAX_DRAWDOWN", metricValue: metrics.maxDrawdown, metricGroup: "RISK" },
      { metricCode: "SHARPE_RATIO", metricValue: metrics.sharpeRatio, metricGroup: "RISK" },
      { metricCode: "OVERALL_SCORE", metricValue: metrics.overallScore, metricGroup: "COMPOSITE" },
    ];

    for (const m of metricEntries) {
      await this.prisma.evaluationMetric.upsert({
        where: {
          experimentId_metricCode: {
            experimentId,
            metricCode: m.metricCode,
          },
        },
        update: {
          metricValue: m.metricValue,
          metricGroup: m.metricGroup,
        },
        create: {
          experimentId,
          metricCode: m.metricCode,
          metricValue: m.metricValue,
          metricGroup: m.metricGroup,
        },
      });
    }

    // Publish StrategyEvaluated event
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

    return metrics;
  }
}
