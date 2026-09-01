export type SentimentClass = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface SentimentAnalysisResult {
  classification: SentimentClass;
  score: number; // Range [-1.0, 1.0]
  confidence: number; // Range [0.0, 1.0]
}

export interface SentimentRecord {
  id: string;
  newsId: string;
  providerId: string;
  classification: SentimentClass;
  score: number;
  confidence?: number | null;
  analyzedAt: Date;
}

export interface SentimentAnalyzer {
  providerCode: string;
  providerName: string;
  analyzeText(text: string): Promise<SentimentAnalysisResult>;
}

export interface SentimentSummary {
  symbol: string;
  averageScore: number;
  totalNews: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
}

export interface SentimentRepository {
  findOrCreateProvider(code: string, name: string): Promise<{ id: string; code: string }>;
  saveSentiment(newsId: string, providerId: string, result: SentimentAnalysisResult): Promise<SentimentRecord>;
  getSentimentSummary(symbol?: string): Promise<SentimentSummary>;
}
