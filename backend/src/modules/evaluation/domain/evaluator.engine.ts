export interface TradeInput {
  id?: string;
  entryPrice: number;
  exitPrice?: number | null;
  quantity: number;
  profitLoss?: number | null;
  profitLossPct?: number | null;
  entryTime: number | bigint;
  exitTime?: number | bigint | null;
  side: "BUY" | "SELL";
  position: "LONG" | "SHORT";
}

export interface EvaluationWeights {
  return: number; // default: 40
  winRate: number; // default: 40
  drawdown: number; // default: 20
}

export interface EvaluationResultMetrics {
  initialCapital: number;
  finalCapital: number;
  totalReturn: number; // e.g. 0.15 = 15%
  winRate: number; // e.g. 0.65 = 65%
  maxDrawdown: number; // e.g. 0.08 = 8%
  numTrades: number;
  numWinningTrades: number;
  numLosingTrades: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number; // TotalReturn / MaxDrawdown
  overallScore: number; // Normalized score used for ranking
  equityCurve: Array<{ time: number; equity: number }>;
}

export class EvaluatorEngine {
  /**
   * Applies trade-count penalty when numTrades < 30 to avoid overfitting on small samples.
   * Penalty formula: score * sqrt(numTrades / 30)
   */
  private static applyTradeCountPenalty(score: number, numTrades: number): number {
    if (numTrades >= 30 || numTrades === 0) return score;
    return score * Math.sqrt(numTrades / 30);
  }

  public static calculateMetrics(
    trades: TradeInput[],
    initialCapital = 10000,
    weights: EvaluationWeights = { return: 40, winRate: 40, drawdown: 20 }
  ): EvaluationResultMetrics {
    if (!trades || trades.length === 0) {
      return {
        initialCapital,
        finalCapital: initialCapital,
        totalReturn: 0,
        winRate: 0,
        maxDrawdown: 0,
        numTrades: 0,
        numWinningTrades: 0,
        numLosingTrades: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        overallScore: 0,
        equityCurve: [{ time: Date.now(), equity: initialCapital }],
      };
    }

    let currentCapital = initialCapital;
    let peakCapital = initialCapital;
    let maxDrawdown = 0;

    let numWinningTrades = 0;
    let numLosingTrades = 0;

    const returnsList: number[] = [];
    const seedTrade = trades[0];
    const equityCurve: Array<{ time: number; equity: number }> = [
      { time: seedTrade ? Number(seedTrade.entryTime) : Date.now(), equity: initialCapital },
    ];

    for (const trade of trades) {
      let pnl = trade.profitLoss;

      if (pnl === undefined || pnl === null) {
        if (trade.exitPrice != null && trade.entryPrice > 0) {
          const mult = trade.position === "LONG" ? 1 : -1;
          pnl = mult * (trade.exitPrice - trade.entryPrice) * trade.quantity;
        } else {
          pnl = 0;
        }
      }

      currentCapital += pnl;
      const prevCapital = currentCapital - pnl;
      const tradeReturnPct = prevCapital > 0 ? pnl / prevCapital : 0;
      returnsList.push(tradeReturnPct);

      if (pnl > 0) {
        numWinningTrades++;
      } else if (pnl < 0) {
        numLosingTrades++;
      }

      if (currentCapital > peakCapital) {
        peakCapital = currentCapital;
      } else {
        const drawdown = peakCapital > 0 ? (peakCapital - currentCapital) / peakCapital : 0;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      equityCurve.push({
        time: Number(trade.exitTime || trade.entryTime),
        equity: Math.round(currentCapital * 100) / 100,
      });
    }

    const totalReturn = (currentCapital - initialCapital) / initialCapital;
    const numTrades = trades.length;
    const winRate = numTrades > 0 ? numWinningTrades / numTrades : 0;

    // Calculate Sharpe Ratio (Risk-free rate = 0%)
    const avgReturn = returnsList.length > 0 ? returnsList.reduce((a, b) => a + b, 0) / returnsList.length : 0;
    const variance =
      returnsList.length > 1
        ? returnsList.reduce((acc, val) => acc + Math.pow(val - avgReturn, 2), 0) / (returnsList.length - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(numTrades) : 0;

    // Calculate Sortino Ratio (Downside deviation only)
    const downsideReturns = returnsList.filter((r) => r < 0);
    const downsideVariance =
      downsideReturns.length > 0
        ? downsideReturns.reduce((acc, val) => acc + Math.pow(val, 2), 0) / downsideReturns.length
        : 0;
    const downsideDev = Math.sqrt(downsideVariance);
    const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(numTrades) : 0;

    // Calmar Ratio = TotalReturn / MaxDrawdown
    const calmarRatio = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;

    // Weighted Overall Score formula: Return (weight.return) + WinRate (weight.winRate) - MaxDrawdown (weight.drawdown)
    const rawScore = totalReturn * weights.return + winRate * weights.winRate - maxDrawdown * weights.drawdown;
    const overallScore = this.applyTradeCountPenalty(rawScore, numTrades);

    return {
      initialCapital,
      finalCapital: Math.round(currentCapital * 100) / 100,
      totalReturn: Math.round(totalReturn * 10000) / 10000,
      winRate: Math.round(winRate * 10000) / 10000,
      maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
      numTrades,
      numWinningTrades,
      numLosingTrades,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      sortinoRatio: Math.round(sortinoRatio * 100) / 100,
      calmarRatio: Math.round(calmarRatio * 100) / 100,
      overallScore: Math.round(overallScore * 100) / 100,
      equityCurve,
    };
  }
}
