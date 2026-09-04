import { describe, it, expect, beforeEach } from "vitest";
import { NewsSentimentStrategy, NEWS_SENTIMENT_STRATEGY_ID } from "../src/modules/strategy/strategies/NewsSentimentStrategy";
import { MovingAverageStrategy } from "../src/modules/strategy/strategies/MovingAverageStrategy";
import { bootstrapStrategies } from "../src/modules/strategy/strategies/bootstrap";
import { getStrategyRegistry } from "../src/modules/strategy/domain/StrategyRegistry";
import { CombinationEngine } from "../src/modules/strategy/combination/CombinationEngine";
import { CombinationOperator, type CombinationConfig } from "../src/modules/strategy/combination/CombinationConfig";
import type { StrategyContext, StrategyCandle } from "../src/modules/strategy/domain/StrategyContext";

describe("NewsSentimentStrategy Unit & Hybrid Composite Tests", () => {
  let strategy: NewsSentimentStrategy;

  beforeEach(() => {
    bootstrapStrategies();
    strategy = new NewsSentimentStrategy();
  });

  const dummyCandle: StrategyCandle = {
    openTime: 1620000000000,
    closeTime: 1620000300000,
    open: 50000,
    high: 50500,
    low: 49800,
    close: 50200,
    volume: 100,
  };

  it("should have correct id, name, and family taxonomy", () => {
    expect(strategy.id).toBe(NEWS_SENTIMENT_STRATEGY_ID);
    expect(strategy.name).toBe("News Sentiment Strategy");
    expect(strategy.family).toBe("SENTIMENT");
  });

  it("should validate parameters correctly", () => {
    expect(strategy.validateParameters({ lookbackWindowHours: 1, buyThreshold: 0.7, sellThreshold: -0.7 }).ok).toBe(true);
    // Invalid when sellThreshold >= buyThreshold
    expect(strategy.validateParameters({ lookbackWindowHours: 1, buyThreshold: 0.5, sellThreshold: 0.6 }).ok).toBe(false);
  });

  it("should return HOLD when no sentiment score is present in context metadata", () => {
    const ctx: StrategyContext = {
      symbol: "BTCUSDT",
      timeframe: "5m",
      candle: dummyCandle,
      history: [dummyCandle],
      parameters: strategy.defaultParameters(),
    };
    const signal = strategy.analyze(ctx);
    expect(signal.side).toBe("HOLD");
    expect(signal.reason).toContain("no sentiment data");
  });

  it("should return BUY when sentiment score >= buyThreshold", () => {
    const ctx: StrategyContext = {
      symbol: "BTCUSDT",
      timeframe: "5m",
      candle: dummyCandle,
      history: [dummyCandle],
      parameters: { buyThreshold: 0.7, sellThreshold: -0.7, lookbackWindowHours: 1 },
      metadata: { sentimentScore: 0.85 },
    };
    const signal = strategy.analyze(ctx);
    expect(signal.side).toBe("BUY");
    expect(signal.strength).toBe(0.85);
    expect(signal.reason).toContain("positive news sentiment");
  });

  it("should return SELL when sentiment score <= sellThreshold", () => {
    const ctx: StrategyContext = {
      symbol: "BTCUSDT",
      timeframe: "5m",
      candle: dummyCandle,
      history: [dummyCandle],
      parameters: { buyThreshold: 0.7, sellThreshold: -0.7, lookbackWindowHours: 1 },
      metadata: { sentimentScore: -0.82 },
    };
    const signal = strategy.analyze(ctx);
    expect(signal.side).toBe("SELL");
    expect(signal.strength).toBe(0.82);
    expect(signal.reason).toContain("negative news sentiment");
  });

  it("should return HOLD when sentiment score is between sellThreshold and buyThreshold", () => {
    const ctx: StrategyContext = {
      symbol: "BTCUSDT",
      timeframe: "5m",
      candle: dummyCandle,
      history: [dummyCandle],
      parameters: { buyThreshold: 0.7, sellThreshold: -0.7, lookbackWindowHours: 1 },
      metadata: { sentimentScore: 0.15 },
    };
    const signal = strategy.analyze(ctx);
    expect(signal.side).toBe("HOLD");
    expect(signal.reason).toContain("neutral sentiment");
  });

  it("should execute inside CombinationEngine as a Hybrid Strategy (MA + News Sentiment)", () => {
    const registry = getStrategyRegistry();
    const engine = new CombinationEngine(registry);

    const hybridConfig: CombinationConfig = {
      id: "strategy.composite.hybrid.ma_sentiment",
      name: "MA + News Sentiment Hybrid Strategy",
      operator: CombinationOperator.WEIGHTED,
      components: [
        {
          strategyId: "strategy.ma",
          weight: 0.5,
          position: 0,
          parameters: { fastPeriod: 2, slowPeriod: 5 },
        },
        {
          strategyId: NEWS_SENTIMENT_STRATEGY_ID,
          weight: 0.5,
          position: 1,
          parameters: { buyThreshold: 0.7, sellThreshold: -0.7 },
        },
      ],
    };

    // Create 10 candle history for MA warm-up
    const candles: StrategyCandle[] = Array.from({ length: 10 }, (_, i) => ({
      openTime: 1620000000000 + i * 300000,
      closeTime: 1620000300000 + i * 300000,
      open: 50000 + i * 100,
      high: 50100 + i * 100,
      low: 49900 + i * 100,
      close: 50050 + i * 100,
      volume: 100,
    }));

    const ctx: StrategyContext = {
      symbol: "BTCUSDT",
      timeframe: "5m",
      candle: candles[candles.length - 1]!,
      history: candles,
      parameters: {},
      metadata: { sentimentScore: 0.9 }, // Strong positive sentiment
    };

    const compositeSignal = engine.run(hybridConfig, ctx);
    expect(compositeSignal).toBeDefined();
    expect(compositeSignal.componentVotes.length).toBe(2);
    expect(compositeSignal.componentVotes[1]?.strategyId).toBe(NEWS_SENTIMENT_STRATEGY_ID);
    expect(compositeSignal.componentVotes[1]?.signal.side).toBe("BUY");
  });
});
