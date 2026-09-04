/**
 * Phase 3 — `LoopOrchestratorRunner.getRuntimeState` loop-local metrics.
 *
 * Verifies that the loop best strategy comes from `LoopRunState` and
 * is NEVER read from the global leaderboard.
 *
 * Uses an in-memory Prisma stub.
 */

type Row = {
  id: string;
  loopId: string;
  status: string;
  currentIteration: number;
  maxIterations: number;
  maxCandidates: number;
  candidateCountPerIteration: number;
  totalEvaluated: number;
  noImprovementCount: number;
  noImprovementCap: number;
  bestScoreSoFar: number;
  bestStrategyVersionId: string | null;
  bestStrategySymbolId: string | null;
  bestStrategyTimeframe: string | null;
  bestTotalReturn: number | null;
  bestWinRate: number | null;
  stopReason: string | null;
  startedAt: Date;
  updatedAt: Date;
  inFlightSearchRunId: string | null;
  lastIterationSearchRunId: string | null;
  timeLimitSeconds: number;
};

class FakePrisma {
  public loops: Row[] = [];
  public strategyVersions = new Map<string, { id: string; name: string; definition: { type: string } }>();
  public symbols = new Map<string, { id: string; symbol: string }>();
  public backtestResults: { symbolId: string; timeframe: string; strategyVersionId: string; maxDrawdown: number; overallScore: number }[] = [];
  public candidates: { id: string; searchRunId: string }[] = [];
  public iterations: { loopId: string; iterationIndex: number; searchRunId: string | null; candidateCount: number; evaluatedCount: number; status: string }[] = [];

  loopRunState = {
    findUnique: async ({ where }: { where: { loopId: string } }) =>
      this.loops.find((l) => l.loopId === where.loopId) ?? null,
  };
  loopIteration = {
    findFirst: async ({ where, orderBy }: { where: { loopId: string; status: string }; orderBy: { iterationIndex: "desc" } }) => {
      const filtered = this.iterations.filter((i) => i.loopId === where.loopId && i.status === where.status);
      if (orderBy?.iterationIndex === "desc") {
        return filtered.sort((a, b) => b.iterationIndex - a.iterationIndex)[0] ?? null;
      }
      return filtered[0] ?? null;
    },
  };
  strategyVersion = {
    findUnique: async ({ where, include }: { where: { id: string }; include?: { definition: boolean } }) => {
      const v = this.strategyVersions.get(where.id);
      return v ?? null;
    },
  };
  symbol = {
    findUnique: async ({ where }: { where: { id: string } }) => this.symbols.get(where.id) ?? null,
  };
  backtestResult = {
    findFirst: async ({ where }: { where: { experiment: { candidate: { strategyVersionId: string } }; symbolId: string; timeframe: string } }) => {
      const match = this.backtestResults.find(
        (r) =>
          r.strategyVersionId === where.experiment.candidate.strategyVersionId &&
          r.symbolId === where.symbolId &&
          r.timeframe === where.timeframe,
      );
      return match ? { ...match, maxDrawdown: 0.1 } : null;
    },
  };
  candidateStrategy = {
    count: async ({ where }: { where: { searchRunId: string } }) =>
      this.candidates.filter((c) => c.searchRunId === where.searchRunId).length,
  };
}

describe("LoopOrchestratorRunner.getRuntimeState (Phase 3)", () => {
  it("returns loop-local best strategy, NOT global leaderboard Top-1", async () => {
    const prisma = new FakePrisma();
    const loopId = "loop-X";
    prisma.loops.push({
      id: "uuid-X",
      loopId,
      status: "RUNNING",
      currentIteration: 3,
      maxIterations: 20,
      maxCandidates: 100,
      candidateCountPerIteration: 5,
      totalEvaluated: 15,
      noImprovementCount: 0,
      noImprovementCap: 50,
      bestScoreSoFar: 87.5,
      bestStrategyVersionId: "sv-A",
      bestStrategySymbolId: "sym-BTC",
      bestStrategyTimeframe: "1h",
      bestTotalReturn: 0.124,
      bestWinRate: 0.63,
      stopReason: null,
      startedAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(),
      inFlightSearchRunId: null,
      lastIterationSearchRunId: "sr-3",
      timeLimitSeconds: 3600,
    });
    prisma.strategyVersions.set("sv-A", {
      id: "sv-A",
      name: "MA + RSI + SR",
      definition: { type: "COMPOSITE" },
    });
    prisma.symbols.set("sym-BTC", { id: "sym-BTC", symbol: "BTCUSDT" });

    // The loop must NOT query leaderboardEntry. We expose only a
    // minimal shape and assert the result uses loop-local fields.
    const { LoopOrchestratorRunner } = await import(
      "../../src/modules/leaderboard/application/loop-orchestrator-runner"
    );
    const runner = new LoopOrchestratorRunner({
      // searchRepository and strategyVersionMapper are unused by
      // getRuntimeState, so we pass dummy objects.
      searchRepository: {} as never,
      strategyVersionMapper: {} as never,
      prisma: prisma as never,
      eventBus: {
        subscribe: () => ({ unsubscribe: () => undefined }),
        publish: () => undefined,
      } as never,
    });
    const state = await runner.getRuntimeState(loopId);
    expect(state).not.toBeNull();
    expect(state!.loopId).toBe(loopId);
    expect(state!.bestStrategyName).toBe("MA + RSI + SR");
    expect(state!.bestStrategyType).toBe("COMPOSITE");
    expect(state!.bestStrategySymbolCode).toBe("BTCUSDT");
    expect(state!.bestStrategyTimeframe).toBe("1h");
    expect(state!.bestScore).toBe(87.5);
    expect(state!.bestTotalReturn).toBeCloseTo(0.124);
    expect(state!.bestWinRate).toBeCloseTo(0.63);
    expect(state!.currentIteration).toBe(3);
    expect(state!.maxIterations).toBe(20);
  });

  it("returns null when loop does not exist", async () => {
    const prisma = new FakePrisma();
    const { LoopOrchestratorRunner } = await import(
      "../../src/modules/leaderboard/application/loop-orchestrator-runner"
    );
    const runner = new LoopOrchestratorRunner({
      searchRepository: {} as never,
      strategyVersionMapper: {} as never,
      prisma: prisma as never,
      eventBus: {
        subscribe: () => ({ unsubscribe: () => undefined }),
        publish: () => undefined,
      } as never,
    });
    const state = await runner.getRuntimeState("nonexistent-loop");
    expect(state).toBeNull();
  });

  it("returns null best fields when loop has no best strategy yet", async () => {
    const prisma = new FakePrisma();
    prisma.loops.push({
      id: "uuid-Y",
      loopId: "loop-Y",
      status: "RUNNING",
      currentIteration: 0,
      maxIterations: 20,
      maxCandidates: 100,
      candidateCountPerIteration: 5,
      totalEvaluated: 0,
      noImprovementCount: 0,
      noImprovementCap: 50,
      bestScoreSoFar: 0,
      bestStrategyVersionId: null,
      bestStrategySymbolId: null,
      bestStrategyTimeframe: null,
      bestTotalReturn: null,
      bestWinRate: null,
      stopReason: null,
      startedAt: new Date(),
      updatedAt: new Date(),
      inFlightSearchRunId: null,
      lastIterationSearchRunId: null,
      timeLimitSeconds: 3600,
    });
    const { LoopOrchestratorRunner } = await import(
      "../../src/modules/leaderboard/application/loop-orchestrator-runner"
    );
    const runner = new LoopOrchestratorRunner({
      searchRepository: {} as never,
      strategyVersionMapper: {} as never,
      prisma: prisma as never,
      eventBus: {
        subscribe: () => ({ unsubscribe: () => undefined }),
        publish: () => undefined,
      } as never,
    });
    const state = await runner.getRuntimeState("loop-Y");
    expect(state).not.toBeNull();
    expect(state!.bestStrategyName).toBeNull();
    expect(state!.bestStrategyType).toBeNull();
    expect(state!.bestStrategySymbolCode).toBeNull();
    expect(state!.bestTotalReturn).toBeNull();
    expect(state!.bestWinRate).toBeNull();
  });
});
