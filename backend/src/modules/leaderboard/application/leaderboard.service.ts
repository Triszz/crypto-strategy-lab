import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
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
  numTrades: number;
  overallScore: number;
}

export class LeaderboardService {
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

    await this.repository.upsertEntry({
      strategyVersionId: payload.strategyVersionId,
      symbolId: payload.symbolId,
      timeframe: payload.timeframe,
      totalReturn: payload.totalReturn,
      winRate: payload.winRate,
      maxDrawdown: payload.maxDrawdown,
      numTrades: payload.numTrades,
      overallScore: payload.overallScore,
    });

    const updatedLeaderboard = await this.repository.recalculateRanks(
      payload.symbolId,
      payload.timeframe
    );

    this.eventBus.publish("LeaderboardUpdated", {
      symbolId: payload.symbolId,
      timeframe: payload.timeframe,
      topK: updatedLeaderboard.slice(0, 10),
      timestamp: new Date().toISOString(),
    });

    return updatedLeaderboard;
  }

  public async getTopK(options: LeaderboardFilterOptions): Promise<LeaderboardItem[]> {
    return this.repository.getTopK(options);
  }

  public async getRankHistory(strategyVersionId: string): Promise<RankingHistoryItem[]> {
    return this.repository.getHistory(strategyVersionId);
  }
}
