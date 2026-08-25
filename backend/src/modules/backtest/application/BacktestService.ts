import { getPrismaClient } from "../../../infrastructure/database";
import { getEventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";
import { Backtester } from "../domain/Backtester";
import type {
  BacktestOptions,
  BacktestResultDomain,
  CandleData,
  StrategySignalFunction,
} from "../domain/types";

export interface RunBacktestParams {
  symbol?: string;
  timeframe?: string;
  strategyName?: string;
  initialCapital?: number;
  feePercent?: number;
  slippageBps?: number;
  fromTime?: number;
  toTime?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
}

export class BacktestService {
  private readonly backtester: Backtester;

  constructor() {
    this.backtester = new Backtester();
  }

  /**
   * Executes backtest simulation, persists results (if DB available), and emits BacktestCompleted event.
   */
  public async runBacktest(params: RunBacktestParams): Promise<{
    experimentId: string;
    symbol: string;
    timeframe: string;
    strategyName: string;
    result: BacktestResultDomain;
  }> {
    const symbol = params.symbol || "BTCUSDT";
    const timeframe = params.timeframe || "5m";
    const strategyName = params.strategyName || "MA Crossover";
    const initialCapital = params.initialCapital || 10000;

    logger.info(
      { symbol, timeframe, strategyName, initialCapital },
      "Starting backtest simulation"
    );

    // 1. Fetch historical candles by symbol & timeframe or generate fixture candles
    const candles = await this.getHistoricalCandles(symbol, timeframe, params.fromTime, params.toTime);

    // 2. Select strategy signal function
    const signalFn = this.getStrategySignalFunction(strategyName);

    // 3. Execute core backtest simulation
    const options: BacktestOptions = {
      initialCapital,
      feePercent: params.feePercent ?? 0.08,
      slippageBps: params.slippageBps ?? 5,
      stopLossPct: params.stopLossPct,
      takeProfitPct: params.takeProfitPct,
    };

    const result = this.backtester.run(candles, signalFn, options);

    // 4. Save to Database (safely handled with try/catch fallback)
    const experimentId = await this.saveToDatabaseSafely(symbol, timeframe, strategyName, result, options);

    // 5. Emit BacktestCompleted event for downstream services (Leaderboard, Evaluator, FE WS)
    try {
      getEventBus().publish("BacktestCompleted", {
        experimentId,
        symbol,
        timeframe,
        strategyName,
        metrics: result.metrics,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ err }, "Failed to publish BacktestCompleted event");
    }

    return {
      experimentId,
      symbol,
      timeframe,
      strategyName,
      result,
    };
  }

  /**
   * Helper to retrieve candles from DB by timeframe or fallback to fixture generation.
   */
  private async getHistoricalCandles(
    symbol: string,
    timeframeStr: string,
    fromTime?: number,
    toTime?: number
  ): Promise<CandleData[]> {
    try {
      const prisma = getPrismaClient();
      const dbSymbol = await prisma.symbol.findUnique({ where: { symbol } });
      const dbTf = await prisma.timeframe.findUnique({ where: { code: timeframeStr } });

      if (dbSymbol && dbTf) {
        const dbCandles = await prisma.candle.findMany({
          where: {
            symbolId: dbSymbol.id,
            timeframeId: dbTf.id,
            openTime: {
              gte: fromTime ? BigInt(fromTime) : undefined,
              lte: toTime ? BigInt(toTime) : undefined,
            },
          },
          orderBy: { openTime: "asc" },
          take: 500,
        });

        if (dbCandles.length >= 10) {
          return dbCandles.map((c) => ({
            openTime: Number(c.openTime),
            closeTime: Number(c.closeTime),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume),
          }));
        }
      }
    } catch (err) {
      logger.warn({ err, timeframe: timeframeStr }, "Could not load candles from DB; falling back to fixture data");
    }

    return this.generateFixtureCandles(100, timeframeStr);
  }

  /**
   * Generates realistic synthetic candle data matching the requested timeframe interval.
   */
  private generateFixtureCandles(count: number, timeframeStr: string): CandleData[] {
    const candles: CandleData[] = [];
    let currentPrice = 68000;

    // Convert timeframe to milliseconds
    const intervalMs = this.parseTimeframeToMs(timeframeStr);
    const startTime = Date.now() - count * intervalMs;

    for (let i = 0; i < count; i++) {
      const openTime = startTime + i * intervalMs;
      const closeTime = openTime + intervalMs - 1;
      const change = (Math.random() - 0.48) * 150;
      const open = currentPrice;
      const close = Math.max(1000, open + change);
      const high = Math.max(open, close) + Math.random() * 50;
      const low = Math.min(open, close) - Math.random() * 50;
      const volume = Math.round(10 + Math.random() * 200);

      currentPrice = close;
      candles.push({ openTime, closeTime, open, high, low, close, volume });
    }

    return candles;
  }

  private parseTimeframeToMs(tf: string): number {
    const unit = tf.slice(-1);
    const num = parseInt(tf.slice(0, -1), 10) || 1;
    if (unit === "m") return num * 60 * 1000;
    if (unit === "h") return num * 60 * 60 * 1000;
    if (unit === "d") return num * 24 * 60 * 60 * 1000;
    return 5 * 60 * 1000; // default 5m
  }

  /**
   * Returns strategy signal logic based on strategy name.
   */
  private getStrategySignalFunction(strategyName: string): StrategySignalFunction {
    const nameLower = strategyName.toLowerCase();

    if (nameLower.includes("rsi")) {
      return (candles, index) => {
        if (index < 14) return "HOLD";
        let gains = 0;
        let losses = 0;
        for (let k = index - 13; k <= index; k++) {
          const curr = candles[k];
          const prev = candles[k - 1];
          if (!curr || !prev) continue;
          const diff = curr.close - prev.close;
          if (diff >= 0) gains += diff;
          else losses += Math.abs(diff);
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - 100 / (1 + rs);

        if (rsi < 30) return "BUY";
        if (rsi > 70) return "SELL";
        return "HOLD";
      };
    }

    if (nameLower.includes("bollinger")) {
      return (candles, index) => {
        if (index < 20) return "HOLD";
        const slice = candles.slice(index - 19, index + 1);
        const sum = slice.reduce((acc, c) => acc + c.close, 0);
        const mean = sum / 20;
        const variance = slice.reduce((acc, c) => acc + Math.pow(c.close - mean, 2), 0) / 20;
        const stdDev = Math.sqrt(variance);
        const lowerBand = mean - 2 * stdDev;
        const upperBand = mean + 2 * stdDev;

        const currentCandle = candles[index];
        if (!currentCandle) return "HOLD";
        const currentClose = currentCandle.close;
        if (currentClose <= lowerBand) return "BUY";
        if (currentClose >= upperBand) return "SELL";
        return "HOLD";
      };
    }

    // Default: MA Crossover (Fast MA 9 vs Slow MA 21)
    return (candles, index) => {
      if (index < 21) return "HOLD";
      const fastMAPrev = candles.slice(index - 9, index).reduce((acc, c) => acc + c.close, 0) / 9;
      const fastMACurr = candles.slice(index - 8, index + 1).reduce((acc, c) => acc + c.close, 0) / 9;

      const slowMAPrev = candles.slice(index - 21, index).reduce((acc, c) => acc + c.close, 0) / 21;
      const slowMACurr = candles.slice(index - 20, index + 1).reduce((acc, c) => acc + c.close, 0) / 21;

      if (fastMAPrev <= slowMAPrev && fastMACurr > slowMACurr) {
        return "BUY";
      }
      if (fastMAPrev >= slowMAPrev && fastMACurr < slowMACurr) {
        return "SELL";
      }
      return "HOLD";
    };
  }

  /**
   * Safely attempts DB persistence.
   */
  private async saveToDatabaseSafely(
    symbolStr: string,
    timeframe: string,
    strategyName: string,
    result: BacktestResultDomain,
    options: BacktestOptions
  ): Promise<string> {
    const fallbackId = `exp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      const prisma = getPrismaClient();

      const symbol = await prisma.symbol.upsert({
        where: { symbol: symbolStr },
        update: {},
        create: { symbol: symbolStr, baseAsset: symbolStr.replace("USDT", ""), quoteAsset: "USDT" },
      });

      let version = await prisma.strategyVersion.findFirst({
        where: { name: strategyName },
      });

      if (!version) {
        let def = await prisma.strategyDefinition.findFirst();
        if (!def) {
          def = await prisma.strategyDefinition.create({
            data: { type: "BASE", family: "TREND", description: "Default strategy definition" },
          });
        }

        version = await prisma.strategyVersion.create({
          data: {
            definitionId: def.id,
            version: "1.0.0",
            name: strategyName,
            implementationRef: `Strategy.${strategyName.replace(/\s+/g, "")}`,
          },
        });
      }

      const searchRun = await prisma.searchRun.create({
        data: {
          algorithmId: (await this.getOrCreateDefaultAlgorithm()).id,
          symbolId: symbol.id,
          timeframe,
          maxCandidates: 1,
          status: "DONE",
        },
      });

      const candidate = await prisma.candidateStrategy.create({
        data: {
          searchRunId: searchRun.id,
          strategyVersionId: version.id,
          status: "DONE",
        },
      });

      const firstEquity = result.equityCurve[0];
      const lastEquity = result.equityCurve[result.equityCurve.length - 1];

      const experiment = await prisma.experiment.create({
        data: {
          candidateId: candidate.id,
          name: `Backtest ${strategyName} on ${symbolStr} ${timeframe}`,
          symbolId: symbol.id,
          timeframe,
          fromTime: BigInt(firstEquity ? firstEquity.timestamp : Date.now()),
          toTime: BigInt(lastEquity ? lastEquity.timestamp : Date.now()),
          initialCapital: options.initialCapital ?? 10000,
          positionSize: options.positionSizePct ?? 1.0,
          status: "DONE",
          finishedAt: new Date(),
        },
      });

      await prisma.backtestResult.create({
        data: {
          experimentId: experiment.id,
          symbolId: symbol.id,
          timeframe,
          fromTime: BigInt(firstEquity ? firstEquity.timestamp : Date.now()),
          toTime: BigInt(lastEquity ? lastEquity.timestamp : Date.now()),
          initialCapital: result.metrics.initialCapital,
          finalCapital: result.metrics.finalCapital,
          totalReturn: result.metrics.totalReturn,
          winRate: result.metrics.winRate,
          maxDrawdown: result.metrics.maxDrawdown,
          numTrades: result.metrics.numTrades,
          numWinningTrades: result.metrics.numWinningTrades,
          numLosingTrades: result.metrics.numLosingTrades,
          overallScore: result.metrics.overallScore,
          equityCurve: result.equityCurve as any,
        },
      });

      for (const t of result.trades) {
        await prisma.trade.create({
          data: {
            experimentId: experiment.id,
            symbolId: symbol.id,
            side: t.direction === "LONG" ? "BUY" : "SELL",
            position: t.direction,
            entryTime: BigInt(t.entryTime),
            entryPrice: t.entryPrice,
            exitTime: BigInt(t.exitTime),
            exitPrice: t.exitPrice,
            quantity: t.quantity,
            profitLoss: t.profitLoss,
            profitLossPct: t.profitLossPct,
            entryReason: t.entryReason,
            exitReason: t.exitReason,
          },
        });
      }

      return experiment.id;
    } catch (err) {
      logger.warn({ err }, "Could not persist backtest experiment to DB; returning in-memory experiment ID");
      return fallbackId;
    }
  }

  private async getOrCreateDefaultAlgorithm() {
    const prisma = getPrismaClient();
    const existing = await prisma.searchAlgorithm.findFirst();
    if (existing) return existing;
    return prisma.searchAlgorithm.create({
      data: {
        code: "GRID_SEARCH",
        name: "Grid Search Algorithm",
        implementationRef: "Search.GridSearch",
      },
    });
  }
}
