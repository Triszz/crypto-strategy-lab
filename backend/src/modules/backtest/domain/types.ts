export type SignalType = "BUY" | "SELL" | "HOLD";
export type PositionType = "LONG" | "SHORT";

export interface CandleData {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestOptions {
  initialCapital?: number;
  positionSizePct?: number; // e.g. 1.0 (100% of available capital)
  positionType?: PositionType; // default "LONG"
  feePercent?: number; // e.g. 0.08 (% per trade entry & exit)
  slippageBps?: number; // e.g. 5 basis points (0.05%)
  stopLossPct?: number; // e.g. 1.5 (%)
  takeProfitPct?: number; // e.g. 3.0 (%)
}

export interface SimulatedTrade {
  id: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: PositionType;
  quantity: number;
  fee: number;
  slippage: number;
  profitLoss: number;
  profitLossPct: number;
  entryReason: string;
  exitReason: string;
}

export interface EquityPoint {
  timestamp: number;
  capital: number;
  drawdownPct: number;
}

export interface BacktestMetrics {
  initialCapital: number;
  finalCapital: number;
  totalReturn: number; // e.g. 15.42 (%)
  annualReturn: number | null;
  winRate: number; // e.g. 62.5 (%)
  maxDrawdown: number; // e.g. 5.12 (%)
  numTrades: number;
  numWinningTrades: number;
  numLosingTrades: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  overallScore: number;
}

export interface BacktestResultDomain {
  metrics: BacktestMetrics;
  trades: SimulatedTrade[];
  equityCurve: EquityPoint[];
}

export type StrategySignalFunction = (
  candles: CandleData[],
  currentIndex: number
) => SignalType;
