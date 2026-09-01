import { describe, it, expect } from "vitest";
import { EvaluatorEngine, TradeInput } from "../src/modules/evaluation/domain/evaluator.engine";
import { LexiconSentimentAnalyzer } from "../src/modules/sentiment/infrastructure/lexicon-sentiment.analyzer";
import { RSSNewsAdapter } from "../src/modules/news/infrastructure/rss-news.adapter";

describe("EvaluatorEngine Domain Unit Tests", () => {
  it("should calculate metrics correctly for winning and losing trades", () => {
    const mockTrades: TradeInput[] = [
      {
        entryPrice: 100,
        exitPrice: 110,
        quantity: 10,
        profitLoss: 100,
        profitLossPct: 0.1,
        entryTime: 1700000000000,
        exitTime: 1700003600000,
        side: "BUY",
        position: "LONG",
      },
      {
        entryPrice: 110,
        exitPrice: 105,
        quantity: 10,
        profitLoss: -50,
        profitLossPct: -0.045,
        entryTime: 1700007200000,
        exitTime: 1700010800000,
        side: "BUY",
        position: "LONG",
      },
    ];

    const metrics = EvaluatorEngine.calculateMetrics(mockTrades, 10000);

    expect(metrics.initialCapital).toBe(10000);
    expect(metrics.finalCapital).toBe(10050);
    expect(metrics.totalReturn).toBe(0.005);
    expect(metrics.numTrades).toBe(2);
    expect(metrics.numWinningTrades).toBe(1);
    expect(metrics.numLosingTrades).toBe(1);
    expect(metrics.winRate).toBe(0.5);
    expect(metrics.equityCurve).toHaveLength(3);
  });

  it("should handle empty trade list gracefully", () => {
    const metrics = EvaluatorEngine.calculateMetrics([], 10000);
    expect(metrics.finalCapital).toBe(10000);
    expect(metrics.totalReturn).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.numTrades).toBe(0);
  });
});

describe("LexiconSentimentAnalyzer Domain Unit Tests", () => {
  const analyzer = new LexiconSentimentAnalyzer();

  it("should analyze bullish text as POSITIVE sentiment", async () => {
    const text = "Bitcoin surges to new ATH following massive institutional ETF influx and bullish momentum!";
    const result = await analyzer.analyzeText(text);

    expect(result.classification).toBe("POSITIVE");
    expect(result.score).toBeGreaterThan(0);
  });

  it("should analyze bearish text as NEGATIVE sentiment", async () => {
    const text = "Crypto market crash causes panic sales and severe liquidation as FUD spreads.";
    const result = await analyzer.analyzeText(text);

    expect(result.classification).toBe("NEGATIVE");
    expect(result.score).toBeLessThan(0);
  });

  it("should analyze neutral text as NEUTRAL sentiment", async () => {
    const text = "The technical conference took place yesterday in Zurich.";
    const result = await analyzer.analyzeText(text);

    expect(result.classification).toBe("NEUTRAL");
    expect(result.score).toBe(0);
  });
});

describe("RSSNewsAdapter Infrastructure Unit Tests", () => {
  const adapter = new RSSNewsAdapter();

  it("should fetch latest news items for BTC", async () => {
    const newsItems = await adapter.fetchLatestNews("BTCUSDT");

    expect(newsItems.length).toBeGreaterThan(0);
    expect(newsItems[0].title).toBeDefined();
    expect(newsItems[0].url).toContain("http");
    expect(newsItems[0].coinSymbols).toContain("BTC");
  });
});
