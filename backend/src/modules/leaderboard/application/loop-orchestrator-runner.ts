/**
 * leaderboard · application · LoopOrchestratorRunner  (Phase 3.2)
 *
 * Reduced role: the runner ONLY creates new `LoopIteration` rows and
 * their `SearchRun`s. All counter / stop / best-score decisions live
 * in `LoopOrchestratorService`.
 *
 * The runner exposes three responsibilities to the orchestrator:
 *
 *   1. `registerIteration` — persist a new LoopIteration row with
 *      status=RUNNING and no-op if one already exists for the same
 *      `(loopId, iterationIndex)` tuple.
 *
 *   2. `maybeCompleteIteration` — check if the iteration's
 *      `evaluatedCount >= actualCandidateCount` and atomically
 *      transition it to DONE. This is invoked by the orchestrator
 *      after every `StrategyEvaluated` and is fully idempotent.
 *
 *   3. `runIteration` — generate the next iteration's candidates with
 *      HybridLoopGenerator and persist them. Re-uses the existing
 *      Search pipeline so no duplicate path is created.
 *
 * Idempotency:
 *
 *   - `registerIteration` uses `findFirst + insert; if exists → no-op`.
 *     If two callers race, only one row survives.
 *   - `maybeCompleteIteration` uses
 *     `updateMany({ where: { status: "RUNNING" } })` as the lock. The
 *     first call to CAS the iteration to DONE wins; subsequent calls
 *     see `count === 0` and return without side effects.
 *   - `runIteration` refuses to create a duplicate `SearchRun` /
 *     `LoopIteration` for the same `(loopId, iterationIndex)`.
 */
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { PrismaClient } from "@prisma/client";
import { getEventBus, type EventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";
import type { Logger } from "../../../shared/logger/logger";
import type { PrismaSearchRepository } from "../../search/application/PrismaSearchRepository";
import type { StrategyVersionMapper } from "../../search/application/StrategyVersionMapper";
import {
  HybridLoopGenerator,
  HYBRID_LOOP_GENERATOR_ID,
  type ParentStrategy,
  type EliteMate,
} from "../../search/generators/HybridLoopGenerator";
import { CombinationOperator } from "../../strategy/combination/CombinationConfig";
import type { CombinationConfig } from "../../strategy/combination/CombinationConfig";
import { getStrategyRegistry } from "../../strategy/domain/StrategyRegistry";

/* ─── Event payload mirrors LeaderboardService ────────────────────────── */

export interface NewTopStrategyFoundPayload {
  readonly strategyVersionId: string;
  readonly overallScore: number;
  readonly symbolId: string;
  readonly timeframe: string;
  readonly strategyType: "BASE" | "COMPOSITE";
  readonly evaluatedAt: string;
}

export interface SearchCompletedEvent {
  readonly searchRunId: string;
  readonly totalGenerated: number;
  readonly totalQueued: number;
  readonly totalRejected: number;
  readonly generationMs: number;
}

/* ─── LoopRuntimeState DTO returned to callers ───────────────────────── */

export interface LoopRuntimeState {
  readonly loopId: string;
  readonly status: string;
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly maxCandidates: number;
  readonly candidateCountPerIteration: number;
  readonly totalEvaluated: number;
  readonly noImprovementCount: number;
  readonly noImprovementCap: number;
  readonly bestScore: number;
  readonly bestStrategyVersionId: string | null;
  readonly bestStrategyName: string | null;
  readonly bestStrategyType: string | null;
  readonly bestStrategySymbolCode: string | null;
  readonly bestStrategyTimeframe: string | null;
  readonly bestTotalReturn: number | null;
  readonly bestWinRate: number | null;
  readonly bestMaxDrawdown: number | null;
  readonly stopReason: string | null;
  readonly lastIterationSearchRunId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly elapsedSeconds: number;
  readonly timeLimitSeconds: number;
  readonly currentIterationCandidateCount: number;
  readonly currentIterationEvaluatedCount: number;
}

export interface LoopOrchestratorRunnerDeps {
  readonly searchRepository: PrismaSearchRepository;
  readonly strategyVersionMapper: StrategyVersionMapper;
  readonly prisma?: PrismaClient;
  readonly eventBus?: EventBus;
  readonly logger?: Logger;
}

/* ─── Runner ─────────────────────────────────────────────────────────── */

export class LoopOrchestratorRunner {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly log: Logger;
  private readonly searchRepository: PrismaSearchRepository;
  private readonly mapper: StrategyVersionMapper;

  constructor(deps: LoopOrchestratorRunnerDeps) {
    this.prisma = deps.prisma ?? getPrismaClient();
    this.eventBus = deps.eventBus ?? getEventBus();
    this.log = deps.logger ?? logger;
    this.searchRepository = deps.searchRepository;
    this.mapper = deps.strategyVersionMapper;
  }

  /* ─── Subscription ─────────────────────────────────────────────────── */

  public startListening(): void {
    // `SearchCompleted` is now only used for LOG re-sync
    // (candidateCount) and as a safety net to call
    // `maybeCompleteIteration` if some external producer enqueued
    // the event. It is NOT a completion boundary — completion is
    // owned by the orchestrator.
    this.eventBus.subscribe<SearchCompletedEvent>(
      "SearchCompleted",
      (payload) => {
        void this.onSearchCompletedReconcile(payload);
      },
    );
    this.log.info(
      "LoopOrchestratorRunner subscribed to SearchCompleted (reconcile-only)",
    );
  }

  /* ─── SearchCompleted reconcile (NOT completion boundary) ─────────── */

  private async onSearchCompletedReconcile(
    payload: SearchCompletedEvent,
  ): Promise<void> {
    if (!payload?.searchRunId) return;
    const iteration = await this.prisma.loopIteration.findFirst({
      where: { searchRunId: payload.searchRunId },
    });
    if (!iteration) return;

    // Re-sync candidateCount from actual DB rows (defensive).
    const realCount = await this.prisma.candidateStrategy.count({
      where: { searchRunId: payload.searchRunId },
    });
    if (realCount > 0 && realCount !== iteration.candidateCount) {
      await this.prisma.loopIteration.update({
        where: { id: iteration.id },
        data: { candidateCount: realCount },
      });
    }
    this.log.info(
      {
        loopId: iteration.loopId,
        searchRunId: payload.searchRunId,
        iterationIndex: iteration.iterationIndex,
        candidateCount: realCount,
        queued: payload.totalQueued,
        evaluatedCount: iteration.evaluatedCount,
      },
      "[ContinuousLoop] SearchCompleted reconciled",
    );

    // Safety net — completion is driven by
    // `maybeCompleteIteration` from the orchestrator, but if for any
    // reason that hasn't fired yet, calling it here is idempotent.
    await this.maybeCompleteIteration(iteration.loopId, iteration.iterationIndex);
  }

  /* ─── Iteration registration (idempotent) ─────────────────────────── */

  /**
   * Idempotent: persists a LoopIteration row only if no row exists
   * for the same `(loopId, iterationIndex)`. Counts
   * `actualCandidateCount` from the actual DB rows (P0-A fix carried
   * over) and re-computes `evaluatedCount` from existing DONE
   * experiments for the candidates (P0-B race fix).
   */
  public async registerIteration(args: {
    loopId: string;
    iterationIndex: number;
    parentStrategyVersionId: string;
    searchRunId: string;
    candidateCount: number;
    isInitial?: boolean;
  }): Promise<void> {
    const {
      loopId,
      iterationIndex,
      parentStrategyVersionId,
      searchRunId,
      isInitial = false,
    } = args;

    const existing = await this.prisma.loopIteration.findFirst({
      where: { loopId, iterationIndex },
    });
    if (existing) {
      // Already persisted; no-op. Re-sync candidateCount defensively.
      const realCount = await this.prisma.candidateStrategy.count({
        where: { searchRunId },
      });
      if (realCount > 0 && realCount !== existing.candidateCount) {
        await this.prisma.loopIteration.update({
          where: { id: existing.id },
          data: { candidateCount: realCount },
        });
      }
      return;
    }

    const actualCount = await this.prisma.candidateStrategy.count({
      where: { searchRunId },
    });
    const candidateCount = actualCount > 0 ? actualCount : args.candidateCount;

    const candidateRows = await this.prisma.candidateStrategy.findMany({
      where: { searchRunId },
      select: { id: true },
    });
    const candidateIds = candidateRows.map((c) => c.id);
    let preEvaluatedCount = 0;
    if (candidateIds.length > 0) {
      const experiments = await this.prisma.experiment.findMany({
        where: {
          candidateId: { in: candidateIds },
          status: "DONE",
        },
        select: { id: true },
      });
      preEvaluatedCount = experiments.length;
    }

    await this.prisma.loopIteration.create({
      data: {
        loopId,
        iterationIndex,
        parentStrategyVersionId,
        searchRunId,
        candidateCount,
        evaluatedCount: preEvaluatedCount,
        status: "RUNNING",
        isInitial,
      },
    });

    // Initial-iteration bookkeeping: bump current iteration to 1.
    if (isInitial) {
      await this.prisma.loopRunState.update({
        where: { loopId },
        data: {
          currentIteration: 1,
          lastIterationSearchRunId: searchRunId,
          inFlightSearchRunId: searchRunId,
          bestScoreSoFar: 0,
          bestStrategyVersionId: null,
          bestStrategySymbolId: null,
          bestStrategyTimeframe: null,
          bestTotalReturn: null,
          bestWinRate: null,
          status: "RUNNING",
        },
      }).catch(() => undefined);
    }

    this.log.info(
      {
        loopId,
        iterationIndex,
        searchRunId,
        parentStrategyVersionId,
        candidateCount,
        preEvaluatedCount,
        isInitial,
      },
      "[ContinuousLoop] iteration registered",
    );

    // Safety net: if preEvaluatedCount === candidateCount at
    // registration time (initial SearchRun evaluated before
    // registration), trigger completion right now.
    if (preEvaluatedCount >= candidateCount && candidateCount > 0) {
      await this.maybeCompleteIteration(loopId, iterationIndex);
    }
  }

  /* ─── Iteration completion (idempotent) ─────────────────────────── */

  /**
   * Phase 3.2 — the iteration's transition to DONE is protected by a
   * CAS guard. Only the FIRST caller to CAS the iteration from
   * RUNNING to DONE wins; subsequent calls return `{completed:
   * false}` without side effects.
   *
   * Returns the iteration's top-1 candidate so the orchestrator
   * can use it as the parent for iteration N+1.
   *
   * Decision: `evaluatedCount >= actualCandidateCount`. The
   * per-iteration `evaluatedCount` is updated by the orchestrator
   * service on every unique evaluation. We additionally check the
   * authoritative candidate terminal state (CandidateStrategy.status
   * IN (DONE, FAILED, SKIPPED)) as a safety net.
   */
  public async maybeCompleteIteration(
    loopId: string,
    iterationIndex: number,
  ): Promise<{ completed: boolean; parentForNextIter: string | null }> {
    const iteration = await this.prisma.loopIteration.findFirst({
      where: { loopId, iterationIndex },
    });
    if (!iteration) return { completed: false, parentForNextIter: null };
    if (iteration.status !== "RUNNING") {
      // Already completed (DONE) or stopped. Return cached best so
      // the orchestrator's downstream decision still has data when
      // a duplicate event asks us to re-check completion.
      const cachedBest = iteration.bestStrategyVersionId;
      return {
        completed: false,
        parentForNextIter: cachedBest ?? iteration.parentStrategyVersionId,
      };
    }

    // Recompute authoritative evaluatedCount from CandidateStrategy
    // status. Service increments are still the primary path; this is
    // a safety net.
    let authoritativeEvaluatedCount = iteration.evaluatedCount;
    if (iteration.searchRunId) {
      const terminalCandidates = await this.prisma.candidateStrategy.count({
        where: {
          searchRunId: iteration.searchRunId,
          status: { in: ["DONE", "FAILED", "SKIPPED"] },
        },
      });
      authoritativeEvaluatedCount = Math.max(
        iteration.evaluatedCount,
        terminalCandidates,
      );
    }

    const actualCandidateCount = iteration.searchRunId
      ? await this.prisma.candidateStrategy.count({
          where: { searchRunId: iteration.searchRunId },
        })
      : iteration.candidateCount;

    if (
      iteration.searchRunId &&
      actualCandidateCount !== iteration.candidateCount
    ) {
      await this.prisma.loopIteration.update({
        where: { id: iteration.id },
        data: { candidateCount: actualCandidateCount },
      });
    }

    if (authoritativeEvaluatedCount < actualCandidateCount) {
      this.log.debug(
        {
          loopId,
          iterationIndex,
          evaluatedCount: authoritativeEvaluatedCount,
          candidateCount: actualCandidateCount,
        },
        "[ContinuousLoop] iteration progress (waiting)",
      );
      return { completed: false, parentForNextIter: null };
    }

    // ── CAS: try to flip RUNNING → DONE. ──────────────────────────
    const cas = await this.prisma.loopIteration.updateMany({
      where: { id: iteration.id, status: "RUNNING" },
      data: {
        status: "DONE",
        completedAt: new Date(),
        evaluatedCount: authoritativeEvaluatedCount,
      },
    });
    if (cas.count === 0) {
      // Race: another caller already completed this iter.
      return { completed: false, parentForNextIter: iteration.bestStrategyVersionId };
    }

    // ── Determine iteration best from authoritative rows. ────────
    const best = await this.determineIterationBest(
      iteration.searchRunId ?? "",
    );

    if (best) {
      await this.prisma.loopIteration.update({
        where: { id: iteration.id },
        data: {
          bestScoreInIteration: best.overallScore,
          bestStrategyVersionId: best.strategyVersionId,
        },
      });
    }

    this.log.info(
      {
        loopId,
        iterationIndex,
        candidateCount: actualCandidateCount,
        evaluatedCount: authoritativeEvaluatedCount,
        bestStrategyVersionId: best?.strategyVersionId ?? null,
        bestScore: best?.overallScore ?? null,
      },
      "[ContinuousLoop] iteration completed",
    );

    // Notify the orchestrator so it can start iteration N+1 (or
    // stop the loop). The orchestrator is the single owner of the
    // post-completion decision tree, but it can be in any process
    // so we communicate via the EventBus.
    this.eventBus.publish("LoopIterationCompleted", {
      loopId,
      iterationIndex,
      parentForNextIter:
        best?.strategyVersionId ?? iteration.parentStrategyVersionId,
    });

    return {
      completed: true,
      parentForNextIter:
        best?.strategyVersionId ?? iteration.parentStrategyVersionId,
    };
  }

  /* ─── Iteration creation (used by orchestrator) ───────────────────── */

  /**
   * Create the next iteration (HybridLoopGenerator) and persist a
   * new LoopIteration row. Idempotent for the same
   * `(loopId, iterationIndex)` — uses `registerIteration`'s existing
   * row check.
   */
  public async runIteration(
    loopId: string,
    nextIter: number,
    parentStrategyVersionId: string,
  ): Promise<string | null> {
    const loop = await this.prisma.loopRunState.findUnique({
      where: { loopId },
    });
    if (!loop) return null;
    if (loop.status !== "RUNNING") return null;

    // Idempotent skip — already registered for this iterationIndex?
    const prior = await this.prisma.loopIteration.findFirst({
      where: { loopId, iterationIndex: nextIter },
    });
    if (prior) {
      this.log.info(
        { loopId, iterationIndex: nextIter, searchRunId: prior.searchRunId },
        "[ContinuousLoop] iteration already exists; skipping runIteration",
      );
      return prior.searchRunId;
    }

    const candidateCount = loop.candidateCountPerIteration;
    const eligiblePoolSize = loop.elitePoolSize;

    const parent = await this.resolveParent(parentStrategyVersionId);
    if (!parent) {
      this.log.warn(
        { loopId, parentStrategyVersionId },
        "[ContinuousLoop] could not resolve parent",
      );
      return null;
    }

    const elites = await this.fetchElites(
      parentStrategyVersionId,
      eligiblePoolSize,
    );
    const eliteMate: EliteMate = elites.length > 0 ? elites[0]! : undefined;

    const seed = hashString(`${loopId}:${nextIter}`);
    const generatorConfig = {
      parent,
      candidateCount,
      mutationRatio: Number(loop.mutationRatio),
      crossoverRatio: Number(loop.crossoverRatio),
      explorationRatio: Number(loop.explorationRatio),
      weightPerturbationRatio: 0.1,
      ...(eliteMate ? { eliteMate } : {}),
      ...(elites.length > 0 ? { elitePool: elites } : {}),
      randomSeed: seed,
    };

    // Resolve symbol + timeframe for the next iteration.
    const lastIter = await this.prisma.loopIteration.findFirst({
      where: { loopId },
      orderBy: { iterationIndex: "desc" },
    });
    let symbolId: string | null = null;
    let timeframe: string | null = null;
    if (lastIter?.searchRunId) {
      const sr = await this.prisma.searchRun.findUnique({
        where: { id: lastIter.searchRunId },
        include: { symbol: true },
      });
      if (sr) {
        symbolId = sr.symbolId;
        timeframe = sr.timeframe;
      }
    }
    if (!symbolId) {
      // Fallback: BTCUSDT
      const sym = await this.prisma.symbol.findFirst({
        where: { symbol: "BTCUSDT" },
      });
      symbolId = sym?.id ?? null;
    }
    if (!timeframe) {
      timeframe = "1h";
    }
    if (!symbolId) {
      this.log.warn({ loopId, nextIter }, "[ContinuousLoop] cannot resolve symbolId");
      return null;
    }

    const persistedConfig: Record<string, unknown> = {
      generatorId: HYBRID_LOOP_GENERATOR_ID,
      loopId,
      iteration: nextIter,
      parentStrategyVersionId,
      generatorConfig,
    };

    this.log.info(
      {
        loopId,
        iteration: nextIter,
        parentStrategyVersionId,
        candidateCount,
        mutationRatio: Number(loop.mutationRatio),
        crossoverRatio: Number(loop.crossoverRatio),
        explorationRatio: Number(loop.explorationRatio),
      },
      "[ContinuousLoop] runIteration.start",
    );

    let searchRunId: string | null = null;
    try {
      const algorithmId = await this.ensureLoopAlgorithmId("loop_hybrid");
      const created = await this.searchRepository.createSearchRun({
        algorithmId,
        symbolId: await this.resolveSymbolId(symbolId),
        timeframe,
        maxCandidates: candidateCount,
        createdBy: "loop-orchestrator",
        config: persistedConfig,
      });
      searchRunId = created.id;
      await this.searchRepository.updateSearchRunStatus(
        searchRunId,
        "RUNNING",
        new Date(),
      );
      await this.prisma.loopRunState.update({
        where: { loopId },
        data: { inFlightSearchRunId: searchRunId },
      }).catch(() => undefined);

      await this.registerIteration({
        loopId,
        iterationIndex: nextIter,
        parentStrategyVersionId,
        searchRunId,
        candidateCount,
        isInitial: false,
      });

      const generator = new HybridLoopGenerator();
      generator.setRegistry(getStrategyRegistry());
      generator.applyConfig({
        parent,
        candidateCount,
        mutationRatio: Number(loop.mutationRatio),
        crossoverRatio: Number(loop.crossoverRatio),
        explorationRatio: Number(loop.explorationRatio),
        ...(eliteMate ? { eliteMate } : {}),
        ...(elites.length > 0 ? { elitePool: elites } : {}),
        weightPerturbationRatio: 0.1,
        randomSeed: seed,
      });

      const result = await generator.generate(
        async (candidate) => {
          const versionInfo =
            candidate.candidateType === "BASE"
              ? await this.mapper.resolveBaseStrategy(
                  candidate.strategyId,
                  candidate.strategyId,
                )
              : await this.mapper.resolveCompositeStrategy(
                  candidate.config,
                  candidate.config.name,
                );

          const candidateRecord = await this.searchRepository.createCandidate({
            searchRunId: searchRunId!,
            strategyVersionId: versionInfo.strategyVersionId,
            parameters:
              candidate.candidateType === "BASE"
                ? { ...candidate.parameters }
                : {
                    _candidateType: "COMPOSITE",
                    _config: {
                      id: candidate.config.id,
                      name: candidate.config.name,
                      operator: candidate.config.operator,
                      components: candidate.config.components.map((c) => ({
                        strategyId: c.strategyId,
                        weight: c.weight,
                        position: c.position,
                        ...(c.parameters !== undefined
                          ? { parameters: c.parameters }
                          : {}),
                      })),
                    },
                  },
          });
          this.eventBus.publish("StrategyGenerated", {
            searchRunId,
            candidateId: candidateRecord.id,
            candidateType: candidate.candidateType,
            strategyId:
              candidate.candidateType === "BASE"
                ? candidate.strategyId
                : candidate.config.id,
          });
          return true;
        },
        () => false,
        { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
      );

      await this.searchRepository.updateSearchRunStatus(
        searchRunId,
        "DONE",
        undefined,
        new Date(),
      );

      this.eventBus.publish("SearchCompleted", {
        searchRunId,
        totalGenerated: result.done ? result.result.totalGenerated : 0,
        totalQueued: result.done ? result.result.totalQueued : 0,
        totalRejected: result.done ? result.result.totalRejected : 0,
        generationMs: result.done ? result.result.generationMs : 0,
      });

      return searchRunId;
    } catch (err) {
      this.log.error(
        { err, loopId, iteration: nextIter },
        "[ContinuousLoop] runIteration failed",
      );
      if (searchRunId) {
        await this.searchRepository
          .updateSearchRunStatus(searchRunId, "FAILED", undefined, new Date())
          .catch(() => undefined);
        await this.prisma.loopRunState.update({
          where: { loopId },
          data: { inFlightSearchRunId: null },
        }).catch(() => undefined);
      }
      return null;
    }
  }

  /* ─── Iteration helpers ────────────────────────────────────────────── */

  private async determineIterationBest(
    searchRunId: string,
  ): Promise<{
    strategyVersionId: string;
    overallScore: number;
    totalReturn: number;
    winRate: number;
    maxDrawdown: number;
    symbolId: string;
    timeframe: string;
  } | null> {
    // Phase 3.2 fix: avoid Prisma's chained-relation join. Resolve
    // candidate IDs first, then query BacktestResult by candidateId,
    // then resolve strategyVersionId separately.
    const candidates = await this.prisma.candidateStrategy.findMany({
      where: { searchRunId },
      select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);
    if (candidateIds.length === 0) return null;

    const top = await this.prisma.backtestResult.findFirst({
      where: { experiment: { candidateId: { in: candidateIds } } },
      orderBy: [{ overallScore: "desc" }, { createdAt: "asc" }],
      include: {
        experiment: { select: { candidateId: true } },
      },
    });
    if (!top) return null;
    const candidateId = top.experiment?.candidateId;
    if (!candidateId) return null;
    const topCandidate = await this.prisma.candidateStrategy.findUnique({
      where: { id: candidateId },
      select: { strategyVersionId: true },
    });
    if (!topCandidate) return null;

    return {
      strategyVersionId: topCandidate.strategyVersionId,
      overallScore: Number(top.overallScore),
      totalReturn: Number(top.totalReturn),
      winRate: Number(top.winRate),
      maxDrawdown: Number(top.maxDrawdown),
      symbolId: top.symbolId,
      timeframe: top.timeframe,
    };
  }

  private async fetchElites(
    excludeStrategyVersionId: string,
    limit: number,
  ): Promise<ParentStrategy[]> {
    const rows = await this.prisma.leaderboardEntry.findMany({
      where: {
        strategyVersionId: { not: excludeStrategyVersionId },
      },
      orderBy: { overallScore: "desc" },
      take: Math.max(1, limit),
      include: { strategyVersion: { include: { definition: true } } },
    });
    const elites: ParentStrategy[] = [];
    for (const row of rows) {
      const version = row.strategyVersion;
      if (version.definition.type === "BASE") {
        elites.push({
          type: "BASE",
          strategyId: version.implementationRef,
          parameters: (version.parameters as Record<string, unknown>) ?? {},
        });
      } else {
        const components = await this.prisma.compositeComponent.findMany({
          where: { compositeVersionId: version.id },
          orderBy: { position: "asc" },
          include: { componentVersion: true },
        });
        if (components.length === 0) continue;
        const config: CombinationConfig = {
          id: version.implementationRef,
          name: version.name,
          operator: CombinationOperator.WEIGHTED,
          components: components.map((c) => ({
            strategyId: c.componentVersion.implementationRef,
            weight: Number(c.weight),
            position: c.position,
            ...(c.componentVersion.parameters &&
            Object.keys(c.componentVersion.parameters as object).length > 0
              ? { parameters: c.componentVersion.parameters as Record<string, unknown> }
              : {}),
          })),
        };
        elites.push({ type: "COMPOSITE", config });
      }
    }
    return elites;
  }

  private async resolveParent(
    strategyVersionId: string,
  ): Promise<ParentStrategy | null> {
    const version = await this.prisma.strategyVersion.findUnique({
      where: { id: strategyVersionId },
      include: { definition: true },
    });
    if (!version) return null;

    if (version.definition.type === "BASE") {
      const params = (version.parameters as Record<string, unknown>) ?? {};
      return {
        type: "BASE",
        strategyId: version.implementationRef,
        parameters: params,
      };
    }
    const components = await this.prisma.compositeComponent.findMany({
      where: { compositeVersionId: version.id },
      orderBy: { position: "asc" },
      include: {
        componentVersion: {
          select: { implementationRef: true, parameters: true },
        },
      },
    });
    if (components.length === 0) return null;
    const configComponents = components.map((c) => ({
      strategyId: c.componentVersion.implementationRef,
      weight: Number(c.weight),
      position: c.position,
      ...(c.componentVersion.parameters &&
      Object.keys(c.componentVersion.parameters as object).length > 0
        ? { parameters: c.componentVersion.parameters as Record<string, unknown> }
        : {}),
    }));
    const config: CombinationConfig = {
      id: version.implementationRef,
      name: version.name,
      components: configComponents,
      operator: CombinationOperator.WEIGHTED,
    };
    return { type: "COMPOSITE", config };
  }

  private async ensureLoopAlgorithmId(code: string): Promise<string> {
    const existing = await this.prisma.searchAlgorithm.findFirst({
      where: { code },
    });
    if (existing) return existing.id;
    const created = await this.prisma.searchAlgorithm.create({
      data: {
        code,
        name: "Loop Hybrid (Continuous Strategy Loop)",
        implementationRef: "search.generator.loop_hybrid",
      },
    });
    return created.id;
  }

  private async resolveSymbolId(symbolOrId: string): Promise<string> {
    const byId = await this.prisma.symbol.findUnique({
      where: { id: symbolOrId },
    });
    if (byId) return byId.id;
    const byCode = await this.prisma.symbol.findUnique({
      where: { symbol: symbolOrId },
    });
    if (!byCode) {
      throw new Error(`LoopOrchestratorRunner: unknown symbol "${symbolOrId}"`);
    }
    return byCode.id;
  }

  /* ─── Runtime state ───────────────────────────────────────────────── */

  public async getRuntimeState(loopId: string): Promise<LoopRuntimeState | null> {
    const row = await this.prisma.loopRunState.findUnique({ where: { loopId } });
    if (!row) return null;

    let bestStrategyName: string | null = null;
    let bestStrategyType: string | null = null;
    let bestStrategySymbolCode: string | null = null;
    let bestMaxDrawdown: number | null = null;
    if (row.bestStrategyVersionId) {
      const ver = await this.prisma.strategyVersion.findUnique({
        where: { id: row.bestStrategyVersionId },
        include: { definition: true },
      });
      bestStrategyName = ver?.name ?? null;
      bestStrategyType = ver?.definition.type ?? null;
    }
    if (row.bestStrategySymbolId) {
      const sym = await this.prisma.symbol.findUnique({
        where: { id: row.bestStrategySymbolId },
      });
      bestStrategySymbolCode = sym?.symbol ?? null;
    }
    if (row.bestStrategyVersionId && row.bestStrategySymbolId && row.bestStrategyTimeframe) {
      // Phase 3.2 fix: avoid chained relation. Find candidate first.
      const cand = await this.prisma.candidateStrategy.findFirst({
        where: { strategyVersionId: row.bestStrategyVersionId },
        select: { id: true },
      });
      const br = cand
        ? await this.prisma.backtestResult.findFirst({
            where: {
              experiment: { candidateId: cand.id },
              symbolId: row.bestStrategySymbolId,
              timeframe: row.bestStrategyTimeframe,
            },
            orderBy: { overallScore: "desc" },
          })
        : null;
      bestMaxDrawdown = br ? Number(br.maxDrawdown) : null;
    }

    let currentIterationCandidateCount = 0;
    let currentIterationEvaluatedCount = 0;
    const liveIter = await this.prisma.loopIteration.findFirst({
      where: { loopId, status: "RUNNING" },
      orderBy: { iterationIndex: "desc" },
    });
    if (liveIter) {
      currentIterationCandidateCount = liveIter.candidateCount;
      currentIterationEvaluatedCount = liveIter.evaluatedCount;
      if (liveIter.searchRunId) {
        const realCount = await this.prisma.candidateStrategy.count({
          where: { searchRunId: liveIter.searchRunId },
        });
        currentIterationCandidateCount = realCount;
      }
    } else {
      // Loop may be STOPPED with iter still showing candidate count.
      const lastIter = await this.prisma.loopIteration.findFirst({
        where: { loopId },
        orderBy: { iterationIndex: "desc" },
      });
      if (lastIter?.searchRunId) {
        const realCount = await this.prisma.candidateStrategy.count({
          where: { searchRunId: lastIter.searchRunId },
        });
        currentIterationCandidateCount = realCount;
        currentIterationEvaluatedCount = lastIter.evaluatedCount;
      }
    }

    return {
      loopId: row.loopId,
      status: row.status,
      currentIteration: row.currentIteration,
      maxIterations: row.maxIterations,
      maxCandidates: row.maxCandidates,
      candidateCountPerIteration: row.candidateCountPerIteration,
      totalEvaluated: row.totalEvaluated,
      noImprovementCount: row.noImprovementCount,
      noImprovementCap: row.noImprovementCap,
      bestScore: Number(row.bestScoreSoFar),
      bestStrategyVersionId: row.bestStrategyVersionId,
      bestStrategyName,
      bestStrategyType,
      bestStrategySymbolCode,
      bestStrategyTimeframe: row.bestStrategyTimeframe,
      bestTotalReturn: row.bestTotalReturn ? Number(row.bestTotalReturn) : null,
      bestWinRate: row.bestWinRate ? Number(row.bestWinRate) : null,
      bestMaxDrawdown,
      stopReason: row.stopReason,
      lastIterationSearchRunId: row.lastIterationSearchRunId,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      elapsedSeconds: Math.floor((Date.now() - row.startedAt.getTime()) / 1000),
      timeLimitSeconds: row.timeLimitSeconds,
      currentIterationCandidateCount,
      currentIterationEvaluatedCount,
    };
  }
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
