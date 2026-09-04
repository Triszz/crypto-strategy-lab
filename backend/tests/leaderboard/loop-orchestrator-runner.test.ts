/**
 * Tests for `LoopOrchestratorRunner` — the Strategy/Search-side consumer
 * of `NewTopStrategyFound`. Uses an in-process Prisma-like stub and an
 * in-process EventBus so the test does not require a live database.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LoopOrchestratorRunner, type NewTopStrategyFoundPayload } from "../../src/modules/leaderboard/application/loop-orchestrator-runner";
import { getEventBus } from "../../src/shared/event-bus/EventBus";

/* ─── Prisma stub ───────────────────────────────────────────────────────── */

class FakePrisma {
  public loopProcessedEvents: Array<{
    id: string;
    dedupeKey: string;
    strategyVersionId: string;
    overallScore: number;
    evaluatedAt: Date;
    loopId: string | null;
    createdAt: Date;
  }> = [];
  public loopRunStates: Array<{
    id: string;
    loopId: string;
    status: string;
    currentIteration: number;
    lastIterationSearchRunId: string | null;
    bestScoreSoFar: number;
    startedAt: Date;
    updatedAt: Date;
  }> = [];
  public loopIterations: Array<{
    id: string;
    loopId: string;
    iterationIndex: number;
    parentStrategyVersionId: string;
    searchRunId: string | null;
    candidateCount: number;
    status: string;
    createdAt: Date;
  }> = [];
  public strategyVersions: Map<string, FakeVersion> = new Map();
  public compositeComponents: Array<{
    compositeVersionId: string;
    componentVersionId: string;
    weight: number;
    position: number;
    componentVersion: { implementationRef: string; parameters: Record<string, unknown> };
  }> = [];
  public searchAlgorithms: Array<{ id: string; code: string }> = [];
  public symbols: Array<{ id: string; symbol: string }> = [];
  public leaderboardEntries: Array<{
    id: string;
    strategyVersionId: string;
    symbolId: string;
    timeframe: string;
    strategyType: string;
    totalReturn: number;
    winRate: number;
    overallScore: number;
    strategyVersion: { name: string };
    symbol: { symbol: string };
  }> = [];
  public createdRuns: Array<{ id: string; config: Record<string, unknown>; maxCandidates: number; status: string }> = [];
  public createdCandidates: Array<{ id: string; searchRunId: string; strategyVersionId: string; parameters: Record<string, unknown> }> = [];

  private nextId = 1;
  private genId(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  // ── LoopProcessedEvent ───────────────────────────────────────────────
  public loopProcessedEvent = {
    create: async ({ data }: { data: { dedupeKey: string; strategyVersionId: string; overallScore: number; evaluatedAt: Date } }) => {
      if (this.loopProcessedEvents.find((e) => e.dedupeKey === data.dedupeKey)) {
        const err = new Error("Unique constraint failed") as Error & { code?: string };
        err.code = "P2002";
        throw err;
      }
      const row = {
        id: this.genId("pe"),
        dedupeKey: data.dedupeKey,
        strategyVersionId: data.strategyVersionId,
        overallScore: data.overallScore,
        evaluatedAt: data.evaluatedAt,
        loopId: null as string | null,
        createdAt: new Date(),
      };
      this.loopProcessedEvents.push(row);
      return row;
    },
  };

  // ── LoopRunState ─────────────────────────────────────────────────────
  public loopRunState = {
    findMany: async ({ where }: { where?: { status?: string } } = {}) => {
      return this.loopRunStates.filter(
        (r) => !where?.status || r.status === where.status,
      );
    },
    findUnique: async ({ where }: { where: { loopId: string } }) => {
      return this.loopRunStates.find((r) => r.loopId === where.loopId) ?? null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.loopRunStates.find((r) => r.id === where.id);
      if (!row) return null;
      Object.assign(row, data);
      return row;
    },
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { loopId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => {
      const existing = this.loopRunStates.find((r) => r.loopId === where.loopId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = {
        id: this.genId("lr"),
        loopId: create["loopId"] as string,
        status: (create["status"] as string) ?? "RUNNING",
        currentIteration: (create["currentIteration"] as number) ?? 0,
        lastIterationSearchRunId: (create["lastIterationSearchRunId"] as string | null) ?? null,
        bestScoreSoFar: (create["bestScoreSoFar"] as number) ?? 0,
        startedAt: (create["startedAt"] as Date) ?? new Date(),
        updatedAt: new Date(),
      };
      this.loopRunStates.push(row);
      return row;
    },
  };

  // ── LoopIteration ────────────────────────────────────────────────────
  public loopIteration = {
    create: async ({ data }: { data: { loopId: string; iterationIndex: number; parentStrategyVersionId: string; searchRunId?: string; candidateCount?: number; status?: string } }) => {
      const row = {
        id: this.genId("li"),
        loopId: data.loopId,
        iterationIndex: data.iterationIndex,
        parentStrategyVersionId: data.parentStrategyVersionId,
        searchRunId: data.searchRunId ?? null,
        candidateCount: data.candidateCount ?? 0,
        status: data.status ?? "DONE",
        createdAt: new Date(),
      };
      this.loopIterations.push(row);
      return row;
    },
    findFirst: async ({ where, orderBy }: { where?: { loopId?: string }; orderBy?: { iterationIndex?: "asc" | "desc" } }) => {
      let xs = this.loopIterations.slice();
      if (where?.loopId) xs = xs.filter((x) => x.loopId === where.loopId);
      if (orderBy?.iterationIndex === "desc") {
        xs.sort((a, b) => b.iterationIndex - a.iterationIndex);
      }
      return xs[0] ?? null;
    },
  };

  // ── StrategyVersion ──────────────────────────────────────────────────
  public strategyVersion = {
    findUnique: async ({ where, include }: { where: { id: string }; include?: { definition?: boolean } }) => {
      const v = this.strategyVersions.get(where.id);
      if (!v) return null;
      return {
        ...v,
        definition: v.definition,
      };
    },
  };

  // ── CompositeComponent ───────────────────────────────────────────────
  public compositeComponent = {
    findMany: async ({ where, orderBy, include }: { where: { compositeVersionId: string }; orderBy?: { position?: "asc" }; include?: { componentVersion?: { select?: { implementationRef: boolean; parameters: boolean } } } }) => {
      let xs = this.compositeComponents.filter((c) => c.compositeVersionId === where.compositeVersionId);
      if (orderBy?.position === "asc") xs = xs.slice().sort((a, b) => a.position - b.position);
      return xs;
    },
  };

  // ── SearchAlgorithm ──────────────────────────────────────────────────
  public searchAlgorithm = {
    findFirst: async ({ where }: { where: { code: string } }) => this.searchAlgorithms.find((a) => a.code === where.code) ?? null,
    create: async ({ data }: { data: { code: string; name: string; implementationRef: string } }) => {
      const row = { id: this.genId("alg"), code: data.code };
      this.searchAlgorithms.push(row);
      return row;
    },
  };

  // ── Symbol ───────────────────────────────────────────────────────────
  public symbol = {
    findUnique: async ({ where }: { where: { id?: string; symbol?: string } }) => {
      if (where.id) return this.symbols.find((s) => s.id === where.id) ?? null;
      if (where.symbol) return this.symbols.find((s) => s.symbol === where.symbol) ?? null;
      return null;
    },
  };

  // ── LeaderboardEntry ─────────────────────────────────────────────────
  // Minimal stub matching the methods `LoopOrchestratorRunner.getRuntimeState`
  // calls (a top-1 lookup ordered by overallScore).
  public leaderboardEntry = {
    findFirst: async ({
      orderBy,
    }: { where?: unknown; orderBy?: { overallScore?: "asc" | "desc" } }) => {
      if (this.leaderboardEntries.length === 0) return null;
      const dir = orderBy?.overallScore === "asc" ? 1 : -1;
      return [...this.leaderboardEntries].sort(
        (a, b) => dir * (a.overallScore - b.overallScore),
      )[0]!;
    },
  };

  // ── SearchRun ────────────────────────────────────────────────────────
  public searchRun = {
    create: async ({ data }: { data: { algorithmId: string; symbolId: string; timeframe: string; maxCandidates: number; createdBy?: string; config?: Record<string, unknown> } }) => {
      const row = {
        id: this.genId("run"),
        config: (data.config as Record<string, unknown>) ?? {},
        maxCandidates: data.maxCandidates,
        status: "PENDING",
      };
      this.createdRuns.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.createdRuns.find((r) => r.id === where.id);
      if (!row) return null;
      Object.assign(row, data);
      return row;
    },
  };

  // ── CandidateStrategy ───────────────────────────────────────────────
  public candidateStrategy = {
    create: async ({ data }: { data: { searchRunId: string; strategyVersionId: string; parameters: Record<string, unknown> } }) => {
      const row = {
        id: this.genId("cand"),
        searchRunId: data.searchRunId,
        strategyVersionId: data.strategyVersionId,
        parameters: data.parameters,
      };
      this.createdCandidates.push(row);
      return row;
    },
  };
}

interface FakeVersion {
  id: string;
  implementationRef: string;
  parameters: Record<string, unknown>;
  definition: { type: "BASE" | "COMPOSITE" };
  name: string;
}

/* ─── Repository stub ───────────────────────────────────────────────────── */

function makeFakeRepository(prisma: FakePrisma) {
  return {
    createSearchRun: async (input: { algorithmId: string; symbolId: string; timeframe: string; maxCandidates: number; createdBy?: string; config?: Record<string, unknown> }) => {
      const row = await prisma.searchRun.create({ data: input });
      return {
        id: row.id,
        algorithmId: input.algorithmId,
        symbolId: input.symbolId,
        timeframe: input.timeframe,
        maxCandidates: input.maxCandidates,
        fromTime: undefined,
        toTime: undefined,
        status: "PENDING" as const,
        startedAt: undefined,
        finishedAt: undefined,
        createdBy: input.createdBy,
        config: input.config ?? {},
        createdAt: new Date(),
      };
    },
    updateSearchRunStatus: async (id: string, status: string, startedAt?: Date, finishedAt?: Date) => {
      await prisma.searchRun.update({
        where: { id },
        data: { status, startedAt, finishedAt },
      });
    },
    createCandidate: async (input: { searchRunId: string; strategyVersionId: string; parameters: Record<string, unknown> }) => {
      const row = await prisma.candidateStrategy.create({ data: input });
      return {
        id: row.id,
        searchRunId: input.searchRunId,
        strategyVersionId: input.strategyVersionId,
        parameters: input.parameters,
        status: "PENDING" as const,
        createdAt: new Date(),
      };
    },
    getCandidatesByRun: async () => [],
    getSearchRun: async () => null,
    listSearchRuns: async () => [],
    countCandidatesByRun: async () => 0,
    getAlgorithmSummary: async () => ({ id: "a", code: "loop_mutation", name: "loop" }),
    getSymbolSummary: async () => ({ id: "s", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }),
  } as any;
}

/* ─── StrategyVersionMapper stub ────────────────────────────────────────── */

function makeFakeMapper() {
  return {
    resolveBaseStrategy: async (strategyId: string) => ({
      strategyVersionId: `ver-${strategyId}`,
      definitionId: `def-${strategyId}`,
      definitionType: "BASE" as const,
    }),
    resolveCompositeStrategy: async (config: { id: string; name: string }) => ({
      strategyVersionId: `ver-${config.id}`,
      definitionId: `def-${config.id}`,
      definitionType: "COMPOSITE" as const,
    }),
  } as any;
}

/* ─── Tests ─────────────────────────────────────────────────────────────── */

describe("LoopOrchestratorRunner", () => {
  let prisma: FakePrisma;
  let runner: LoopOrchestratorRunner;
  let eventBus: ReturnType<typeof getEventBus>;
  let published: Array<{ event: string; payload: unknown }>;

  beforeEach(async () => {
    prisma = new FakePrisma();
    eventBus = getEventBus();
    // Reset the singleton's listeners so cross-test bleed does not happen.
    eventBus.dispose();
    eventBus = getEventBus();
    published = [];
    const origPublish = eventBus.publish.bind(eventBus);
    eventBus.publish = (event, payload) => {
      published.push({ event, payload });
      origPublish(event, payload);
    };

    // Pre-seed a parent BASE StrategyVersion.
    prisma.strategyVersions.set("ver-parent-1", {
      id: "ver-parent-1",
      implementationRef: "strategy.ma",
      parameters: { fastPeriod: 9, slowPeriod: 21 },
      definition: { type: "BASE" },
      name: "Moving Average",
    });

    // Pre-seed an algorithm + symbol.
    prisma.searchAlgorithms.push({ id: "alg-loop", code: "loop_mutation" });
    prisma.symbols.push({ id: "sym-btc", symbol: "BTCUSDT" });

    runner = new LoopOrchestratorRunner({
      prisma: prisma as unknown as ConstructorParameters<typeof LoopOrchestratorRunner>[0]["prisma"] extends infer T ? T : never,
      eventBus,
      searchRepository: makeFakeRepository(prisma),
      strategyVersionMapper: makeFakeMapper(),
      candidateCount: 3,
    });
  });

  it("consumes NewTopStrategyFound and produces a new SearchRun via LoopMutationGenerator", async () => {
    // Seed an active loop.
    await prisma.loopRunState.upsert({
      where: { loopId: "main" },
      update: {},
      create: {
        loopId: "main",
        status: "RUNNING",
        bestScoreSoFar: 0,
      } as any,
    });

    const payload: NewTopStrategyFoundPayload = {
      strategyVersionId: "ver-parent-1",
      overallScore: 80.0,
      symbolId: "sym-btc",
      timeframe: "1h",
      strategyType: "BASE",
      evaluatedAt: new Date().toISOString(),
    };
    await runner.handleNewTop(payload);

    // Expect: 1 SearchRun created, 3 candidates emitted (candidateCount = 3).
    expect(prisma.createdRuns.length).toBe(1);
    expect(prisma.createdCandidates.length).toBe(3);
    const lastRun = prisma.createdRuns[0]!;
    expect(lastRun.config["loopId"]).toBe("main");
    expect(lastRun.config["parentStrategyVersionId"]).toBe("ver-parent-1");
    expect(lastRun.config["generatorId"]).toBe("loop_mutation");
    expect(lastRun.config["iteration"]).toBe(1);

    // 1 LoopIteration row persisted.
    expect(prisma.loopIterations.length).toBe(1);
    expect(prisma.loopIterations[0]!.iterationIndex).toBe(1);

    // StrategyGenerated published for each candidate.
    const generated = published.filter((p) => p.event === "StrategyGenerated");
    expect(generated.length).toBe(3);

    // ProcessedEvent dedupe row created.
    expect(prisma.loopProcessedEvents.length).toBe(1);
  });

  it("does NOT run an iteration when no loop is RUNNING", async () => {
    // No active loop.
    const payload: NewTopStrategyFoundPayload = {
      strategyVersionId: "ver-parent-1",
      overallScore: 80.0,
      symbolId: "sym-btc",
      timeframe: "1h",
      strategyType: "BASE",
      evaluatedAt: new Date().toISOString(),
    };
    await runner.handleNewTop(payload);

    expect(prisma.createdRuns.length).toBe(0);
    expect(prisma.createdCandidates.length).toBe(0);
  });

  it("ignores duplicate NewTopStrategyFound events (idempotency)", async () => {
    await prisma.loopRunState.upsert({
      where: { loopId: "main" },
      update: {},
      create: { loopId: "main", status: "RUNNING", bestScoreSoFar: 0 } as any,
    });

    const payload: NewTopStrategyFoundPayload = {
      strategyVersionId: "ver-parent-1",
      overallScore: 80.0,
      symbolId: "sym-btc",
      timeframe: "1h",
      strategyType: "BASE",
      evaluatedAt: new Date().toISOString(),
    };

    await runner.handleNewTop(payload);
    await runner.handleNewTop(payload);
    await runner.handleNewTop(payload);

    // Only ONE iteration, ONE SearchRun, ONE set of candidates.
    expect(prisma.createdRuns.length).toBe(1);
    expect(prisma.createdCandidates.length).toBe(3);
    expect(prisma.loopIterations.length).toBe(1);
  });

  it("handles COMPOSITE parents by resolving all components", async () => {
    // Seed a composite parent.
    prisma.strategyVersions.set("ver-comp-parent", {
      id: "ver-comp-parent",
      implementationRef: "strategy.composite.test",
      parameters: {},
      definition: { type: "COMPOSITE" },
      name: "MA + RSI",
    });
    prisma.compositeComponents.push({
      compositeVersionId: "ver-comp-parent",
      componentVersionId: "ver-c1",
      weight: 0.5,
      position: 0,
      componentVersion: { implementationRef: "strategy.ma", parameters: { fastPeriod: 9 } },
    });
    prisma.compositeComponents.push({
      compositeVersionId: "ver-comp-parent",
      componentVersionId: "ver-c2",
      weight: 0.5,
      position: 1,
      componentVersion: { implementationRef: "strategy.rsi", parameters: { period: 14 } },
    });

    await prisma.loopRunState.upsert({
      where: { loopId: "main" },
      update: {},
      create: { loopId: "main", status: "RUNNING", bestScoreSoFar: 0 } as any,
    });

    const payload: NewTopStrategyFoundPayload = {
      strategyVersionId: "ver-comp-parent",
      overallScore: 75.0,
      symbolId: "sym-btc",
      timeframe: "4h",
      strategyType: "COMPOSITE",
      evaluatedAt: new Date().toISOString(),
    };
    await runner.handleNewTop(payload);

    // Each candidate is COMPOSITE.
    const cands = prisma.createdCandidates;
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      const params = c.parameters as Record<string, unknown>;
      expect(params["_candidateType"]).toBe("COMPOSITE");
    }
  });

  it("bump iteration counter across multiple Top-1 events", async () => {
    await prisma.loopRunState.upsert({
      where: { loopId: "main" },
      update: {},
      create: { loopId: "main", status: "RUNNING", bestScoreSoFar: 0 } as any,
    });

    // Each NewTopStrategyFound must use a distinct dedupe key.
    const baseTime = Date.now();
    for (let i = 1; i <= 3; i += 1) {
      await runner.handleNewTop({
        strategyVersionId: "ver-parent-1",
        overallScore: 80 + i,
        symbolId: "sym-btc",
        timeframe: "1h",
        strategyType: "BASE",
        evaluatedAt: new Date(baseTime + i * 1000).toISOString(),
      });
    }

    // 3 SearchRuns, 3 LoopIterations, iterationIndex 1..3.
    expect(prisma.createdRuns.length).toBe(3);
    const iters = prisma.loopIterations.map((x) => x.iterationIndex).sort();
    expect(iters).toEqual([1, 2, 3]);
  });

  it("subscribes to NewTopStrategyFound events when startListening() is called", async () => {
    await prisma.loopRunState.upsert({
      where: { loopId: "main" },
      update: {},
      create: { loopId: "main", status: "RUNNING", bestScoreSoFar: 0 } as any,
    });
    runner.startListening();
    eventBus.publish<NewTopStrategyFoundPayload>("NewTopStrategyFound", {
      strategyVersionId: "ver-parent-1",
      overallScore: 80.0,
      symbolId: "sym-btc",
      timeframe: "1h",
      strategyType: "BASE",
      evaluatedAt: new Date().toISOString(),
    });
    // allow microtasks to flush
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(prisma.createdRuns.length).toBe(1);
  });

  it("exposes loop runtime state via getRuntimeState()", async () => {
    await prisma.loopRunState.upsert({
      where: { loopId: "main" },
      update: {},
      create: { loopId: "main", status: "RUNNING", bestScoreSoFar: 0 } as any,
    });

    await runner.handleNewTop({
      strategyVersionId: "ver-parent-1",
      overallScore: 80.0,
      symbolId: "sym-btc",
      timeframe: "1h",
      strategyType: "BASE",
      evaluatedAt: new Date().toISOString(),
    });

    const state = await runner.getRuntimeState("main");
    expect(state).not.toBeNull();
    expect(state?.loopId).toBe("main");
    expect(state?.currentIteration).toBe(1);
    expect(state?.lastIterationSearchRunId).not.toBeNull();
  });
});

// Silence "vi" unused warning while keeping imports minimal.
void vi;
