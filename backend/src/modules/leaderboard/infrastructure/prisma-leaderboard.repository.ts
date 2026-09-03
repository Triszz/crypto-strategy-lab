import { getPrismaClient } from "../../../infrastructure/database/prisma";
import {
  LeaderboardFilterOptions,
  LeaderboardItem,
  LeaderboardRepository,
  RankingHistoryItem,
} from "../domain/leaderboard.entity";

export class PrismaLeaderboardRepository implements LeaderboardRepository {
  private prisma = getPrismaClient();

  public async upsertEntry(entry: Omit<LeaderboardItem, "id" | "rank" | "lastEvaluatedAt">): Promise<void> {
    const existing = await this.prisma.leaderboardEntry.findUnique({
      where: {
        strategyVersionId_symbolId_timeframe: {
          strategyVersionId: entry.strategyVersionId,
          symbolId: entry.symbolId,
          timeframe: entry.timeframe,
        },
      },
    });

    const currentRank = existing ? existing.rank : 999;

    await this.prisma.leaderboardEntry.upsert({
      where: {
        strategyVersionId_symbolId_timeframe: {
          strategyVersionId: entry.strategyVersionId,
          symbolId: entry.symbolId,
          timeframe: entry.timeframe,
        },
      },
      update: {
        totalReturn: entry.totalReturn,
        winRate: entry.winRate,
        maxDrawdown: entry.maxDrawdown,
        numTrades: entry.numTrades,
        overallScore: entry.overallScore,
        lastEvaluatedAt: new Date(),
      },
      create: {
        strategyVersionId: entry.strategyVersionId,
        symbolId: entry.symbolId,
        timeframe: entry.timeframe,
        totalReturn: entry.totalReturn,
        winRate: entry.winRate,
        maxDrawdown: entry.maxDrawdown,
        numTrades: entry.numTrades,
        overallScore: entry.overallScore,
        rank: currentRank,
      },
    });
  }

  public async recalculateRanks(symbolId?: string, timeframe?: string): Promise<LeaderboardItem[]> {
    const whereClause: Record<string, unknown> = {};
    if (symbolId) whereClause.symbolId = symbolId;
    if (timeframe) whereClause.timeframe = timeframe;

    const entries = await this.prisma.leaderboardEntry.findMany({
      where: whereClause,
      orderBy: { overallScore: "desc" },
      include: {
        strategyVersion: true,
        symbol: true,
      },
    });

    const updatedItems: LeaderboardItem[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < entries.length; i++) {
        const newRank = i + 1;
        const entry = entries[i]!;

        if (entry.rank !== newRank) {
          await tx.leaderboardEntry.update({
            where: { id: entry.id },
            data: { rank: newRank },
          });
        }

        await tx.rankingHistory.create({
          data: {
            strategyVersionId: entry.strategyVersionId,
            rank: newRank,
            overallScore: entry.overallScore,
          },
        });

        updatedItems.push({
          id: entry.id,
          strategyVersionId: entry.strategyVersionId,
          strategyName: entry.strategyVersion?.name || "Strategy",
          strategyVersion: entry.strategyVersion?.version || "1.0.0",
          symbolId: entry.symbolId,
          symbolCode: entry.symbol?.symbol || "BTCUSDT",
          timeframe: entry.timeframe,
          totalReturn: Number(entry.totalReturn),
          winRate: Number(entry.winRate),
          maxDrawdown: Number(entry.maxDrawdown),
          numTrades: entry.numTrades,
          overallScore: Number(entry.overallScore),
          rank: newRank,
          lastEvaluatedAt: entry.lastEvaluatedAt,
        });
      }
    });

    return updatedItems;
  }

  public async getTopK(options: LeaderboardFilterOptions): Promise<LeaderboardItem[]> {
    const limit = Math.min(100, Math.max(1, options.limit || 10));
    const whereClause: Record<string, unknown> = {};

    if (options.symbolId) {
      whereClause.symbolId = options.symbolId;
    } else if (options.symbol) {
      const sym = await this.prisma.symbol.findFirst({
        where: { symbol: options.symbol.toUpperCase() },
      });
      if (sym) whereClause.symbolId = sym.id;
    }

    if (options.timeframe) {
      whereClause.timeframe = options.timeframe;
    }

    // Fix Bug #2 (spec 04-leaderboard-module.md §7.2): Order by overallScore DESC instead of rank ASC
    const entries = await this.prisma.leaderboardEntry.findMany({
      where: whereClause,
      orderBy: { overallScore: "desc" },
      take: limit,
      include: {
        strategyVersion: true,
        symbol: true,
      },
    });

    return entries.map((entry, index) => ({
      id: entry.id,
      strategyVersionId: entry.strategyVersionId,
      strategyName: entry.strategyVersion?.name || "Strategy",
      strategyVersion: entry.strategyVersion?.version || "1.0.0",
      symbolId: entry.symbolId,
      symbolCode: entry.symbol?.symbol || "BTCUSDT",
      timeframe: entry.timeframe,
      totalReturn: Number(entry.totalReturn),
      winRate: Number(entry.winRate),
      maxDrawdown: Number(entry.maxDrawdown),
      numTrades: entry.numTrades,
      overallScore: Number(entry.overallScore),
      rank: index + 1,
      lastEvaluatedAt: entry.lastEvaluatedAt,
    }));
  }

  public async getHistory(strategyVersionId: string): Promise<RankingHistoryItem[]> {
    const records = await this.prisma.rankingHistory.findMany({
      where: { strategyVersionId },
      orderBy: { snapshotAt: "desc" },
      take: 50,
    });

    return records.map((r) => ({
      id: r.id,
      strategyVersionId: r.strategyVersionId,
      rank: r.rank,
      overallScore: Number(r.overallScore),
      snapshotAt: r.snapshotAt,
      datasetLabel: r.datasetLabel,
    }));
  }
}
