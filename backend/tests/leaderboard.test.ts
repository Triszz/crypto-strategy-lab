import { describe, it, expect, beforeEach } from "vitest";
import { LeaderboardService } from "../src/modules/leaderboard/application/leaderboard.service";
import {
  LeaderboardFilterOptions,
  LeaderboardItem,
  LeaderboardRepository,
  RankingHistoryItem,
} from "../src/modules/leaderboard/domain/leaderboard.entity";
import { setEventBus, resetEventBus } from "../src/shared/event-bus/EventBus";

// In-memory Mock Repository for Leaderboard testing
class MockLeaderboardRepository implements LeaderboardRepository {
  public entries = new Map<string, LeaderboardItem>();
  public history: RankingHistoryItem[] = [];

  public async upsertEntry(entry: Omit<LeaderboardItem, "id" | "rank" | "lastEvaluatedAt">): Promise<void> {
    const key = `${entry.strategyVersionId}:${entry.symbolId}:${entry.timeframe}`;
    const existing = this.entries.get(key);
    const item: LeaderboardItem = {
      id: existing ? existing.id : `ent-${key}`,
      ...entry,
      rank: existing ? existing.rank : 999,
      lastEvaluatedAt: new Date(),
    };
    this.entries.set(key, item);
  }

  public async recalculateRanks(symbolId?: string, timeframe?: string): Promise<LeaderboardItem[]> {
    let list = Array.from(this.entries.values());
    if (symbolId) list = list.filter((e) => e.symbolId === symbolId);
    if (timeframe) list = list.filter((e) => e.timeframe === timeframe);

    // Sort by overallScore DESC
    list.sort((a, b) => b.overallScore - a.overallScore);

    const updated: LeaderboardItem[] = [];
    for (let i = 0; i < list.length; i++) {
      const rank = i + 1;
      const item = { ...list[i], rank };
      const key = `${item.strategyVersionId}:${item.symbolId}:${item.timeframe}`;
      this.entries.set(key, item);
      updated.push(item);

      this.history.push({
        id: `hist-${Date.now()}-${i}`,
        strategyVersionId: item.strategyVersionId,
        rank,
        overallScore: item.overallScore,
        snapshotAt: new Date(),
      });
    }

    return updated;
  }

  public async getTopK(options: LeaderboardFilterOptions): Promise<LeaderboardItem[]> {
    let list = Array.from(this.entries.values());
    if (options.symbolId) list = list.filter((e) => e.symbolId === options.symbolId);
    if (options.timeframe) list = list.filter((e) => e.timeframe === options.timeframe);

    // Sort by overallScore DESC
    list.sort((a, b) => b.overallScore - a.overallScore);

    const limit = Math.min(100, Math.max(1, options.limit || 10));
    return list.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
  }

  public async getHistory(strategyVersionId: string): Promise<RankingHistoryItem[]> {
    return this.history
      .filter((h) => h.strategyVersionId === strategyVersionId)
      .sort((a, b) => b.snapshotAt.getTime() - a.snapshotAt.getTime())
      .slice(0, 50);
  }
}

describe("Leaderboard Module Unit & Event Tests", () => {
  let repository: MockLeaderboardRepository;
  let service: LeaderboardService;
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

    repository = new MockLeaderboardRepository();
    service = new LeaderboardService(repository, mockBus as any);
  });

  it("upserts entry and calculates rank correctly", async () => {
    await repository.upsertEntry({
      strategyVersionId: "ver-1",
      symbolId: "sym-btc",
      timeframe: "1h",
      totalReturn: 0.2,
      winRate: 0.7,
      maxDrawdown: 0.05,
      numTrades: 50,
      overallScore: 35.0,
    });

    const ranks = await repository.recalculateRanks("sym-btc", "1h");
    expect(ranks.length).toBe(1);
    expect(ranks[0].rank).toBe(1);
    expect(ranks[0].overallScore).toBe(35.0);
  });

  it("orders strategies by overallScore DESC in recalculateRanks and getTopK", async () => {
    await repository.upsertEntry({
      strategyVersionId: "ver-low",
      symbolId: "sym-btc",
      timeframe: "1h",
      totalReturn: 0.05,
      winRate: 0.5,
      maxDrawdown: 0.1,
      numTrades: 40,
      overallScore: 10.0,
    });

    await repository.upsertEntry({
      strategyVersionId: "ver-high",
      symbolId: "sym-btc",
      timeframe: "1h",
      totalReturn: 0.4,
      winRate: 0.8,
      maxDrawdown: 0.02,
      numTrades: 60,
      overallScore: 45.0,
    });

    const topK = await service.getTopK({ symbolId: "sym-btc", timeframe: "1h", limit: 10 });
    expect(topK.length).toBe(2);
    expect(topK[0].strategyVersionId).toBe("ver-high");
    expect(topK[0].rank).toBe(1);
    expect(topK[1].strategyVersionId).toBe("ver-low");
    expect(topK[1].rank).toBe(2);
  });

  it("handles StrategyEvaluated event, upserts entry, recalculates ranks and publishes LeaderboardUpdated", async () => {
    const payload = {
      experimentId: "exp-100",
      strategyVersionId: "ver-event",
      symbolId: "sym-btc",
      timeframe: "5m",
      totalReturn: 0.15,
      winRate: 0.65,
      maxDrawdown: 0.04,
      numTrades: 35,
      overallScore: 28.0,
    };

    const res = await service.handleStrategyEvaluated(payload);
    expect(res.length).toBe(1);
    expect(res[0].strategyVersionId).toBe("ver-event");

    const emitted = publishedEvents.find((e) => e.event === "LeaderboardUpdated");
    expect(emitted).toBeDefined();
    expect(emitted?.payload).toMatchObject({
      symbolId: "sym-btc",
      timeframe: "5m",
    });
  });

  it("retrieves rank history for a strategy version", async () => {
    await repository.upsertEntry({
      strategyVersionId: "ver-hist",
      symbolId: "sym-btc",
      timeframe: "1h",
      totalReturn: 0.1,
      winRate: 0.6,
      maxDrawdown: 0.05,
      numTrades: 40,
      overallScore: 20.0,
    });

    await repository.recalculateRanks("sym-btc", "1h");

    const history = await service.getRankHistory("ver-hist");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].strategyVersionId).toBe("ver-hist");
    expect(history[0].rank).toBe(1);
  });
});
