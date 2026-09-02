import { http } from "./http";

export interface SentimentSummary {
  symbol: string;
  averageScore: number;
  totalNews: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
}

/**
  * Fetch aggregated sentiment statistics for a specific symbol or all news.
  *
  * Endpoint: GET /api/sentiment/summary?symbol=BTC
  */
export async function fetchSentimentSummary(symbol?: string): Promise<SentimentSummary> {
  const qs = new URLSearchParams();
  if (symbol && symbol !== "ALL") {
    qs.set("symbol", symbol);
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  return http.get<SentimentSummary>(`/api/sentiment/summary${suffix}`);
}
