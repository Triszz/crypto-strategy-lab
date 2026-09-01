import { getPrismaClient } from "../../../infrastructure/database/prisma";
import {
  SentimentAnalysisResult,
  SentimentRecord,
  SentimentRepository,
  SentimentSummary,
} from "../domain/sentiment.entity";

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
    const cleanSymbol = symbol ? symbol.toUpperCase().replace("USDT", "") : "BTC";

    const sentiments = await this.prisma.sentiment.findMany({
      where: symbol
        ? {
            news: {
              OR: [
                { title: { contains: cleanSymbol, mode: "insensitive" } },
                { summary: { contains: cleanSymbol, mode: "insensitive" } },
              ],
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
