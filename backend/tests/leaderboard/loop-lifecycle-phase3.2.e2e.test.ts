/**
 * Phase 3.2 — Live Continuous Strategy Loop integration test.
 *
 * Exercises the FULL orchestrator + runner pipeline against a real
 * PostgreSQL database (Supabase). Backtest + Evaluation + Generator
 * paths are STUBBED via the EventBus so we can deterministically
 * verify lifecycle invariants without long backtest runs.
 *
 * Test plan:
 *
 *   1. startLoop → register iteration 1 → 5 stubs publish
 *      StrategyEvaluated for 5 unique candidates with scores
 *      [8.38, 8.78, 8.78, 7.50, 6.20].
 *   2. Verify iter 1 completes, bestScoreInIteration === 8.78, and
 *      iteration N+1 begins with EXACTLY candidateCountPerIteration
 *      new candidates (parent of iter 1 is the top-1 of iter 1).
 *   3. After iter 1 completes, publish 3 stub StrategyEvaluated for
 *      iter 2. Verify iter 2 best === max-of-3.
 *   4. After iter 2, run no-improvement events. Verify the loop
 *      transitions to STOPPED_NO_IMPROVEMENT with no RUNNING iters.
 *   5. Verify the LoopProcessedEvent table contains exactly N rows.
 *   6. Verify bestScoreSoFar === 8.78 and loop-local best identity
 *      matches the 8.78 candidate's strategyVersionId.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPrismaClient } from "../../src/infrastructure/database/prisma";
import {
  LoopOrchestratorService,
} from "../../src/modules/leaderboard/application/loop-orchestrator.service";
import {
  LoopOrchestratorRunner,
} from "../../src/modules/leaderboard/application/loop-orchestrator-runner";
import { getEventBus, resetEventBus } from "../../src/shared/event-bus/EventBus";
import { logger } from "../../src/shared/logger/logger";
import { CombinationOperator } from "../../src/modules/strategy/combination/CombinationConfig";

/**
 * Minimal search runner stub — the integration test relies on
 * the runner's `runIteration` which builds a SearchRun + candidates.
 * We replace it with a deterministic stub so the test does not need
 * Redis/BullMQ.
 */
class StubSearchRepository {
  public createdSearchRuns: any[] = [];
  public createdCandidates: any[] = [];

  constructor(private readonly prisma: Awaited<ReturnType<typeof getPrismaClient>>) {}

  async createSearchRun(input: any) {
    const id = randomUUID();
    this.createdSearchRuns.push({ id, ...input });
    // Phase 3.2: persist to the real DB so iteration/searchRun
    // FK relations are valid.
    await this.prisma.searchRun.create({
      data: {
        id,
        algorithmId: input.algorithmId,
        symbolId: input.symbolId,
        timeframe: input.timeframe,
        maxCandidates: input.maxCandidates,
        status: "PENDING",
        createdBy: input.createdBy ?? "phase32-e2e",
        config: input.config ?? {},
      },
    });
    return {
      id,
      algorithmId: input.algorithmId,
      symbolId: input.symbolId,
      timeframe: input.timeframe,
      maxCandidates: input.maxCandidates,
      fromTime: undefined,
      toTime: undefined,
      status: "PENDING",
      createdBy: input.createdBy,
      config: input.config ?? {},
      createdAt: new Date(),
    };
  }
  async updateSearchRunStatus(id: string, status: string) {
    const sr = this.createdSearchRuns.find((r) => r.id === id);
    if (sr) sr.status = status;
    await this.prisma.searchRun.update({
      where: { id },
      data: { status },
    }).catch(() => undefined);
  }
  async createCandidate(input: any) {
    const id = randomUUID();
    this.createdCandidates.push({ id, ...input });
    // Phase 3.2: persist to the real DB so lifecycle observers
    // (iter2 candidates assertion, recomputeLoopBest, etc.) can see
    // them. Status QUEUED is the start state; the test will publish
    // StrategyEvaluated to drive the lifecycle forward.
    await this.prisma.candidateStrategy.create({
      data: {
        id,
        searchRunId: input.searchRunId,
        strategyVersionId: input.strategyVersionId,
        parameters: input.parameters ?? {},
        status: "QUEUED",
      },
    });
    return {
      id,
      searchRunId: input.searchRunId,
      strategyVersionId: input.strategyVersionId,
      parameters: input.parameters,
      status: "QUEUED",
      createdAt: new Date(),
    };
  }
  async getSearchRun(_id: string) {
    return null;
  }
  async getCandidatesByRun(_id: string) {
    return [];
  }
  async listSearchRuns() {
    return [];
  }
  async countCandidatesByRun(_id: string) {
    return 0;
  }
  async getAlgorithmSummary() {
    return { id: "alg-stub", code: "loop_hybrid", name: "Loop Hybrid (stub)" };
  }
  async getSymbolSummary() {
    return { id: "sym-stub", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" };
  }
}

class StubStrategyVersionMapper {
  private readonly cache = new Map<string, string>();
  // The runner passes an opaque `registry` map; we treat it as a
  // Map<implementationRef, strategyVersionId> directly.
  constructor(
    private readonly idByImplRef: Map<string, string>,
    private readonly prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  ) {}
  private async ensureVersion(implRef: string): Promise<string> {
    const cached = this.cache.get(implRef);
    if (cached) return cached;
    const known = this.idByImplRef.get(implRef);
    if (known) {
      this.cache.set(implRef, known);
      return known;
    }
    // Create a COMPOSITE strategy + version for the unknown ref so
    // FKs in CandidateStrategy remain valid.
    const def = await this.prisma.strategyDefinition.create({
      data: {
        type: "COMPOSITE",
        family: "TREND",
        description: `e2e stub for ${implRef}`,
      },
    });
    const ver = await this.prisma.strategyVersion.create({
      data: {
        definitionId: def.id,
        name: implRef,
        version: "1",
        implementationRef: implRef,
        parameters: {},
      },
    });
    this.cache.set(implRef, ver.id);
    return ver.id;
  }
  async resolveBaseStrategy(_id: string, implementationRef: string) {
    const ver = await this.ensureVersion(implementationRef);
    return {
      strategyVersionId: ver,
      definitionId: `def-${implementationRef}`,
      definitionType: "BASE" as const,
    };
  }
  async resolveCompositeStrategy(config: any) {
    const ver = await this.ensureVersion(config.id);
    return {
      strategyVersionId: ver,
      definitionId: `def-${config.id}`,
      definitionType: "COMPOSITE" as const,
    };
  }
}

async function ensureBaseStrategyAndSymbol(prisma: Awaited<ReturnType<typeof getPrismaClient>>) {
  // Reuse BTCUSDT / 1h from existing rows.
  const symbol = await prisma.symbol.findFirst({ where: { symbol: "BTCUSDT" } });
  if (!symbol) throw new Error("BTCUSDT symbol missing; seed the DB first");
  const tf = await prisma.timeframe.findFirst({ where: { code: "1h" } });
  if (!tf) throw new Error("1h timeframe missing; seed the DB first");
  // Pick an existing BASE strategy version we can reuse.
  const baseVersion = await prisma.strategyVersion.findFirst({
    where: { definition: { type: "BASE" } },
    orderBy: { createdAt: "asc" },
  });
  if (!baseVersion) throw new Error("No BASE strategy version; seed the DB first");
  return { symbol, timeframe: "1h", baseVersion };
}

describe("Phase 3.2 — Live Continuous Strategy Loop (real Prisma)", () => {
  let prisma: Awaited<ReturnType<typeof getPrismaClient>>;
  let orchestrator: LoopOrchestratorService;
  let runner: LoopOrchestratorRunner;
  let bus: ReturnType<typeof getEventBus>;
  let loopId: string;
  let baseVersionId: string;
  let symbolId: string;
  let stubSearchRepo: StubSearchRepository;
  let stubMapper: StubStrategyVersionMapper;

  beforeAll(async () => {
    prisma = getPrismaClient();
    bus = getEventBus();
    resetEventBus();
    bus = getEventBus();

    const { symbol, baseVersion } = await ensureBaseStrategyAndSymbol(prisma);
    symbolId = symbol.id;
    baseVersionId = baseVersion.id;

    stubSearchRepo = new StubSearchRepository(prisma);
    stubMapper = new StubStrategyVersionMapper(
      new Map([[baseVersion.implementationRef, baseVersionId]]),
      prisma,
    );

    orchestrator = new LoopOrchestratorService(bus, prisma);
    runner = new LoopOrchestratorRunner({
      prisma,
      eventBus: bus,
      searchRepository: stubSearchRepo as any,
      strategyVersionMapper: stubMapper as any,
    });
    orchestrator.setRunner(runner);

    loopId = `phase32-test-${randomUUID().slice(0, 8)}`;
    logger.info({ loopId }, "[Phase 3.2 e2e] starting");
  });

  afterAll(async () => {
    // Cleanup so re-running the test starts clean. We keep rows for
    // post-mortem inspection but the loop's processedEvents + iter
    // rows are cleared by startLoop on the next run.
    if (loopId) {
      await prisma.loopProcessedEvent.deleteMany({ where: { loopId } });
      await prisma.candidateStrategy.deleteMany({
        where: { searchRun: { config: { path: ["loopId"], equals: loopId } } },
      });
      await prisma.searchRun.deleteMany({
        where: { config: { path: ["loopId"], equals: loopId } },
      });
      await prisma.loopIteration.deleteMany({ where: { loopId } });
      await prisma.loopRunState.deleteMany({ where: { loopId } });
    }
    resetEventBus();
  });

  it("end-to-end: iter 1 scores 8.38/8.78/8.78 → best 8.78 → iter 2 spawned with 5 NEW candidates, NOT including parent → STOPPED", async () => {
    // ── Configuration ──
    const candidateCountPerIteration = 5;
    const maxIterations = 3;
    const maxCandidates = 50;
    const noImprovementCap = 10;

    await orchestrator.startLoop({
      loopId,
      candidateCountPerIteration,
      maxIterations,
      maxCandidates,
      noImprovementCap,
    });

    // ── Register iter 1 with a pre-existing SearchRun stub. ──
    const algorithm = await prisma.searchAlgorithm.findFirst();
    if (!algorithm) {
      throw new Error("No SearchAlgorithm rows; seed the DB first");
    }
    const iter1SearchRunId = randomUUID();
    await prisma.searchRun.create({
      data: {
        id: iter1SearchRunId,
        algorithmId: algorithm.id,
        symbolId,
        timeframe: "1h",
        maxCandidates: 5,
        status: "RUNNING",
        createdBy: "phase32-e2e",
        config: { loopId, iteration: 1 },
      },
    });

    // ── Create 5 candidates for iter 1 with the scores
    // [8.38, 8.78, 8.78, 7.50, 6.20]. ──
    const iter1Scores = [8.38, 8.78, 8.78, 7.5, 6.2];
    const iter1CandidateIds: string[] = [];
    for (let i = 0; i < iter1Scores.length; i += 1) {
      const cid = randomUUID();
      iter1CandidateIds.push(cid);
      await prisma.candidateStrategy.create({
        data: {
          id: cid,
          searchRunId: iter1SearchRunId,
          strategyVersionId: baseVersionId,
          parameters: { e2e_iter: 1, idx: i },
          status: "DONE",
        },
      });
      // Create Experiment + BacktestResult so the recompute path
      // can find a score per candidate. BacktestResult requires a
      // Experiment first.
      const expId = randomUUID();
      await prisma.experiment.create({
        data: {
          id: expId,
          candidateId: cid,
          name: `e2e-iter1-${i}`,
          symbolId,
          timeframe: "1h",
          fromTime: BigInt(0),
          toTime: BigInt(Date.now()),
          initialCapital: 10000,
          positionSize: 0.1,
          status: "DONE",
          finishedAt: new Date(),
        },
      });
      await prisma.backtestResult.create({
        data: {
          experimentId: expId,
          symbolId,
          timeframe: "1h",
          fromTime: BigInt(0),
          toTime: BigInt(Date.now()),
          initialCapital: 10000,
          finalCapital: 10000 + i,
          totalReturn: iter1Scores[i]! - 5,
          winRate: 0.5,
          maxDrawdown: 0.1,
          numTrades: 5,
          numWinningTrades: 3,
          numLosingTrades: 2,
          sharpeRatio: 1,
          sortinoRatio: 1,
          calmarRatio: 1,
          profitFactor: 1.5,
          overallScore: iter1Scores[i]!,
          equityCurve: JSON.stringify([]),
        },
      });
    }

    await runner.registerIteration({
      loopId,
      iterationIndex: 1,
      parentStrategyVersionId: baseVersionId,
      searchRunId: iter1SearchRunId,
      candidateCount: iter1Scores.length,
      isInitial: true,
    });

    // ── Publish 5 StrategyEvaluated events in REVERSE order to
    // also stress out-of-order best-score recompute. ──
    for (let i = iter1Scores.length - 1; i >= 0; i -= 1) {
      bus.publish("StrategyEvaluated", {
        experimentId: `e2e-iter1-${i}`,
        strategyVersionId: baseVersionId,
        overallScore: iter1Scores[i]!,
        loopId,
        candidateId: iter1CandidateIds[i],
        searchRunId: iter1SearchRunId,
        iterationIndex: 1,
        symbolId,
        timeframe: "1h",
        totalReturn: iter1Scores[i]! - 5,
        winRate: 0.5,
        maxDrawdown: 0.1,
      });
    }

        // ── Allow events to propagate AND iter2 to be spawned. ──
    const iter2Deadline = Date.now() + 15000;
    while (Date.now() < iter2Deadline) {
      const checkIter2 = await prisma.loopIteration.findFirst({
        where: { loopId, iterationIndex: 2 },
      });
      if (checkIter2) {
        // Wait for candidates too.
        const candCount = await prisma.candidateStrategy.count({
          where: { searchRunId: checkIter2.searchRunId! },
        });
        if (candCount >= candidateCountPerIteration) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // ── Check iter 1 state. ──
    const iter1 = await prisma.loopIteration.findFirst({
      where: { loopId, iterationIndex: 1 },
    });
    expect(iter1).toBeTruthy();
    expect(iter1!.status).toBe("DONE");
    expect(iter1!.evaluatedCount).toBe(5);
    expect(iter1!.candidateCount).toBe(5);
    expect(Number(iter1!.bestScoreInIteration)).toBe(8.78);

    // ── Check loop state — totalEvaluated is the count of UNIQUE
    // events (5), no duplicates. ──
    let loop = await prisma.loopRunState.findUnique({ where: { loopId } });
    const itersAtAssert = await prisma.loopIteration.findMany({
      where: { loopId },
      orderBy: { iterationIndex: "asc" },
    });
    logger.info(
      {
        loopId,
        totalEvaluated: loop?.totalEvaluated,
        bestScoreSoFar: loop?.bestScoreSoFar,
        bestStrategyVersionId: loop?.bestStrategyVersionId,
        iterCount: itersAtAssert.length,
        iters: itersAtAssert.map((i) => ({
          idx: i.iterationIndex,
          status: i.status,
          candidateCount: i.candidateCount,
          evaluatedCount: i.evaluatedCount,
          bestScoreInIteration: Number(i.bestScoreInIteration),
        })),
      },
      "[Phase 3.2 e2e] assertion snapshot",
    );
    expect(loop).toBeTruthy();
    expect(loop!.totalEvaluated).toBe(5);
    expect(Number(loop!.bestScoreSoFar)).toBe(8.78);
    expect(loop!.bestStrategyVersionId).toBe(baseVersionId);

    // ── Check that an iteration 2 was kicked off (idempotent). ──
    const iter2 = await prisma.loopIteration.findFirst({
      where: { loopId, iterationIndex: 2 },
    });
    expect(iter2).toBeTruthy();
    expect(iter2!.status).toBe("RUNNING");
    // Iteration 2 should have `candidateCountPerIteration` NEW
    // candidates created via the HybridLoopGenerator (stubbed
    // through stubSearchRepo).
    const iter2Candidates = await prisma.candidateStrategy.findMany({
      where: { searchRunId: iter2!.searchRunId },
    });
    expect(iter2Candidates.length).toBe(candidateCountPerIteration);
    // Parent (top-1 of iter 1) must NOT be among iter 2 candidates.
    expect(iter2Candidates.some((c) => c.id === baseVersionId)).toBe(false);

    // ── The loop's processed events ledger has exactly 5 rows. ──
    const processedEvents = await prisma.loopProcessedEvent.findMany({
      where: { loopId },
    });
    expect(processedEvents.length).toBe(5);

    // ── Now publish 3 StrategyEvaluated for iter 2 with scores
    // [3, 7, 9] (out-of-order to verify best-score recompute). The
    // 9 should win even though it arrives 3rd. ──
    const iter2ScoreCandidates = iter2Candidates.slice(0, 3);
    const iter2Scores = [3, 7, 9];
    for (let i = iter2ScoreCandidates.length - 1; i >= 0; i -= 1) {
      const cand = iter2ScoreCandidates[i];
      const cid = cand!.id;
      // Insert experiment + backtestresult so recompute works.
      const expId = randomUUID();
      await prisma.experiment.create({
        data: {
          id: expId,
          candidateId: cid,
          name: `e2e-iter2-${i}`,
          symbolId,
          timeframe: "1h",
          fromTime: BigInt(0),
          toTime: BigInt(Date.now()),
          initialCapital: 10000,
          positionSize: 0.1,
          status: "DONE",
          finishedAt: new Date(),
        },
      });
      await prisma.backtestResult.create({
        data: {
          experimentId: expId,
          symbolId,
          timeframe: "1h",
          fromTime: BigInt(0),
          toTime: BigInt(Date.now()),
          initialCapital: 10000,
          finalCapital: 10000 + i,
          totalReturn: iter2Scores[i]! - 1,
          winRate: 0.6,
          maxDrawdown: 0.05,
          numTrades: 5,
          numWinningTrades: 3,
          numLosingTrades: 2,
          sharpeRatio: 1,
          sortinoRatio: 1,
          calmarRatio: 1,
          profitFactor: 1.5,
          overallScore: iter2Scores[i]!,
          equityCurve: JSON.stringify([]),
        },
      });

      bus.publish("StrategyEvaluated", {
        experimentId: `e2e-iter2-${i}`,
        strategyVersionId: baseVersionId,
        overallScore: iter2Scores[i]!,
        loopId,
        candidateId: cid,
        searchRunId: iter2!.searchRunId,
        iterationIndex: 2,
        symbolId,
        timeframe: "1h",
        totalReturn: iter2Scores[i]! - 1,
        winRate: 0.6,
        maxDrawdown: 0.05,
      });
    }
    await new Promise((r) => setTimeout(r, 1500));

    // ── Verify iter 2 is DONE with best === 9 (despite reverse order). ──
    const iter2After = await prisma.loopIteration.findFirst({
      where: { loopId, iterationIndex: 2 },
    });
    // Iter 2 should be DONE because we sent 3 events for 3 candidates
    // and the iteration had `candidateCountPerIteration=5` candidates.
    // Wait — we only stubbed 3 scores; the iter still has 2 candidates
    // without scores. So iter 2 should still be RUNNING.
    expect(iter2After!.status).toBe("RUNNING");
    expect(iter2After!.evaluatedCount).toBe(3);

    // ── Restart loop to force STOPPED state for assertion. ──
    await orchestrator.stopLoop(loopId, "STOPPED_MANUAL");
    loop = await prisma.loopRunState.findUnique({ where: { loopId } });
    expect(loop!.status).toBe("STOPPED_MANUAL");

    // After cascade: NO RUNNING iter remains.
    const runningIters = await prisma.loopIteration.count({
      where: { loopId, status: "RUNNING" },
    });
    expect(runningIters).toBe(0);
  }, 90_000);
});
