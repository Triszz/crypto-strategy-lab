import { describe, it, expect, beforeEach } from "vitest";
import { LexiconSentimentAnalyzer } from "../src/modules/sentiment/infrastructure/lexicon-sentiment.analyzer";
import { GeminiSentimentAnalyzer } from "../src/modules/sentiment/infrastructure/gemini-sentiment.analyzer";
import { SentimentService } from "../src/modules/sentiment/application/sentiment.service";
import {
  SentimentAnalysisResult,
  SentimentRecord,
  SentimentRepository,
  SentimentSummary,
} from "../src/modules/sentiment/domain/sentiment.entity";
import { setEventBus, resetEventBus } from "../src/shared/event-bus/EventBus";

class MockSentimentRepository implements SentimentRepository {
  public providers = new Map<string, { id: string; code: string }>();
  public sentiments = new Map<string, SentimentRecord>();

  public async findOrCreateProvider(code: string, name: string): Promise<{ id: string; code: string }> {
    if (!this.providers.has(code)) {
      this.providers.set(code, { id: `provider-${code}`, code });
    }
    return this.providers.get(code)!;
  }

  public async saveSentiment(
    newsId: string,
    providerId: string,
    result: SentimentAnalysisResult
  ): Promise<SentimentRecord> {
    const key = `${newsId}:${providerId}`;
    const record: SentimentRecord = {
      id: `sent-${key}`,
      newsId,
      providerId,
      classification: result.classification,
      score: result.score,
      confidence: result.confidence,
      analyzedAt: new Date(),
    };
    this.sentiments.set(key, record);
    return record;
  }

  public async getSentimentSummary(symbol?: string): Promise<SentimentSummary> {
    const cleanSymbol = symbol ? symbol.toUpperCase().replace(/(USDT|USDC|BUSD|USD)$/i, "") : "BTC";
    const all = Array.from(this.sentiments.values());

    if (all.length === 0) {
      return {
        symbol: cleanSymbol,
        averageScore: 0,
        totalNews: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
      };
    }

    let totalScore = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;

    for (const s of all) {
      totalScore += s.score;
      if (s.classification === "POSITIVE") positiveCount++;
      else if (s.classification === "NEGATIVE") negativeCount++;
      else neutralCount++;
    }

    return {
      symbol: cleanSymbol,
      averageScore: Math.round((totalScore / all.length) * 1000) / 1000,
      totalNews: all.length,
      positiveCount,
      neutralCount,
      negativeCount,
    };
  }

  public async findUnanalyzedNews(): Promise<Array<{ id: string; title: string; summary?: string | null; content?: string | null; coinSymbols: string[] }>> {
    return [];
  }
}

describe("LexiconSentimentAnalyzer (150+ Terms & Vietnamese Support)", () => {
  const analyzer = new LexiconSentimentAnalyzer();

  it("classifies English positive-heavy text as POSITIVE", async () => {
    const text = "Bitcoin surges to new ATH following massive institutional ETF influx and bullish momentum!";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("POSITIVE");
    expect(res.score).toBeGreaterThan(0.15);
  });

  it("classifies English negative-heavy text as NEGATIVE", async () => {
    const text = "Crypto market crash causes panic sales and severe liquidation as FUD spreads.";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("NEGATIVE");
    expect(res.score).toBeLessThan(-0.15);
  });

  it("classifies Vietnamese positive text correctly as POSITIVE", async () => {
    const text = "Bitcoin tăng mạnh vượt đỉnh lịch sử với dòng tiền vào kỷ lục!";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("POSITIVE");
    expect(res.score).toBeGreaterThan(0);
  });

  it("classifies Vietnamese negative text correctly as NEGATIVE", async () => {
    const text = "Sàn giao dịch bị hack hoảng loạn xả hàng sụt giảm nghiêm trọng!";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("NEGATIVE");
    expect(res.score).toBeLessThan(0);
  });

  it("classifies neutral text with no crypto keywords as NEUTRAL", async () => {
    const text = "The technical conference took place yesterday in Zurich.";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("NEUTRAL");
    expect(res.score).toBe(0);
  });

  it("returns score 0 for empty or whitespace text", async () => {
    const resEmpty = await analyzer.analyzeText("");
    expect(resEmpty.classification).toBe("NEUTRAL");
    expect(resEmpty.score).toBe(0);
  });
});

describe("GeminiSentimentAnalyzer Multi-Analyzer Adapter", () => {
  const geminiAnalyzer = new GeminiSentimentAnalyzer();

  it("has providerCode GEMINI_V1 and providerName Gemini LLM Sentiment Analyzer", () => {
    expect(geminiAnalyzer.providerCode).toBe("GEMINI_V1");
    expect(geminiAnalyzer.providerName).toBe("Gemini LLM Sentiment Analyzer");
  });

  it("analyzes text correctly using fallback mode when API key is unconfigured", async () => {
    const text = "Ethereum surges past resistance with strong bullish volume!";
    const res = await geminiAnalyzer.analyzeText(text);

    expect(res.classification).toBe("POSITIVE");
    expect(res.score).toBeGreaterThan(0);
  });
});

describe("SentimentService LRU Cache & Event Tests", () => {
  let repository: MockSentimentRepository;
  let analyzer: LexiconSentimentAnalyzer;
  let service: SentimentService;
  let publishedEvents: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    resetEventBus();
    publishedEvents = [];

    const mockBus = {
      publish: (event: string, payload: unknown) => {
        publishedEvents.push({ event, payload });
      },
      subscribe: () => {},
      unsubscribe: () => {},
      dispose: () => {},
    };
    setEventBus(mockBus as any);

    repository = new MockSentimentRepository();
    analyzer = new LexiconSentimentAnalyzer();
    service = new SentimentService(repository, analyzer, mockBus as any);
  });

  it("caches getSentimentSummary response in-memory for 30s", async () => {
    await service.handleNewsCollected({ newsId: "n1", title: "Bitcoin surges bullish ATH" });

    const summary1 = await service.getSentimentSummary("BTC");
    expect(summary1.totalNews).toBe(1);

    // Add another news directly to mock repo bypassing service cache invalidation to verify cache hit
    repository.sentiments.set("n2:provider-LEXICON_V1", {
      id: "sent-n2",
      newsId: "n2",
      providerId: "provider-LEXICON_V1",
      classification: "POSITIVE",
      score: 0.8,
      confidence: 0.9,
      analyzedAt: new Date(),
    });

    // Second call should return cached summary (count = 1)
    const summary2 = await service.getSentimentSummary("BTC");
    expect(summary2.totalNews).toBe(1);

    // After clearing cache manually, next call gets fresh summary (count = 2)
    service.clearCache();
    const summary3 = await service.getSentimentSummary("BTC");
    expect(summary3.totalNews).toBe(2);
  });
});
