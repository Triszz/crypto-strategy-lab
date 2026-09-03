import { http } from "./http";

export interface LeaderboardItemApi {
  id: string;
  strategyVersionId: string;
  strategyName: string;
  strategyVersion: string;
  symbolId: string;
  symbolCode: string;
  timeframe: string;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  numTrades: number;
  overallScore: number;
  rank: number;
  lastEvaluatedAt: string;
}

export interface RankingHistoryItemApi {
  id: string;
  strategyVersionId: string;
  rank: number;
  overallScore: number;
  snapshotAt: string;
  datasetLabel?: string | null;
}

export interface LeaderboardFilterParams {
  symbol?: string;
  symbolId?: string;
  timeframe?: string;
  limit?: number;
}

export async function fetchTopKLeaderboard(
  params?: LeaderboardFilterParams
): Promise<LeaderboardItemApi[]> {
  const qs = new URLSearchParams();
  if (params?.symbol && params.symbol !== "ALL") qs.set("symbol", params.symbol);
  if (params?.symbolId) qs.set("symbolId", params.symbolId);
  if (params?.timeframe && params.timeframe !== "ALL") qs.set("timeframe", params.timeframe);
  if (params?.limit) qs.set("limit", params.limit.toString());

  const suffix = qs.toString() ? `?${qs}` : "";
  return http.get<LeaderboardItemApi[]>(`/api/leaderboard${suffix}`);
}

export async function fetchLeaderboardHistory(
  strategyVersionId: string
): Promise<RankingHistoryItemApi[]> {
  return http.get<RankingHistoryItemApi[]>(`/api/leaderboard/history/${encodeURIComponent(strategyVersionId)}`);
}
