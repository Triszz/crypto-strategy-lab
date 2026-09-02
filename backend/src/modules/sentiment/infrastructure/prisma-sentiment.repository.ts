import { getPrismaClient } from "../../../infrastructure/database/prisma";
import {
  SentimentAnalysisResult,
  SentimentRecord,
  SentimentRepository,
  SentimentSummary,
} from "../domain/sentiment.entity";

/**
 * Strip the "USDT"/"BUSD"/"USDC"/"USD" quote suffix and uppercase.
 *
 * Mirrors the helper of the same name in `PrismaNewsRepository` so both
 * modules agree on what "BTC" means: the base asset ("BTC"), not the
 * trading pair ("BTCUSDT"). Without this, callers passing "BTCUSDT"
 * would resolve to "BTCUSDT" — a string that never matches any
 * `Symbol.baseAsset` (we store the base/quote split, not the pair).
 */
function normalizeBaseAsset(symbol: string): string {
  return symbol.toUpperCase().replace(/(USDT|USDC|BUSD|USD)$/i, "");
}

export class PrismaSentimentRepository implements SentimentRepository {
  private prisma = getPrismaClient();

  public async findOrCreateProvider(code: string, name: string): Promise<{ id: string; code: string }> {
    const existing = await this.prisma.sentimentProvider.findUnique({
      where: { code },
    });

    if (existing) {
      return { id: existing.id, code: existing.code };
    }

    const created = await this.prisma.sentimentProvider.create({
      data: {
        code,
        name,
        modelVersion: "1.0.0",
        isActive: true,
      },
    });

    return { id: created.id, code: created.code };
  }

  public async saveSentiment(
    newsId: string,
    providerId: string,
    result: SentimentAnalysisResult
  ): Promise<SentimentRecord> {
    const record = await this.prisma.sentiment.upsert({
      where: {
        newsId_providerId: {
          newsId,
          providerId,
        },
      },
      update: {
        classification: result.classification,
        score: result.score,
        confidence: result.confidence,
        analyzedAt: new Date(),
      },
      create: {
        newsId,
        providerId,
        classification: result.classification,
        score: result.score,
        confidence: result.confidence,
      },
    });

    return {
      id: record.id,
      newsId: record.newsId,
      providerId: record.providerId,
      classification: record.classification as SentimentRecord["classification"],
      score: Number(record.score),
      confidence: record.confidence ? Number(record.confidence) : null,
      analyzedAt: record.analyzedAt,
    };
  }

  public async getSentimentSummary(symbol?: string): Promise<SentimentSummary> {
    // Phase B bug fix (spec `02-sentiment-module.md` §7.1):
    //
    //   BEFORE: filter by free-text `title ILIKE 'BTC'` / `summary ILIKE 'BTC'`.
    //     - False positive: a news about ETH whose title mentions "BTC" would
    //       be returned as BTC sentiment.
    //     - False negative: a real BTC news whose title says "Ethereum-killer"
    //       (but is tagged `BTC` in `NewsCoin`) would be missed.
    //
    //   AFTER: filter via the `news.coins.some` relation through `NewsCoin`
    //   and `Symbol.baseAsset`. The adapter explicitly tags which symbols a
    //   news is about, and that mapping is the single source of truth.
    //
    //   Same pattern News module applied in Phase A.3 (see
    //   `PrismaNewsRepository.getNews`). Using `mode: "insensitive"` so
    //   callers passing "btc" still match.
    const cleanSymbol = symbol ? normalizeBaseAsset(symbol) : "BTC";

    const sentiments = await this.prisma.sentiment.findMany({
      where: symbol
        ? {
            news: {
              coins: {
                some: {
                  symbol: {
                    baseAsset: {
                      equals: cleanSymbol,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
          }
        : undefined,
      take: 100,
      orderBy: { analyzedAt: "desc" },
    });

    if (sentiments.length === 0) {
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

    for (const s of sentiments) {
      const score = Number(s.score);
      totalScore += score;
      if (s.classification === "POSITIVE") positiveCount++;
      else if (s.classification === "NEGATIVE") negativeCount++;
      else neutralCount++;
    }

    return {
      symbol: cleanSymbol,
      averageScore: Math.round((totalScore / sentiments.length) * 1000) / 1000,
      totalNews: sentiments.length,
      positiveCount,
      neutralCount,
      negativeCount,
    };
  }
}
