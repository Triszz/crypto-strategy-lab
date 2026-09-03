import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
import { getSocketServer } from "../../../infrastructure/websocket/socket";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import {
  LeaderboardFilterOptions,
  LeaderboardItem,
  LeaderboardRepository,
  RankingHistoryItem,
} from "../domain/leaderboard.entity";

export interface StrategyEvaluatedPayload {
  experimentId: string;
  strategyVersionId: string;
  symbolId: string;
  timeframe: string;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  calmarRatio?: number;
  numTrades: number;
  overallScore: number;
}

export class LeaderboardService {
  private prisma = getPrismaClient();

  constructor(
    private readonly repository: LeaderboardRepository,
    private readonly eventBus: EventBus = getEventBus()
  ) {
    this.registerEventListener();
  }

  private registerEventListener(): void {
    this.eventBus.subscribe<StrategyEvaluatedPayload>("StrategyEvaluated", (payload) => {
      void this.handleStrategyEvaluated(payload);
    });
  }

  public async handleStrategyEvaluated(payload: StrategyEvaluatedPayload): Promise<LeaderboardItem[]> {
    if (!payload || !payload.strategyVersionId) return [];

    let strategyType = "BASE";
    try {
      const ver = await this.prisma.strategyVersion.findUnique({
        where: { id: payload.strategyVersionId },
        include: { definition: true },
      });
      if (ver?.definition?.type) {
        strategyType = ver.definition.type;
      }
    } catch {
      // Fallback
    }

    await this.repository.upsertEntry({
      strategyVersionId: payload.strategyVersionId,
      symbolId: payload.symbolId,
      timeframe: payload.timeframe,
      strategyType,
      totalReturn: payload.totalReturn,
      winRate: payload.winRate,
      maxDrawdown: payload.maxDrawdown,
      sharpeRatio: payload.sharpeRatio,
      sortinoRatio: payload.sortinoRatio,
      calmarRatio: payload.calmarRatio,
      numTrades: payload.numTrades,
      overallScore: payload.overallScore,
    });

    const updatedLeaderboard = await this.repository.recalculateRanks(
      payload.symbolId,
      payload.timeframe
    );

    const updatePayload = {
      symbolId: payload.symbolId,
      timeframe: payload.timeframe,
      topK: updatedLeaderboard.slice(0, 10),
      timestamp: new Date().toISOString(),
    };

    this.eventBus.publish("LeaderboardUpdated", updatePayload);

    // If candidate took Rank #1, emit NewTopStrategyFound event for Continuous Loop feedback
    if (updatedLeaderboard.length > 0 && updatedLeaderboard[0]?.strategyVersionId === payload.strategyVersionId) {
      this.eventBus.publish("NewTopStrategyFound", {
        strategyVersionId: payload.strategyVersionId,
        symbolId: payload.symbolId,
        timeframe: payload.timeframe,
        overallScore: payload.overallScore,
        strategyType,
        evaluatedAt: new Date().toISOString(),
      });
    }

    try {
      const io = getSocketServer();
      io.emit("LeaderboardUpdated", updatePayload);
    } catch {
      // Socket server optional
    }

    return updatedLeaderboard;
  }

  public async getTopK(options: LeaderboardFilterOptions): Promise<LeaderboardItem[]> {
    return this.repository.getTopK(options);
  }

  public async getRankHistory(strategyVersionId: string): Promise<RankingHistoryItem[]> {
    return this.repository.getHistory(strategyVersionId);
  }
}
