export interface LeaderboardItem {
  id?: string;
  strategyVersionId: string;
  strategyName?: string;
  strategyVersion?: string;
  symbolId: string;
  symbolCode?: string;
  timeframe: string;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  numTrades: number;
  overallScore: number;
  rank: number;
  lastEvaluatedAt: Date;
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
}

export interface LeaderboardRepository {
  upsertEntry(entry: Omit<LeaderboardItem, "id" | "rank" | "lastEvaluatedAt">): Promise<void>;
  recalculateRanks(symbolId?: string, timeframe?: string): Promise<LeaderboardItem[]>;
  getTopK(options: LeaderboardFilterOptions): Promise<LeaderboardItem[]>;
  getHistory(strategyVersionId: string): Promise<RankingHistoryItem[]>;
}
