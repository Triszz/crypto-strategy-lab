export interface LeaderboardItem {
  id?: string;
  strategyVersionId: string;
  strategyName?: string;
  strategyVersion?: string;
  strategyType?: string; // "BASE" | "COMPOSITE"
  displayNameWithWeights?: string | null;
  parameters?: Record<string, unknown>;
  symbolId: string;
  symbolCode?: string;
  timeframe: string;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  calmarRatio?: number;
  numTrades: number;
  overallScore: number;
  rank: number;
  lastEvaluatedAt: Date;
}

export interface LeaderboardTraceDetails {
  leaderboardEntry: LeaderboardItem;
  strategyVersion: {
    id: string;
    version: string;
    name: string;
    description?: string | null;
    implementationRef: string;
    parameters: Record<string, unknown>;
    displayNameWithWeights?: string | null;
    strategyType: string;
    compositeComponents?: Array<{
      componentVersionId: string;
      componentName: string;
      weight: number;
      position: number;
    }>;
  };
  dataset: {
    symbolId: string;
    symbolCode: string;
    baseAsset: string;
    quoteAsset: string;
    timeframe: string;
    fromTime?: string | number | null;
    toTime?: string | number | null;
  };
  experiment?: {
    id: string;
    initialCapital: number;
    positionSize: number;
    positionType: string;
    status: string;
  } | null;
  trades: Array<{
    id: string;
    side: string;
    position: string;
    entryTime: number;
    entryPrice: number;
    exitTime?: number | null;
    exitPrice?: number | null;
    quantity: number;
    profitLoss?: number | null;
    profitLossPct?: number | null;
    entryReason?: string | null;
    exitReason?: string | null;
  }>;
}

export interface RankingHistoryItem {
  id: string;
  strategyVersionId: string;
  rank: number;
  overallScore: number;
  snapshotAt: Date;
  datasetLabel?: string | null;
}

export interface LeaderboardFilterOptions {
  symbolId?: string;
  symbol?: string;
  timeframe?: string;
  limit?: number;
  strategyType?: string; // "BASE" | "COMPOSITE" | "ALL"
  sortBy?: "overallScore" | "totalReturn" | "winRate" | "maxDrawdown" | "sharpeRatio";
}

export interface LeaderboardRepository {
  upsertEntry(entry: Omit<LeaderboardItem, "id" | "rank" | "lastEvaluatedAt">): Promise<void>;
  recalculateRanks(symbolId?: string, timeframe?: string): Promise<LeaderboardItem[]>;
  getTopK(options: LeaderboardFilterOptions): Promise<LeaderboardItem[]>;
  getHistory(strategyVersionId: string): Promise<RankingHistoryItem[]>;
  getTraceDetails(idOrVersionId: string): Promise<LeaderboardTraceDetails | null>;
}

