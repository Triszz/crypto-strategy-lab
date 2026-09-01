import type {
  BacktestOptions,
  BacktestResultDomain,
  CandleData,
  EquityPoint,
  PositionType,
  SimulatedTrade,
  StrategySignalFunction,
} from "./types";

export class Backtester {
  /**
   * Executes backtest simulation over candles using a strategy signal generator.
   */
  public run(
    candles: CandleData[],
    signalFn: StrategySignalFunction,
    options: BacktestOptions = {}
  ): BacktestResultDomain {
    if (!candles || candles.length === 0) {
      return this.createEmptyResult(options.initialCapital ?? 10000);
    }

    const initialCapital = options.initialCapital ?? 10000;
    const positionSizePct = options.positionSizePct ?? 1.0;
    const defaultPositionType = options.positionType ?? "LONG";
    const feePercent = options.feePercent ?? 0.08;
    const slippageBps = options.slippageBps ?? 5;
    const stopLossPct = options.stopLossPct;
    const takeProfitPct = options.takeProfitPct;

    const slippageMultiplier = slippageBps / 10000;
    const feeMultiplier = feePercent / 100;

    let currentCapital = initialCapital;
    let peakCapital = initialCapital;
    let maxDrawdown = 0;

    const trades: SimulatedTrade[] = [];
    const firstCandle = candles[0];
    const equityCurve: EquityPoint[] = [
      {
        timestamp: firstCandle ? firstCandle.openTime : Date.now(),
        capital: currentCapital,
        drawdownPct: 0,
      },
    ];

    interface ActivePosition {
      entryTime: number;
      entryPrice: number;
      effectiveEntryPrice: number;
      quantity: number;
      direction: "LONG" | "SHORT";
      allocatedCapital: number;
      entryFee: number;
      entryReason: string;
    }

    let activePosition: ActivePosition | null = null;
    let tradeCounter = 0;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      if (!candle) continue;

      const signal = signalFn(candles, i);

      // 1. Check if active position hits StopLoss / TakeProfit during the candle
      if (activePosition) {
        let exitTriggered = false;
        let exitPrice = candle.close;
        let exitReason = "SIGNAL";

        const currentPrice = candle.close;
        const pnlPct =
          activePosition.direction === "LONG"
            ? ((currentPrice - activePosition.entryPrice) / activePosition.entryPrice) * 100
            : ((activePosition.entryPrice - currentPrice) / activePosition.entryPrice) * 100;

        if (stopLossPct !== undefined && pnlPct <= -Math.abs(stopLossPct)) {
          exitTriggered = true;
          const slPrice =
            activePosition.direction === "LONG"
              ? activePosition.entryPrice * (1 - Math.abs(stopLossPct) / 100)
              : activePosition.entryPrice * (1 + Math.abs(stopLossPct) / 100);
          exitPrice = slPrice;
          exitReason = "STOP_LOSS";
        } else if (takeProfitPct !== undefined && pnlPct >= Math.abs(takeProfitPct)) {
          exitTriggered = true;
          const tpPrice =
            activePosition.direction === "LONG"
              ? activePosition.entryPrice * (1 + Math.abs(takeProfitPct) / 100)
              : activePosition.entryPrice * (1 - Math.abs(takeProfitPct) / 100);
          exitPrice = tpPrice;
          exitReason = "TAKE_PROFIT";
        } else if (
          (activePosition.direction === "LONG" && signal === "SELL") ||
          (activePosition.direction === "SHORT" && signal === "BUY")
        ) {
          exitTriggered = true;
          exitPrice = candle.close;
          exitReason = "SIGNAL_REVERSAL";
        }

        if (exitTriggered) {
          const slippageAdjustedExitPrice =
            activePosition.direction === "LONG"
              ? exitPrice * (1 - slippageMultiplier)
              : exitPrice * (1 + slippageMultiplier);

          const exitValue = activePosition.quantity * slippageAdjustedExitPrice;
          const exitFee = exitValue * feeMultiplier;
          const totalFees = activePosition.entryFee + exitFee;
          const slippageCost =
            Math.abs(exitPrice - slippageAdjustedExitPrice) * activePosition.quantity +
            Math.abs(activePosition.entryPrice - activePosition.effectiveEntryPrice) * activePosition.quantity;

          let rawPnl = 0;
          if (activePosition.direction === "LONG") {
            rawPnl = (slippageAdjustedExitPrice - activePosition.effectiveEntryPrice) * activePosition.quantity;
          } else {
            rawPnl = (activePosition.effectiveEntryPrice - slippageAdjustedExitPrice) * activePosition.quantity;
          }

          const netPnl = rawPnl - totalFees;
          const pnlPctFinal = (netPnl / activePosition.allocatedCapital) * 100;

          currentCapital += netPnl;
          tradeCounter++;

          trades.push({
            id: `trade-${tradeCounter}`,
            entryTime: activePosition.entryTime,
            exitTime: candle.closeTime,
            entryPrice: Number(activePosition.entryPrice.toFixed(4)),
            exitPrice: Number(slippageAdjustedExitPrice.toFixed(4)),
            direction: activePosition.direction,
            quantity: Number(activePosition.quantity.toFixed(6)),
            fee: Number(totalFees.toFixed(4)),
            slippage: Number(slippageCost.toFixed(4)),
            profitLoss: Number(netPnl.toFixed(4)),
            profitLossPct: Number(pnlPctFinal.toFixed(2)),
            entryReason: activePosition.entryReason,
            exitReason,
          });

          activePosition = null;
        }
      }

      // 2. If no position is open, check entry signals
      if (!activePosition) {
        const canOpenLong = defaultPositionType === "LONG" && signal === "BUY";
        const canOpenShort = defaultPositionType === "SHORT" && signal === "SELL";

        if (canOpenLong || canOpenShort) {
          const direction: PositionType = canOpenLong ? "LONG" : "SHORT";
          const entryPrice = candle.close;

          const effectiveEntryPrice =
            direction === "LONG"
              ? entryPrice * (1 + slippageMultiplier)
              : entryPrice * (1 - slippageMultiplier);

          const allocatedCapital = currentCapital * positionSizePct;
          const quantity = allocatedCapital / effectiveEntryPrice;
          const entryFee = allocatedCapital * feeMultiplier;

          activePosition = {
            entryTime: candle.openTime,
            entryPrice,
            effectiveEntryPrice,
            quantity,
            direction,
            allocatedCapital,
            entryFee,
            entryReason: `${signal}_SIGNAL`,
          };
        }
      }

      // 3. Update Peak Capital, Drawdown and Equity Curve
      if (currentCapital > peakCapital) {
        peakCapital = currentCapital;
      }
      const currentDrawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      equityCurve.push({
        timestamp: candle.closeTime,
        capital: Number(currentCapital.toFixed(2)),
        drawdownPct: Number(currentDrawdown.toFixed(2)),
      });
    }

    // Close any open position at end of candle data
    if (activePosition && candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      if (lastCandle) {
        const exitPrice = lastCandle.close;
        const slippageAdjustedExitPrice =
          activePosition.direction === "LONG"
            ? exitPrice * (1 - slippageMultiplier)
            : exitPrice * (1 + slippageMultiplier);

        const exitValue = activePosition.quantity * slippageAdjustedExitPrice;
        const exitFee = exitValue * feeMultiplier;
        const totalFees = activePosition.entryFee + exitFee;
        const slippageCost =
          Math.abs(exitPrice - slippageAdjustedExitPrice) * activePosition.quantity +
          Math.abs(activePosition.entryPrice - activePosition.effectiveEntryPrice) * activePosition.quantity;

        let rawPnl = 0;
        if (activePosition.direction === "LONG") {
          rawPnl = (slippageAdjustedExitPrice - activePosition.effectiveEntryPrice) * activePosition.quantity;
        } else {
          rawPnl = (activePosition.effectiveEntryPrice - slippageAdjustedExitPrice) * activePosition.quantity;
        }

        const netPnl = rawPnl - totalFees;
        const pnlPctFinal = (netPnl / activePosition.allocatedCapital) * 100;

        currentCapital += netPnl;
        tradeCounter++;

        trades.push({
          id: `trade-${tradeCounter}`,
          entryTime: activePosition.entryTime,
          exitTime: lastCandle.closeTime,
          entryPrice: Number(activePosition.entryPrice.toFixed(4)),
          exitPrice: Number(slippageAdjustedExitPrice.toFixed(4)),
          direction: activePosition.direction,
          quantity: Number(activePosition.quantity.toFixed(6)),
          fee: Number(totalFees.toFixed(4)),
          slippage: Number(slippageCost.toFixed(4)),
          profitLoss: Number(netPnl.toFixed(4)),
          profitLossPct: Number(pnlPctFinal.toFixed(2)),
          entryReason: activePosition.entryReason,
          exitReason: "END_OF_DATA",
        });
      }
    }

    // 4. Calculate Final Metrics
    const winningTrades = trades.filter((t) => t.profitLoss > 0);
    const losingTrades = trades.filter((t) => t.profitLoss <= 0);

    const totalReturn = ((currentCapital - initialCapital) / initialCapital) * 100;
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

    const overallScore = Math.max(
      0,
      Number((winRate * 0.4 + totalReturn * 0.4 - maxDrawdown * 0.2).toFixed(2))
    );

    return {
      metrics: {
        initialCapital: Number(initialCapital.toFixed(2)),
        finalCapital: Number(currentCapital.toFixed(2)),
        totalReturn: Number(totalReturn.toFixed(2)),
        annualReturn: null,
        winRate: Number(winRate.toFixed(2)),
        maxDrawdown: Number(maxDrawdown.toFixed(2)),
        numTrades: trades.length,
        numWinningTrades: winningTrades.length,
        numLosingTrades: losingTrades.length,
        sharpeRatio: null,
        sortinoRatio: null,
        overallScore,
      },
      trades,
      equityCurve,
    };
  }

  private createEmptyResult(initialCapital: number): BacktestResultDomain {
    return {
      metrics: {
        initialCapital,
        finalCapital: initialCapital,
        totalReturn: 0,
        annualReturn: null,
        winRate: 0,
        maxDrawdown: 0,
        numTrades: 0,
        numWinningTrades: 0,
        numLosingTrades: 0,
        sharpeRatio: null,
        sortinoRatio: null,
        overallScore: 0,
      },
      trades: [],
      equityCurve: [{ timestamp: Date.now(), capital: initialCapital, drawdownPct: 0 }],
    };
  }
}
