import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { PrismaClient } from "@prisma/client";

/**
 * Normalises trading pairs like "BTCUSDT" or "ETHUSDC" to base asset string "BTC" or "ETH".
 */
function normalizeBaseAsset(symbol: string): string {
  return symbol.toUpperCase().replace(/(USDT|USDC|BUSD|USD)$/i, "");
}

export class SentimentDataFeed {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrismaClient();
  }

  /**
   * Calculates the average sentiment score for a given cryptocurrency symbol
   * over a specified lookback window preceding `untilTime`.
   *
   * Score is normalized in range [-1.0, 1.0].
   * Returns 0.0 (Neutral) if no news sentiment records exist in the window.
   */
  public async getAverageSentimentScore(
    symbol: string,
    lookbackWindowMs: number,
    untilTime: Date = new Date()
  ): Promise<number> {
    const cleanSymbol = normalizeBaseAsset(symbol);
    const startTime = new Date(untilTime.getTime() - lookbackWindowMs);

    const sentiments = await this.prisma.sentiment.findMany({
      where: {
        analyzedAt: {
          gte: startTime,
          lte: untilTime,
        },
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
      },
      select: {
        score: true,
      },
    });

    if (sentiments.length === 0) {
      return 0;
    }

    const totalScore = sentiments.reduce((acc, s) => acc + Number(s.score), 0);
    return Math.round((totalScore / sentiments.length) * 1000) / 1000;
  }
}
