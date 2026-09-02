// Market Data
export interface Symbol {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

export interface Candle {
  id: string;
  symbolId: string;
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
}

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

// Strategy
export interface StrategyDefinition {
  id: string;
  type: StrategyType;
  family: StrategyFamily;
  description?: string;
  createdAt: string;
}

export type StrategyType = 'single' | 'composite';
export type StrategyFamily = 'MA' | 'RSI' | 'BB' | 'SR' | 'SMC' | 'MIXED';

export interface StrategyVersion {
  id: string;
  definitionId: string;
  version: number;
  params: StrategyParams;
  createdAt: string;
}

export interface StrategyParams {
  fastPeriod?: number;
  slowPeriod?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  bbPeriod?: number;
  bbStdDev?: number;
  weights?: Record<string, number>;
}

// Backtest
export interface Experiment {
  id: string;
  candidateId: string;
  symbolId: string;
  symbol: string;
  timeframe: Timeframe;
  fromTime: number;
  toTime: number;
  status: ExperimentStatus;
  progress?: number;
  createdAt: string;
  finishedAt?: string;
}

export type ExperimentStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BacktestResult {
  id: string;
  experimentId: string;
  symbolId: string;
  symbol: string;
  timeframe: Timeframe;
  fromTime: number;
  toTime: number;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  annualReturn?: number;
  winRate: number;
  maxDrawdown: number;
  numTrades: number;
  numWinningTrades: number;
  numLosingTrades: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  overallScore: number;
  equityCurve: number[];
  createdAt: string;
}

export interface Trade {
  id: string;
  experimentId: string;
  symbolId: string;
  side: TradeSide;
  position: PositionType;
  entryTime: number;
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  quantity?: number;
  pnl?: number;
}

export type TradeSide = 'BUY' | 'SELL';
export type PositionType = 'LONG' | 'SHORT';

// Leaderboard
export interface LeaderboardEntry {
  rank: number;
  experimentId: string;
  candidateId: string;
  symbol: string;
  timeframe: Timeframe;
  strategyName: string;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  overallScore: number;
  numTrades: number;
  sharpeRatio?: number;
  createdAt: string;
}

// News
export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment?: Sentiment;
  sentimentScore?: number;
  relatedSymbols?: string[];
}

export type Sentiment = 'positive' | 'negative' | 'neutral';

// Search
export interface SearchConfig {
  symbol: string;
  timeframe: Timeframe;
  fromTime: number;
  toTime: number;
  maxCandidates: number;
}

export interface CandidateStrategy {
  id: string;
  searchId: string;
  definitionId: string;
  versionId: string;
  status: CandidateStatus;
  score?: number;
}

export type CandidateStatus = 'pending' | 'backtesting' | 'completed' | 'failed';

// Settings
export interface AppSettings {
  theme: 'dark' | 'light';
  defaultSymbol: string;
  defaultTimeframe: Timeframe;
  notifications: boolean;
  soundEnabled: boolean;
}
