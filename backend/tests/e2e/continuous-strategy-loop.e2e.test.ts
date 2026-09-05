/**
 * End-to-end verification harness for the Continuous Strategy Loop.
 *
 * Phase 3.1: This harness has been SUPERSEDED by
 * `tests/leaderboard/loop-lifecycle-phase3.1.test.ts`, which exercises
 * the new lifecycle (P0-A/B/C + P1-A/B). The original harness here
 * encoded the Phase 2 model where `NewTopStrategyFound` triggered
 * iteration creation; that architecture was replaced in Phase 3.1 with
 * `StrategyEvaluated` → `maybeCompleteIteration`.
 *
 * The original assertions are kept as documentation only and the
 * test is skipped.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { getEventBus, resetEventBus } from "../../src/shared/event-bus/EventBus";
import {
  LoopOrchestratorRunner,
  type NewTopStrategyFoundPayload,
} from "../../src/modules/leaderboard/application/loop-orchestrator-runner";
import type { LoopOrchestratorRunnerDeps } from "../../src/modules/leaderboard/application/loop-orchestrator-runner";

const log = (msg: string) => console.log(`[E2E] ${msg}`);

interface FakeLoopService {
  startLoop(id: string): Promise<void>;
  recordEvaluation(payload: {
    strategyVersionId: string;
    overallScore: number;
  }): Promise<void>;
  getState(id: string): Promise<{ status: string; totalEvaluated: number } | null>;
}

function makeFakeLoopService(opts: {
  maxCandidates: number;
  noImprovementCap: number;
}): FakeLoopService {
  const state = new Map<string, { status: string; totalEvaluated: number; bestScore: number; noImprovement: number }>();
  const bus = getEventBus();

  return {
    async startLoop(id) {
      state.set(id, { status: "RUNNING", totalEvaluated: 0, bestScore: 0, noImprovement: 0 });
      log(`started id=${id}`);
    },
    async recordEvaluation(payload) {
      const s = state.get("main");
      if (!s || s.status !== "RUNNING") return;
      s.totalEvaluated += 1;
      if (payload.overallScore > s.bestScore) {
        s.bestScore = payload.overallScore;
        s.noImprovement = 0;
      } else {
        s.noImprovement += 1;
      }
      if (s.totalEvaluated >= opts.maxCandidates) {
        s.status = "STOPPED_MAX_CANDIDATES";
        log(`stopped reason=STOPPED_MAX_CANDIDATES totalEvaluated=${s.totalEvaluated}`);
      } else if (s.noImprovement >= opts.noImprovementCap) {
        s.status = "STOPPED_NO_IMPROVEMENT";
        log(`stopped reason=STOPPED_NO_IMPROVEMENT totalEvaluated=${s.totalEvaluated}`);
      }
    },
    async getState(id) {
      const s = state.get(id);
      if (!s) return null;
      return { status: s.status, totalEvaluated: s.totalEvaluated };
    },
  };
}

async function runE2E(): Promise<void> {
  resetEventBus();
  const bus = getEventBus();
  const loopService = makeFakeLoopService({ maxCandidates: 3, noImprovementCap: 2 });

  // ── Fake Prisma ────────────────────────────────────────────────────────
  const strategyVersions = new Map<string, { id: string; implementationRef: string; parameters: Record<string, unknown>; definitionType: "BASE" | "COMPOSITE"; name: string }>();
  const loops = new Map<string, { id: string; loopId: string; status: string; currentIteration: number; lastIterationSearchRunId: string | null; bestScoreSoFar: number; maxCandidates: number; timeLimitSeconds: number; noImprovementCap: number; totalEvaluated: number; noImprovementCount: number; startedAt: Date; updatedAt: Date }>();
  const iterations: Array<{ id: string; loopId: string; iterationIndex: number; parentStrategyVersionId: string; searchRunId: string | null; candidateCount: number; status: string; createdAt: Date }> = [];
  const processedEvents: Array<{ dedupeKey: string; strategyVersionId: string; overallScore: number; evaluatedAt: Date }> = [];
  const searchRuns: Array<{ id: string; config: Record<string, unknown>; status: string; algorithmId: string; symbolId: string; timeframe: string; maxCandidates: number }> = [];
  const candidates: Array<{ id: string; searchRunId: string; strategyVersionId: string; parameters: Record<string, unknown> }> = [];
  const compositeComponents: Array<{ compositeVersionId: string; componentVersionId: string; weight: number; position: number; componentVersion: { implementationRef: string; parameters: Record<string, unknown> } }> = [];
  const algorithms = [{ id: "alg-loop", code: "loop_mutation" }];
  const symbols = [{ id: "sym-btc", symbol: "BTCUSDT" }];

  let nextId = 1;
  const gid = (p: string) => `${p}-${nextId++}`;

  strategyVersions.set("ver-parent-base", {
    id: "ver-parent-base",
    implementationRef: "strategy.ma",
    parameters: { fastPeriod: 9, slowPeriod: 21 },
    definition: { type: "BASE" },
    name: "Moving Average",
  });

  const prisma: any = {
    loopProcessedEvent: {
      create: async ({ data }: any) => {
        if (processedEvents.find((e) => e.dedupeKey === data.dedupeKey)) {
          const err: any = new Error("unique");
          err.code = "P2002";
          throw err;
        }
        processedEvents.push(data);
        return { id: gid("pe") };
      },
    },
    loopRunState: {
      findMany: async ({ where }: any) =>
        [...loops.values()].filter((l) => !where?.status || l.status === where.status),
      findUnique: async ({ where }: any) => loops.get(where.loopId) ?? null,
      update: async ({ where, data }: any) => {
        const l = [...loops.values()].find((x) => x.id === where.id);
        if (!l) return null;
        Object.assign(l, data);
        return l;
      },
      upsert: async ({ where, update, create }: any) => {
        const existing = [...loops.values()].find((l) => l.loopId === where.loopId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = {
          id: gid("lr"),
          loopId: create.loopId,
          status: create.status ?? "RUNNING",
          currentIteration: create.currentIteration ?? 0,
          lastIterationSearchRunId: create.lastIterationSearchRunId ?? null,
          bestScoreSoFar: create.bestScoreSoFar ?? 0,
          maxCandidates: create.maxCandidates ?? 3,
          timeLimitSeconds: create.timeLimitSeconds ?? 300,
          noImprovementCap: create.noImprovementCap ?? 2,
          totalEvaluated: 0,
          noImprovementCount: 0,
          startedAt: create.startedAt ?? new Date(),
          updatedAt: new Date(),
        };
        loops.set(row.loopId, row);
        return row;
      },
    },
    loopIteration: {
      create: async ({ data }: any) => {
        const row = { id: gid("li"), createdAt: new Date(), ...data };
        iterations.push(row);
        return row;
      },
      findFirst: async ({ where, orderBy }: any) => {
        let xs = iterations.slice();
        if (where?.loopId) xs = xs.filter((x) => x.loopId === where.loopId);
        if (orderBy?.iterationIndex === "desc") xs.sort((a, b) => b.iterationIndex - a.iterationIndex);
        return xs[0] ?? null;
      },
    },
    strategyVersion: {
      findUnique: async ({ where }: any) => strategyVersions.get(where.id) ?? null,
    },
    compositeComponent: {
      findMany: async ({ where }: any) =>
        compositeComponents.filter((c) => c.compositeVersionId === where.compositeVersionId).sort((a, b) => a.position - b.position),
    },
    searchAlgorithm: {
      findFirst: async ({ where }: any) => algorithms.find((a) => a.code === where.code) ?? null,
      create: async ({ data }: any) => {
        const row = { id: gid("alg"), code: data.code };
        algorithms.push(row);
        return row;
      },
    },
    symbol: {
      findUnique: async ({ where }: any) => {
        if (where.id) return symbols.find((s) => s.id === where.id) ?? null;
        if (where.symbol) return symbols.find((s) => s.symbol === where.symbol) ?? null;
        return null;
      },
    },
    searchRun: {
      create: async ({ data }: any) => {
        const row = {
          id: gid("run"),
          config: data.config ?? {},
          status: "PENDING",
          algorithmId: data.algorithmId,
          symbolId: data.symbolId,
          timeframe: data.timeframe,
          maxCandidates: data.maxCandidates,
        };
        searchRuns.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = searchRuns.find((r) => r.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
    },
    candidateStrategy: {
      create: async ({ data }: any) => {
        const row = {
          id: gid("cand"),
          searchRunId: data.searchRunId,
          strategyVersionId: data.strategyVersionId,
          parameters: data.parameters,
        };
        candidates.push(row);
        return row;
      },
    },
  };

  const searchRepository: any = {
    createSearchRun: async (input: any) => {
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
    updateSearchRunStatus: async (id: string, status: string) => {
      await prisma.searchRun.update({ where: { id }, data: { status } });
    },
    createCandidate: async (input: any) => {
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
    getAlgorithmSummary: async () => ({ id: "alg-loop", code: "loop_mutation", name: "Loop" }),
    getSymbolSummary: async () => ({ id: "sym-btc", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }),
  };

  const strategyVersionMapper: any = {
    resolveBaseStrategy: async (id: string) => ({
      strategyVersionId: `ver-${id}`,
      definitionId: `def-${id}`,
      definitionType: "BASE" as const,
    }),
    resolveCompositeStrategy: async (cfg: any) => ({
      strategyVersionId: `ver-${cfg.id}`,
      definitionId: `def-${cfg.id}`,
      definitionType: "COMPOSITE" as const,
    }),
  };

  const runner = new LoopOrchestratorRunner({
    prisma,
    eventBus: bus,
    searchRepository,
    strategyVersionMapper,
    candidateCount: 3,
  } satisfies LoopOrchestratorRunnerDeps);
  runner.startListening();

  // ── Wire the loop service into Prisma loop_run_state ────────────────
  await loopService.startLoop("main");
  // Initial state in fake Prisma.
  loops.set("main", {
    id: gid("lr"),
    loopId: "main",
    status: "RUNNING",
    currentIteration: 0,
    lastIterationSearchRunId: null,
    bestScoreSoFar: 0,
    maxCandidates: 3,
    timeLimitSeconds: 300,
    noImprovementCap: 2,
    totalEvaluated: 0,
    noImprovementCount: 0,
    startedAt: new Date(),
    updatedAt: new Date(),
  });

  // Listen to NewTopStrategyFound to log when the runner picks it up.
  let newTopCount = 0;
  bus.subscribe<NewTopStrategyFoundPayload>("NewTopStrategyFound", () => {
    newTopCount += 1;
  });
  const candidatesPerIteration: number[] = [];
  bus.subscribe("StrategyGenerated", () => {
    /* swallow */
  });

  for (let i = 0; i < 3; i += 1) {
    const iterationStartRuns = searchRuns.length;
    const iterationStartCands = candidates.length;
    log(`iteration=${i + 1}`);
    const payload: NewTopStrategyFoundPayload = {
      strategyVersionId: "ver-parent-base",
      overallScore: 50 + i * 5,
      symbolId: "sym-btc",
      timeframe: "1h",
      strategyType: "BASE",
      evaluatedAt: new Date(Date.now() + i * 1000).toISOString(),
    };
    log(`publishing NewTopStrategyFound score=${payload.overallScore} evaluatedAt=${payload.evaluatedAt}`);
    // Phase 3.1: the runner's iteration lifecycle is now driven by
    // `evaluatedCount >= candidateCount` (called from the
    // orchestrator's `handleStrategyEvaluatedForLoop`). In this
    // harness we emulate the orchestrator by manually invoking
    // `maybeCompleteIteration` after each event so the loop
    // progresses the same way it does in production.
    await runner.maybeCompleteIteration("main", i + 1);
    await new Promise((r) => setTimeout(r, 20));
    const newRuns = searchRuns.slice(iterationStartRuns);
    const newRunIds = new Set(newRuns.map((r) => r.id));
    const newCands = candidates.slice(iterationStartCands).filter((c) => newRunIds.has(c.searchRunId));
    candidatesPerIteration.push(newCands.length);
    log(`candidates emitted=${newCands.length} searchRuns=${newRuns.length}`);
    for (const c of newCands) {
      log(`candidate strategyVersionId=${c.strategyVersionId} parameters=${JSON.stringify(c.parameters).slice(0, 60)}…`);
    }

    // Update fake loop service + bump iteration.
    await loopService.recordEvaluation({
      strategyVersionId: `ver-${i + 1}`,
      overallScore: 0.6 + i * 0.05,
    });
    // Mirror the totals into the fake Prisma loop state.
    const st = loops.get("main")!;
    st.bestScoreSoFar = 50 + i * 5;
    st.currentIteration = i + 1;

    const state = await loopService.getState("main");
    if (state?.status !== "RUNNING") {
      log(`stopped reason=${state?.status} after iteration=${i + 1}`);
      break;
    }
  }

  const finalState = await loopService.getState("main");

  // ── Assertions ────────────────────────────────────────────────────────
  log("--- assertions ---");
  assert.equal(searchRuns.length, 3, "expected 3 SearchRuns");
  assert.equal(candidates.length, 9, "expected 9 candidates (3 per iteration × 3 iterations)");
  assert.deepEqual(
    candidatesPerIteration,
    [3, 3, 3],
    "each iteration must emit exactly 3 candidates",
  );
  // Each iteration's SearchRun records the parent in its config.
  for (const run of searchRuns) {
    assert.equal(run.config["parentStrategyVersionId"], "ver-parent-base");
    assert.equal(run.config["loopId"], "main");
    assert.equal(run.config["generatorId"], "loop_mutation");
  }
  // Loop Iteration rows persisted.
  assert.equal(iterations.length, 3);
  // ProcessedEvent dedupe rows recorded.
  assert.equal(processedEvents.length, 3);
  // Loop is still RUNNING after 3 iterations (no stop condition hit because
  // maxCandidates is a per-loop total, not per iteration, and we ran 3 iters
  // producing 9 candidates — wait, our fake records totalEvaluated = i+1
  // which is just 3, so MAX_CANDIDATES=3 will trigger).
  assert.ok(finalState);
  assert.equal(finalState.status, "STOPPED_MAX_CANDIDATES");

  log("ALL ASSERTIONS PASSED ✅");
}

describe("Continuous Strategy Loop — end-to-end harness (Phase 2 — superseded)", () => {
  it.skip(
    "closes the feedback loop: NewTopStrategyFound → LoopMutationGenerator → new candidates",
    async () => {
      await runE2E();
    },
  );
});
