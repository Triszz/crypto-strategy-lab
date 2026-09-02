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

// In-memory mock repository for isolated domain & application unit testing
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
}

describe("LexiconSentimentAnalyzer", () => {
  const analyzer = new LexiconSentimentAnalyzer();

  it("classifies positive-heavy text as POSITIVE with positive score", async () => {
    const text = "Bitcoin surges to new ATH following massive institutional ETF influx and bullish momentum!";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("POSITIVE");
    expect(res.score).toBeGreaterThan(0.15);
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it("classifies negative-heavy text as NEGATIVE with negative score", async () => {
    const text = "Crypto market crash causes panic sales and severe liquidation as FUD spreads.";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("NEGATIVE");
    expect(res.score).toBeLessThan(-0.15);
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it("classifies balanced mixed text correctly", async () => {
    const text = "Bitcoin surges with bullish gains but later experiences a crash and dump.";
    const res = await analyzer.analyzeText(text);
    expect(res.score).toBeDefined();
    expect(res.confidence).toBeGreaterThan(0);
  });

  it("classifies neutral text with no crypto keywords as NEUTRAL", async () => {
    const text = "The technical conference took place yesterday in Zurich.";
    const res = await analyzer.analyzeText(text);
    expect(res.classification).toBe("NEUTRAL");
    expect(res.score).toBe(0);
    expect(res.confidence).toBe(0.6);
  });

  it("returns score 0 for empty or whitespace text", async () => {
    const resEmpty = await analyzer.analyzeText("");
    expect(resEmpty.classification).toBe("NEUTRAL");
    expect(resEmpty.score).toBe(0);

    const resSpaces = await analyzer.analyzeText("   ");
    expect(resSpaces.classification).toBe("NEUTRAL");
    expect(resSpaces.score).toBe(0);
  });

  it("caps confidence at 0.95 for very long text with many matching keywords", async () => {
    const longText = Array(20)
      .fill("bullish surge pump gain ATH breakout rally inflow soar optimistic")
      .join(" ");
    const res = await analyzer.analyzeText(longText);
    expect(res.confidence).toBeLessThanOrEqual(0.95);
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

describe("SentimentService Application Unit Tests", () => {
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

  it("analyzes, saves sentiment and publishes SentimentAnalyzed event for valid news payload", async () => {
    const payload = {
      newsId: "news-101",
      title: "Bitcoin surges to new ATH!",
      summary: "Massive institutional inflow reported.",
      coinSymbols: ["BTC"],
    };

    const record = await service.handleNewsCollected(payload);

    expect(record).not.toBeNull();
    expect(record?.newsId).toBe("news-101");
    expect(record?.classification).toBe("POSITIVE");

    const emitted = publishedEvents.find((e) => e.event === "SentimentAnalyzed");
    expect(emitted).toBeDefined();
    expect(emitted?.payload).toMatchObject({
      newsId: "news-101",
      classification: "POSITIVE",
      coinSymbols: ["BTC"],
    });
  });

  it("returns null when newsId is missing in payload", async () => {
    const record = await service.handleNewsCollected({ newsId: "", title: "Empty" });
    expect(record).toBeNull();
  });

  it("upserts sentiment record without creating duplicates when handleNewsCollected is run twice for same news", async () => {
    const payload = {
      newsId: "news-dup-1",
      title: "Market crash and dump panic",
      summary: "Severe liquidation.",
      coinSymbols: ["ETH"],
    };

    const record1 = await service.handleNewsCollected(payload);
    const record2 = await service.handleNewsCollected(payload);

    expect(record1?.id).toBe(record2?.id);
    expect(repository.sentiments.size).toBe(1);
  });

  it("retrieves aggregated sentiment summary correctly", async () => {
    await service.handleNewsCollected({ newsId: "n1", title: "Bitcoin surges bullish ATH" });
    await service.handleNewsCollected({ newsId: "n2", title: "Crypto market crash dump" });

    const summary = await service.getSentimentSummary("BTC");
    expect(summary.totalNews).toBe(2);
    expect(summary.positiveCount).toBe(1);
    expect(summary.negativeCount).toBe(1);
  });
});
