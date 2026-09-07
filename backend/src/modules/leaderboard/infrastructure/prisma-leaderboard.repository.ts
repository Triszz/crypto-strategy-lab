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
    const strategyType = entry.strategyType || "BASE";

    await this.prisma.leaderboardEntry.upsert({
      where: {
        strategyVersionId_symbolId_timeframe: {
          strategyVersionId: entry.strategyVersionId,
          symbolId: entry.symbolId,
          timeframe: entry.timeframe,
        },
      },
      update: {
        strategyType,
        totalReturn: entry.totalReturn,
        winRate: entry.winRate,
        maxDrawdown: entry.maxDrawdown,
        sharpeRatio: entry.sharpeRatio !== undefined ? entry.sharpeRatio : null,
        sortinoRatio: entry.sortinoRatio !== undefined ? entry.sortinoRatio : null,
        calmarRatio: entry.calmarRatio !== undefined ? entry.calmarRatio : null,
        numTrades: entry.numTrades,
        overallScore: entry.overallScore,
        lastEvaluatedAt: new Date(),
      },
      create: {
        strategyVersionId: entry.strategyVersionId,
        symbolId: entry.symbolId,
        timeframe: entry.timeframe,
        strategyType,
        totalReturn: entry.totalReturn,
        winRate: entry.winRate,
        maxDrawdown: entry.maxDrawdown,
        sharpeRatio: entry.sharpeRatio !== undefined ? entry.sharpeRatio : null,
        sortinoRatio: entry.sortinoRatio !== undefined ? entry.sortinoRatio : null,
        calmarRatio: entry.calmarRatio !== undefined ? entry.calmarRatio : null,
        numTrades: entry.numTrades,
        overallScore: entry.overallScore,
        rank: currentRank,
      },
    });
  }

  private recalculateChain: Promise<any> = Promise.resolve();

  public async recalculateRanks(symbolId?: string, timeframe?: string): Promise<LeaderboardItem[]> {
    return new Promise((resolve, reject) => {
      this.recalculateChain = this.recalculateChain
        .then(async () => {
          try {
            const res = await this.executeRecalculateRanksWithRetry(symbolId, timeframe);
            resolve(res);
          } catch (err) {
            reject(err);
          }
        })
        .catch(() => {});
    });
  }

  private async executeRecalculateRanksWithRetry(
    symbolId?: string,
    timeframe?: string,
    retries = 3
  ): Promise<LeaderboardItem[]> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await this.executeRecalculateRanks(symbolId, timeframe);
      } catch (err: any) {
        const isDeadlock = err?.code === "40P01" || err?.message?.includes("deadlock detected");
        if (isDeadlock && attempt < retries) {
          await new Promise((r) => setTimeout(r, Math.random() * 100 + 50 * attempt));
          continue;
        }
        throw err;
      }
    }
    return [];
  }

  private async executeRecalculateRanks(symbolId?: string, timeframe?: string): Promise<LeaderboardItem[]> {
    const whereClause: Record<string, unknown> = {
      numTrades: { gt: 0 },
    };
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

    for (let i = 0; i < entries.length; i++) {
      const newRank = i + 1;
      const entry = entries[i]!;

      if (entry.rank !== newRank) {
        await this.prisma.leaderboardEntry.update({
          where: { id: entry.id },
          data: { rank: newRank },
        });
      }

      await this.prisma.rankingHistory.create({
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
        strategyType: entry.strategyType || "BASE",
        displayNameWithWeights: entry.strategyVersion?.displayNameWithWeights ?? null,
        parameters: (entry.strategyVersion?.parameters as Record<string, unknown>) ?? undefined,
        symbolId: entry.symbolId,
        symbolCode: entry.symbol?.symbol || "BTCUSDT",
        timeframe: entry.timeframe,
        totalReturn: Number(entry.totalReturn),
        winRate: Number(entry.winRate),
        maxDrawdown: Number(entry.maxDrawdown),
        sharpeRatio: entry.sharpeRatio ? Number(entry.sharpeRatio) : undefined,
        sortinoRatio: entry.sortinoRatio ? Number(entry.sortinoRatio) : undefined,
        calmarRatio: entry.calmarRatio ? Number(entry.calmarRatio) : undefined,
        numTrades: entry.numTrades,
        overallScore: Number(entry.overallScore),
        rank: newRank,
        lastEvaluatedAt: entry.lastEvaluatedAt,
      });
    }

    return updatedItems;
  }

  public async getTopK(options: LeaderboardFilterOptions): Promise<LeaderboardItem[]> {
    const limit = Math.min(100, Math.max(1, options.limit || 10));
    const whereClause: Record<string, unknown> = {
      numTrades: { gt: 0 },
    };

    if (options.symbolId) {
      whereClause.symbolId = options.symbolId;
    } else if (options.symbol && options.symbol !== "ALL") {
      const sym = await this.prisma.symbol.findFirst({
        where: { symbol: options.symbol.toUpperCase() },
      });
      if (sym) whereClause.symbolId = sym.id;
    }

    if (options.timeframe && options.timeframe !== "ALL") {
      whereClause.timeframe = options.timeframe;
    }

    if (options.strategyType && options.strategyType !== "ALL") {
      whereClause.strategyType = options.strategyType.toUpperCase();
    }

    // Dynamic sorting based on options.sortBy
    let orderByField: Record<string, "desc" | "asc"> = { overallScore: "desc" };
    if (options.sortBy === "totalReturn") orderByField = { totalReturn: "desc" };
    else if (options.sortBy === "winRate") orderByField = { winRate: "desc" };
    else if (options.sortBy === "maxDrawdown") orderByField = { maxDrawdown: "asc" }; // lower MDD is better
    else if (options.sortBy === "sharpeRatio") orderByField = { sharpeRatio: "desc" };

    const entries = await this.prisma.leaderboardEntry.findMany({
      where: whereClause,
      orderBy: orderByField,
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
      strategyType: entry.strategyType || "BASE",
      displayNameWithWeights: entry.strategyVersion?.displayNameWithWeights ?? null,
      parameters: (entry.strategyVersion?.parameters as Record<string, unknown>) ?? undefined,
      symbolId: entry.symbolId,
      symbolCode: entry.symbol?.symbol || "BTCUSDT",
      timeframe: entry.timeframe,
      totalReturn: Number(entry.totalReturn),
      winRate: Number(entry.winRate),
      maxDrawdown: Number(entry.maxDrawdown),
      sharpeRatio: entry.sharpeRatio ? Number(entry.sharpeRatio) : undefined,
      sortinoRatio: entry.sortinoRatio ? Number(entry.sortinoRatio) : undefined,
      calmarRatio: entry.calmarRatio ? Number(entry.calmarRatio) : undefined,
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

  public async getTraceDetails(idOrVersionId: string): Promise<import("../domain/leaderboard.entity").LeaderboardTraceDetails | null> {
    // 1. Find Leaderboard entry by UUID id OR strategyVersionId
    const entry = await this.prisma.leaderboardEntry.findFirst({
      where: {
        OR: [{ id: idOrVersionId }, { strategyVersionId: idOrVersionId }],
      },
      include: {
        symbol: true,
        strategyVersion: {
          include: {
            definition: true,
            compositeParent: {
              include: {
                componentVersion: true,
              },
            },
          },
        },
      },
    });

    if (!entry) return null;

    // 2. Query matching Experiment (with trades & dataset timeframe bounds)
    const experiment = await this.prisma.experiment.findFirst({
      where: {
        candidate: { strategyVersionId: entry.strategyVersionId },
        symbolId: entry.symbolId,
        timeframe: entry.timeframe,
      },
      orderBy: { createdAt: "desc" },
      include: {
        symbol: true,
        trades: {
          orderBy: { entryTime: "asc" },
          take: 500,
        },
      },
    });

    const compositeComponents = entry.strategyVersion?.compositeParent?.map((cp) => ({
      componentVersionId: cp.componentVersionId,
      componentName: cp.componentVersion?.name || "Child Indicator",
      weight: Number(cp.weight),
      position: cp.position,
    })) || [];

    const mappedEntry: LeaderboardItem = {
      id: entry.id,
      strategyVersionId: entry.strategyVersionId,
      strategyName: entry.strategyVersion?.name || "Strategy",
      strategyVersion: entry.strategyVersion?.version || "1.0.0",
      strategyType: entry.strategyType || "BASE",
      displayNameWithWeights: entry.strategyVersion?.displayNameWithWeights ?? null,
      parameters: (entry.strategyVersion?.parameters as Record<string, unknown>) ?? {},
      symbolId: entry.symbolId,
      symbolCode: entry.symbol?.symbol || "BTCUSDT",
      timeframe: entry.timeframe,
      totalReturn: Number(entry.totalReturn),
      winRate: Number(entry.winRate),
      maxDrawdown: Number(entry.maxDrawdown),
      sharpeRatio: entry.sharpeRatio ? Number(entry.sharpeRatio) : undefined,
      sortinoRatio: entry.sortinoRatio ? Number(entry.sortinoRatio) : undefined,
      calmarRatio: entry.calmarRatio ? Number(entry.calmarRatio) : undefined,
      numTrades: entry.numTrades,
      overallScore: Number(entry.overallScore),
      rank: entry.rank,
      lastEvaluatedAt: entry.lastEvaluatedAt,
    };

    return {
      leaderboardEntry: mappedEntry,
      strategyVersion: {
        id: entry.strategyVersionId,
        version: entry.strategyVersion?.version || "1.0.0",
        name: entry.strategyVersion?.name || "Strategy",
        description: entry.strategyVersion?.description,
        implementationRef: entry.strategyVersion?.implementationRef || "",
        parameters: (entry.strategyVersion?.parameters as Record<string, unknown>) ?? {},
        displayNameWithWeights: entry.strategyVersion?.displayNameWithWeights ?? null,
        strategyType: entry.strategyType || "BASE",
        compositeComponents,
      },
      dataset: {
        symbolId: entry.symbolId,
        symbolCode: entry.symbol?.symbol || "BTCUSDT",
        baseAsset: entry.symbol?.baseAsset || "BTC",
        quoteAsset: entry.symbol?.quoteAsset || "USDT",
        timeframe: entry.timeframe,
        fromTime: experiment ? experiment.fromTime.toString() : null,
        toTime: experiment ? experiment.toTime.toString() : null,
      },
      experiment: experiment
        ? {
            id: experiment.id,
            initialCapital: Number(experiment.initialCapital),
            positionSize: Number(experiment.positionSize),
            positionType: experiment.positionType,
            status: experiment.status,
          }
        : null,
      trades: experiment
        ? experiment.trades.map((t) => ({
            id: t.id,
            side: t.side,
            position: t.position,
            entryTime: Number(t.entryTime),
            entryPrice: Number(t.entryPrice),
            exitTime: t.exitTime ? Number(t.exitTime) : null,
            exitPrice: t.exitPrice ? Number(t.exitPrice) : null,
            quantity: Number(t.quantity),
            profitLoss: t.profitLoss ? Number(t.profitLoss) : null,
            profitLossPct: t.profitLossPct ? Number(t.profitLossPct) : null,
            entryReason: t.entryReason,
            exitReason: t.exitReason,
          }))
        : [],
    };
  }
}

