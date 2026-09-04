/**
 * leaderboard · application · LoopOrchestratorRunner
 *
 * Drives the Continuous Strategy Loop iteration lifecycle.
 *
 * Lifecycle (Phase 3):
 *
 *   Iteration #N SearchRun completes (SearchCompleted)
 *       │
 *       │  1. determine the iteration's best candidate (from
 *       │     `LoopIteration.bestScoreInIteration` + BacktestResult)
 *       │  2. update `LoopRunState.bestScoreSoFar`,
 *       │     `bestStrategyVersionId`, totals
 *       │  3. check iteration-level no-improvement counter
 *       │  4. if `currentIteration >= maxIterations` → STOPPED_MAX_ITERATIONS
 *       │  5. else: build HybridLoopConfig, create SearchRun #N+1 with
 *       │     `algorithm = "loop_hybrid"`, generate candidates, persist
 *       │     `LoopIteration #N+1`
 *
 * Invariants:
 *
 *   - `currentIteration` is bumped EXACTLY ONCE per SearchRun that the
 *     runner created. We persist `LoopIteration` rows eagerly inside
 *     `runIteration()` so a backend crash mid-iteration still leaves an
 *     audit trail.
 *   - The parent is NOT re-evaluated. It is used as the SEED only.
 *   - One in-flight SearchRun at a time per loop
 *     (`in_flight_search_run_id`). While set, the runner ignores
 *     additional `NewTopStrategyFound` events for the same loop.
 *
 * Initial iteration (Phase 3):
 *
 *   When `Combination.handleSubmit()` calls `startLoop()` it has
 *   ALREADY created the initial SearchRun. The runner accepts an
 *   `initialSearchRunId` and registers it as Iteration #1 WITHOUT
 *   creating a new SearchRun. This preserves the requirement that
 *   "Run Combination → Initial Full Search → Iteration #1".
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
  readonly evaluatedAt: string; // ISO timestamp
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
  /** Counters for the in-flight iteration (if any). */
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

  /** Map<loopId, next iteration index>. Persisted to DB on every increment. */
  private readonly iterationCounter = new Map<string, number>();
  /** Map<loopId, candidateCountPerIteration> from last start. */
  private readonly candidateCountCache = new Map<string, number>();

  constructor(deps: LoopOrchestratorRunnerDeps) {
    this.prisma = deps.prisma ?? getPrismaClient();
    this.eventBus = deps.eventBus ?? getEventBus();
    this.log = deps.logger ?? logger;
    this.searchRepository = deps.searchRepository;
    this.mapper = deps.strategyVersionMapper;
  }

  /* ─── Subscription ─────────────────────────────────────────────────── */

  public startListening(): void {
    this.eventBus.subscribe<SearchCompletedEvent>(
      "SearchCompleted",
      (payload) => {
        void this.handleSearchCompleted(payload);
      },
    );
    this.log.info("LoopOrchestratorRunner subscribed to SearchCompleted");
  }

  /* ─── Initial iteration registration ───────────────────────────────── */

  /**
   * Register an EXISTING SearchRun as the initial iteration of the
   * loop. Called by `Combination.handleSubmit()` AFTER `startSearch()`
   * has created the SearchRun.
   *
   * Persists `LoopIteration #1` immediately so the UI's "Iteration:
   * 1 / N" counter is correct from the start.
   */
  public async registerInitialSearchRun(args: {
    loopId: string;
    searchRunId: string;
    parentStrategyVersionId: string;
    candidateCount: number;
  }): Promise<void> {
    const { loopId, searchRunId, parentStrategyVersionId, candidateCount } = args;
    await this.upsertIteration({
      loopId,
      iterationIndex: 1,
      parentStrategyVersionId,
      searchRunId,
      candidateCount,
      status: "RUNNING",
      isInitial: true,
    });
    await this.prisma.loopRunState.update({
      where: { loopId },
      data: {
        currentIteration: 1,
        lastIterationSearchRunId: searchRunId,
        inFlightSearchRunId: searchRunId,
        initialParentStrategyVersionId: parentStrategyVersionId,
        bestScoreSoFar: 0,
        bestStrategyVersionId: null,
        bestStrategySymbolId: null,
        bestStrategyTimeframe: null,
        bestTotalReturn: null,
        bestWinRate: null,
        status: "RUNNING",
      },
    }).catch(() => undefined);
    this.iterationCounter.set(loopId, 1);
    this.candidateCountCache.set(loopId, candidateCount);
  }

  /* ─── SearchRun completion boundary ─────────────────────────────────── */

  private async handleSearchCompleted(payload: SearchCompletedEvent): Promise<void> {
    if (!payload?.searchRunId) return;
    const iteration = await this.prisma.loopIteration.findFirst({
      where: { searchRunId: payload.searchRunId },
    });
    if (!iteration) return; // Not a loop-owned SearchRun.

    const loopId = iteration.loopId;
    const loop = await this.prisma.loopRunState.findUnique({ where: { loopId } });
    if (!loop || loop.status !== "RUNNING") return;

    // Idempotency — if the SearchRun is not the in-flight one, ignore.
    if (loop.inFlightSearchRunId !== payload.searchRunId) {
      this.log.debug(
        { loopId, searchRunId: payload.searchRunId, inFlight: loop.inFlightSearchRunId },
        "LoopOrchestratorRunner: ignoring SearchCompleted for non-in-flight SearchRun",
      );
      return;
    }

    // ── 1. Determine best candidate from this iteration ─────────────────
    const best = await this.determineIterationBest(payload.searchRunId);

    // ── 2. For an initial iteration, resolve the parent AFTER evaluation ─
    // The initial iteration was registered BEFORE evaluation. We only know
    // which StrategyVersion to use as parent AFTER the best candidate is
    // known. If this is the initial iteration and we have a best
    // candidate, update the parent.
    let parentForNextIter = iteration.parentStrategyVersionId;
    if (iteration.isInitial && best) {
      await this.prisma.loopIteration.update({
        where: { id: iteration.id },
        data: { parentStrategyVersionId: best.strategyVersionId },
      });
      parentForNextIter = best.strategyVersionId;
    }

    // ── 3. Mark iteration done + store best ─────────────────────────────
    await this.prisma.loopIteration.update({
      where: { id: iteration.id },
      data: {
        status: "DONE",
        completedAt: new Date(),
        ...(best
          ? {
              bestScoreInIteration: best.overallScore,
              bestStrategyVersionId: best.strategyVersionId,
            }
          : {}),
      },
    });

    // ── 3. Update LoopRunState best fields (loop-local, NOT global) ─────
    const previousBest = Number(loop.bestScoreSoFar);
    const newBest = best?.overallScore ?? previousBest;
    const loopBestImproved = newBest > previousBest && newBest > 0;

    const newNoImpCount = loopBestImproved ? 0 : loop.noImprovementCount + 1;

    const baseData: Record<string, unknown> = {
      bestScoreSoFar: newBest,
      noImprovementCount: newNoImpCount,
      inFlightSearchRunId: null,
      lastIterationSearchRunId: iteration.searchRunId,
    };
    if (best && loopBestImproved) {
      baseData.bestStrategyVersionId = best.strategyVersionId;
      baseData.bestStrategySymbolId = best.symbolId;
      baseData.bestStrategyTimeframe = best.timeframe;
      baseData.bestTotalReturn = best.totalReturn;
      baseData.bestWinRate = best.winRate;
    }

    // ── 4. Check stop conditions BEFORE creating next iteration ─────────
    const nextIterationIndex = (this.iterationCounter.get(loopId) ?? iteration.iterationIndex) + 1;
    let stopReason: string | null = null;
    if (loop.totalEvaluated >= loop.maxCandidates) {
      stopReason = "STOPPED_MAX_CANDIDATES";
    } else if ((Date.now() - loop.startedAt.getTime()) / 1000 >= loop.timeLimitSeconds) {
      stopReason = "STOPPED_TIMEOUT";
    } else if (newNoImpCount >= loop.noImprovementCap) {
      stopReason = "STOPPED_NO_IMPROVEMENT";
    } else if (nextIterationIndex > loop.maxIterations) {
      stopReason = "STOPPED_MAX_ITERATIONS";
    }

    if (stopReason) {
      await this.prisma.loopRunState.update({
        where: { id: loop.id },
        data: {
          ...baseData,
          status: stopReason,
          stopReason,
        },
      });
      this.eventBus.publish("LoopStatusChanged", { loopId, status: stopReason });
      this.log.info({ loopId, stopReason, iteration: iteration.iterationIndex }, "Loop stopped");
      return;
    }

    // ── 5. Schedule next iteration ─────────────────────────────────────
    await this.prisma.loopRunState.update({
      where: { id: loop.id },
      data: {
        ...baseData,
        currentIteration: nextIterationIndex,
      },
    });
    this.iterationCounter.set(loopId, nextIterationIndex);

    const parentVersion = best?.strategyVersionId ?? parentForNextIter;
    try {
      await this.runIteration(loopId, nextIterationIndex, parentVersion, {
        symbolId: best?.symbolId ?? null,
        timeframe: best?.timeframe ?? null,
      });
    } catch (err) {
      this.log.error({ err, loopId, nextIterationIndex }, "Failed to start next iteration");
    }
  }

  /* ─── Iteration creation ───────────────────────────────────────────── */

  /**
   * Create a NEW SearchRun with the HybridLoopGenerator and persist a
   * LoopIteration row. Called when the previous iteration completes.
   *
   * The candidate count and ratios are read from `LoopRunState`.
   */
  public async runIteration(
    loopId: string,
    nextIter: number,
    parentStrategyVersionId: string,
    context: { symbolId: string | null; timeframe: string | null },
  ): Promise<string | null> {
    const loop = await this.prisma.loopRunState.findUnique({ where: { loopId } });
    if (!loop) return null;

    const candidateCount = loop.candidateCountPerIteration;
    const eligiblePoolSize = loop.elitePoolSize;

    const parent = await this.resolveParent(parentStrategyVersionId);
    if (!parent) {
      this.log.warn(
        { loopId, parentStrategyVersionId },
        "LoopOrchestratorRunner: could not resolve parent",
      );
      return null;
    }

    // Pull an elite mate from the leaderboard (excluding the parent)
    // for crossover + exploration seeding.
    const elites = await this.fetchElites(parentStrategyVersionId, eligiblePoolSize);
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

    // Resolve symbol/timeframe from context, last iteration's SearchRun, or
    // fallback to "BTCUSDT / 1h".
    const lastIter = await this.prisma.loopIteration.findFirst({
      where: { loopId },
      orderBy: { iterationIndex: "desc" },
    });

    const symbolId = context.symbolId ?? lastIter?.searchRunId
      ? (await this.resolveSymbolFromSearchRun(lastIter!.searchRunId!)).id
      : null;
    const timeframe =
      context.timeframe ??
      (lastIter?.searchRunId
        ? await this.resolveTimeframeFromSearchRun(lastIter!.searchRunId)
        : null) ??
      "1h";

    if (!symbolId) {
      this.log.warn({ loopId, nextIter }, "LoopOrchestratorRunner: cannot resolve symbolId for next iteration");
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
      "LoopOrchestratorRunner.runIteration.start",
    );

    let searchRunId: string | null = null;
    try {
      const created = await this.searchRepository.createSearchRun({
        algorithmId: await this.ensureLoopAlgorithmId("loop_hybrid"),
        symbolId: await this.resolveSymbolId(symbolId),
        timeframe,
        maxCandidates: candidateCount,
        createdBy: "loop-orchestrator",
        config: persistedConfig,
      });
      searchRunId = created.id;

      await this.searchRepository.updateSearchRunStatus(searchRunId, "RUNNING", new Date());
      await this.prisma.loopRunState.update({
        where: { loopId },
        data: { inFlightSearchRunId: searchRunId },
      }).catch(() => undefined);

      await this.upsertIteration({
        loopId,
        iterationIndex: nextIter,
        parentStrategyVersionId,
        searchRunId,
        candidateCount,
        status: "RUNNING",
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

          await this.searchRepository.createCandidate({
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
                        ...(c.parameters !== undefined ? { parameters: c.parameters } : {}),
                      })),
                    },
                  },
          });
          this.eventBus.publish("StrategyGenerated", {
            searchRunId: searchRunId,
            candidateId: searchRunId,
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

      // The generator runs synchronously and finishes producing all
      // candidate rows in-memory before we mark DONE. The actual
      // evaluation (Backtest/Evaluation/Leaderboard) happens
      // asynchronously via the existing pipeline and triggers
      // `SearchCompleted` once each candidate is processed. We mark
      // SearchRun as DONE only after candidates are queued so
      // downstream observers don't see a half-built run.
      const finalStatus = "DONE";
      await this.searchRepository.updateSearchRunStatus(
        searchRunId,
        finalStatus,
        undefined,
        new Date(),
      );

      // Publish SearchCompleted so this runner can handle the next iteration
      // via handleSearchCompleted(). This fires after the synchronous
      // candidate-generation phase, which is the correct boundary: all
      // candidates have been queued, the search-space exploration is complete.
      this.eventBus.publish("SearchCompleted", {
        searchRunId,
        totalGenerated: result.done ? result.result.totalGenerated : 0,
        totalQueued: result.done ? result.result.totalQueued : 0,
        totalRejected: result.done ? result.result.totalRejected : 0,
        generationMs: result.done ? result.result.generationMs : 0,
      });

      return searchRunId;
    } catch (err) {
      this.log.error({ err, loopId, iteration: nextIter }, "runIteration failed");
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

  private async upsertIteration(args: {
    loopId: string;
    iterationIndex: number;
    parentStrategyVersionId: string;
    searchRunId: string | null;
    candidateCount: number;
    status: string;
    isInitial?: boolean;
  }): Promise<void> {
    const existing = await this.prisma.loopIteration.findFirst({
      where: {
        loopId: args.loopId,
        iterationIndex: args.iterationIndex,
      },
    });
    if (existing) {
      await this.prisma.loopIteration.update({
        where: { id: existing.id },
        data: {
          searchRunId: args.searchRunId ?? existing.searchRunId,
          candidateCount: args.candidateCount,
          status: args.status,
          parentStrategyVersionId: args.parentStrategyVersionId,
          ...(args.isInitial !== undefined ? { isInitial: args.isInitial } : {}),
        },
      });
      return;
    }
    await this.prisma.loopIteration.create({
      data: {
        loopId: args.loopId,
        iterationIndex: args.iterationIndex,
        parentStrategyVersionId: args.parentStrategyVersionId,
        searchRunId: args.searchRunId,
        candidateCount: args.candidateCount,
        status: args.status,
        isInitial: args.isInitial ?? false,
      },
    });
  }

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
    const candidates = await this.prisma.candidateStrategy.findMany({
      where: { searchRunId },
      select: { id: true },
    });
    if (candidates.length === 0) return null;

    const results = await this.prisma.backtestResult.findMany({
      where: { experiment: { candidateId: { in: candidates.map((c) => c.id) } } },
      orderBy: { overallScore: "desc" },
      include: { experiment: { include: { candidate: true } } },
    });
    if (results.length === 0) return null;

    const top = results[0]!;
    return {
      strategyVersionId: top.experiment.candidate.strategyVersionId,
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
    const byId = await this.prisma.symbol.findUnique({ where: { id: symbolOrId } });
    if (byId) return byId.id;
    const byCode = await this.prisma.symbol.findUnique({
      where: { symbol: symbolOrId },
    });
    if (!byCode) {
      throw new Error(`LoopOrchestratorRunner: unknown symbol "${symbolOrId}"`);
    }
    return byCode.id;
  }

  private async resolveSymbolFromSearchRun(searchRunId: string) {
    const sr = await this.prisma.searchRun.findUnique({
      where: { id: searchRunId },
      include: { symbol: true },
    });
    if (!sr) throw new Error(`SearchRun ${searchRunId} not found`);
    return sr.symbol;
  }

  private async resolveTimeframeFromSearchRun(searchRunId: string): Promise<string | null> {
    const sr = await this.prisma.searchRun.findUnique({
      where: { id: searchRunId },
    });
    return sr?.timeframe ?? null;
  }

  /* ─── Runtime state ───────────────────────────────────────────────── */

  /**
   * Compute the loop runtime state. Loop-local best metrics only;
   * never read the global leaderboard Top-1.
   */
  public async getRuntimeState(loopId: string): Promise<LoopRuntimeState | null> {
    const row = await this.prisma.loopRunState.findUnique({ where: { loopId } });
    if (!row) return null;

    // Loop-local best strategy + metrics from LoopRunState.
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
      const br = await this.prisma.backtestResult.findFirst({
        where: {
          experiment: { candidate: { strategyVersionId: row.bestStrategyVersionId } },
          symbolId: row.bestStrategySymbolId,
          timeframe: row.bestStrategyTimeframe,
        },
        orderBy: { overallScore: "desc" },
      });
      bestMaxDrawdown = br ? Number(br.maxDrawdown) : null;
    }

    // Per-iteration live counters.
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
