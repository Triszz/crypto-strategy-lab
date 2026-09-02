import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
import { EvaluatorEngine, EvaluationResultMetrics, TradeInput, EvaluationWeights } from "../domain/evaluator.engine";
import { logger } from "../../../shared/logger/logger";

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

  constructor(private readonly eventBus: EventBus = getEventBus()) {
    this.registerEventListener();
  }

  private registerEventListener(): void {
    this.eventBus.subscribe<{
      experimentId: string;
      symbol: string;
      timeframe: string;
      strategyName: string;
      metrics: any;
    }>("BacktestCompleted", (payload) => {
      void this.handleBacktestCompleted(payload);
    });
  }

  private async handleBacktestCompleted(payload: {
    experimentId: string;
    symbol: string;
    timeframe: string;
    strategyName: string;
    metrics: any;
  }): Promise<void> {
    if (!payload || !payload.experimentId) return;

    try {
      let strategyVersionId = payload.experimentId;
      let symbolId = payload.symbol;

      // 1. Resolve or create StrategyVersion in DB
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.experimentId);
      const exp = isUuid
        ? await this.prisma.experiment.findUnique({
            where: { id: payload.experimentId },
            include: { candidate: true },
          })
        : null;

      if (exp?.candidate?.strategyVersionId) {
        strategyVersionId = exp.candidate.strategyVersionId;
      } else {
        let ver = await this.prisma.strategyVersion.findFirst({
          where: { name: payload.strategyName },
        });

        if (!ver) {
          let def = await this.prisma.strategyDefinition.findFirst();
          if (!def) {
            def = await this.prisma.strategyDefinition.create({
              data: { type: "BASE", family: "TREND", description: "Default strategy definition" },
            });
          }
          ver = await this.prisma.strategyVersion.create({
            data: {
              definitionId: def.id,
              version: "1.0.0",
              name: payload.strategyName,
              implementationRef: `Strategy.${payload.strategyName.replace(/\s+/g, "")}`,
            },
          });
        }
        strategyVersionId = ver.id;
      }

      // 2. Resolve or create Symbol in DB
      let sym = await this.prisma.symbol.findFirst({
        where: { symbol: payload.symbol },
      });

      if (!sym) {
        sym = await this.prisma.symbol.create({
          data: {
            symbol: payload.symbol,
            baseAsset: payload.symbol.replace("USDT", ""),
            quoteAsset: "USDT",
          },
        });
      }
      symbolId = sym.id;

      // 3. Fetch trades from DB or use payload trades
      const dbTrades = await this.prisma.trade.findMany({
        where: { experimentId: payload.experimentId },
      });

      const tradesInput: TradeInput[] = dbTrades.length > 0
        ? dbTrades.map((t) => ({
            entryTime: Number(t.entryTime),
            exitTime: Number(t.exitTime),
            entryPrice: Number(t.entryPrice),
            exitPrice: Number(t.exitPrice),
            direction: (t.position as "LONG" | "SHORT") || "LONG",
            profitLoss: Number(t.profitLoss),
            profitLossPct: Number(t.profitLossPct),
          }))
        : (payload.trades || []).map((t: any) => ({
            entryTime: Number(t.entryTime || Date.now()),
            exitTime: Number(t.exitTime || Date.now()),
            entryPrice: Number(t.entryPrice || 0),
            exitPrice: Number(t.exitPrice || 0),
            direction: (t.direction as "LONG" | "SHORT") || "LONG",
            profitLoss: Number(t.profitLoss || 0),
            profitLossPct: Number(t.profitLossPct || 0),
          }));

      await this.evaluateExperiment(
        payload.experimentId,
        strategyVersionId,
        symbolId,
        payload.timeframe,
        tradesInput,
        payload.metrics?.initialCapital || 10000
      );
    } catch (err) {
      logger.warn({ err }, "[EvaluationService] Error handling BacktestCompleted event");
    }
  }

  public async evaluateExperiment(
    experimentId: string,
    strategyVersionId: string,
    symbolId: string,
    timeframe: string,
    trades: TradeInput[],
    initialCapital = 10000,
    weights?: EvaluationWeights
  ): Promise<EvaluationResultMetrics> {
    const metrics = EvaluatorEngine.calculateMetrics(trades, initialCapital, weights);

    // Save BacktestResult if DB is connected
    try {
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
        { metricCode: "SORTINO_RATIO", metricValue: metrics.sortinoRatio, metricGroup: "RISK" },
        { metricCode: "CALMAR_RATIO", metricValue: metrics.calmarRatio, metricGroup: "RISK" },
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
    } catch (err) {
      logger.warn({ err }, "[EvaluationService] Could not persist evaluation to DB; skipping DB save");
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
