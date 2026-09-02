import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
import {
  SentimentAnalysisResult,
  SentimentAnalyzer,
  SentimentRecord,
  SentimentRepository,
  SentimentSummary,
} from "../domain/sentiment.entity";

export interface NewsCollectedPayload {
  newsId: string;
  title: string;
  summary?: string;
  content?: string;
  coinSymbols?: string[];
}

export class SentimentService {
  private prisma = getPrismaClient();

  constructor(
    private readonly repository: SentimentRepository,
    private readonly analyzer: SentimentAnalyzer,
    private readonly eventBus: EventBus = getEventBus()
  ) {
    this.registerEventListener();
  }

  private registerEventListener(): void {
    this.eventBus.subscribe<NewsCollectedPayload>("NewsCollected", (payload) => {
      void this.handleNewsCollected(payload);
    });
  }

  public async handleNewsCollected(payload: NewsCollectedPayload): Promise<SentimentRecord | null> {
    if (!payload || !payload.newsId) return null;

    const textToAnalyze = `${payload.title || ""} ${payload.summary || ""}`.trim();
    const result = await this.analyzer.analyzeText(textToAnalyze);

    const provider = await this.repository.findOrCreateProvider(
      this.analyzer.providerCode,
      this.analyzer.providerName
    );

    const record = await this.repository.saveSentiment(payload.newsId, provider.id, result);

    this.eventBus.publish("SentimentAnalyzed", {
      newsId: payload.newsId,
      sentimentId: record.id,
      classification: record.classification,
      score: record.score,
      coinSymbols: payload.coinSymbols || [],
    });

    return record;
  }

  /**
   * Auto-backfill: Scans existing news in the database that do not have
   * a sentiment record yet and analyzes them automatically.
   */
  public async backfillUnanalyzedNews(): Promise<number> {
    try {
      const unanalyzed = await this.repository.findUnanalyzedNews(50);

      for (const item of unanalyzed) {
        await this.handleNewsCollected({
          newsId: item.id,
          title: item.title,
          summary: item.summary ?? undefined,
          content: item.content ?? undefined,
          coinSymbols: item.coinSymbols,
        });
      }

      return unanalyzed.length;
    } catch {
      return 0;
    }
  }

  public async analyzeText(text: string): Promise<SentimentAnalysisResult> {
    return this.analyzer.analyzeText(text);
  }

  public async getSentimentSummary(symbol?: string): Promise<SentimentSummary> {
    // Automatically backfill any existing news items in DB that were missing sentiment records
    await this.backfillUnanalyzedNews();

    const summary = await this.repository.getSentimentSummary(symbol);
    return {
      ...summary,
      analyzerCode: this.analyzer.providerCode,
    };
  }
}
