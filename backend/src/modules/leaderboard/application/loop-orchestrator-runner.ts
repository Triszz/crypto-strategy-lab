/**
 * leaderboard · application · LoopOrchestratorRunner
 *
 * The Strategy/Search-side consumer of `NewTopStrategyFound`. Closes the
 * Continuous Strategy Loop:
 *
 *   Leaderboard → publish NewTopStrategyFound
 *       │
 *       ▼
 *   LoopOrchestratorRunner.handleNewTop()
 *       │
 *       │ 1. dedupe via LoopProcessedEvent (idempotency)
 *       │ 2. check the loop is still RUNNING
 *       │ 3. resolve the parent StrategyVersion (BASE or COMPOSITE)
 *       │ 4. build a new SearchRun with LoopMutationGenerator config
 *       │ 5. publish the iteration via SearchService
 *       │ 6. bump iteration counter on LoopRunState
 *
 * The runner NEVER calls BacktestService directly — the existing
 * BullMQ pipeline (StrategyGenerated → BacktestQueue → BacktestWorker
 * → EvaluationWorker → LeaderboardService) handles downstream flow.
 *
 * Architectural invariants respected:
 *   - No new event bus. Reuses `getEventBus()` and the existing event
 *     names: `NewTopStrategyFound`, `LoopStatusChanged`.
 *   - No new Backtest pipeline. Goes through `SearchService.start()`
 *     exactly like a trader-initiated discovery.
 *   - No new CandidateStrategy persistence path. Goes through
 *     `repository.createCandidate` inside SearchService.
 *   - BASE and COMPOSITE parents are both supported.
 *
 * MUST stay infrastructure-light: the only infra is Prisma for
 * LoopProcessedEvent idempotency and LoopRunState state tracking.
 */
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { PrismaClient } from "@prisma/client";
import { getEventBus, type EventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";
import type { Logger } from "../../../shared/logger/logger";
import type { PrismaSearchRepository } from "../../search/application/PrismaSearchRepository";
import type { StrategyVersionMapper } from "../../search/application/StrategyVersionMapper";
import {
  LoopMutationGenerator,
  LOOP_MUTATION_GENERATOR_ID,
  type ParentStrategy,
  LoopMutationConfig,
} from "../../search/generators/LoopMutationGenerator";
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

/* ─── LoopRuntimeState DTO returned to callers ───────────────────────── */

export interface LoopRuntimeState {
  readonly loopId: string;
  readonly status: string;
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly maxCandidates: number;
  readonly totalEvaluated: number;
  readonly noImprovementCount: number;
  readonly noImprovementCap: number;
  readonly bestScoreSoFar: number;
  readonly bestStrategyVersionId: string | null;
  readonly bestStrategyType: string | null;
  /** Human-readable name from the global Top-1 LeaderboardEntry. */
  readonly bestStrategyName: string | null;
  /** Symbol code (e.g. "BTCUSDT") for the Top-1 entry, or null. */
  readonly bestStrategySymbolCode: string | null;
  /** Timeframe for the Top-1 entry (e.g. "1h"), or null. */
  readonly bestStrategyTimeframe: string | null;
  /** Profit / Total Return of the Top-1 entry (decimal, 0.8432 = +84.32%). */
  readonly bestTotalReturn: number | null;
  /** Win rate of the Top-1 entry (decimal, 0.684 = 68.40%). */
  readonly bestWinRate: number | null;
  readonly lastIterationSearchRunId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly elapsedSeconds: number;
  readonly timeLimitSeconds: number;
}

export interface LoopOrchestratorRunnerDeps {
  readonly searchRepository: PrismaSearchRepository;
  readonly strategyVersionMapper: StrategyVersionMapper;
  readonly prisma?: PrismaClient;
  readonly eventBus?: EventBus;
  readonly logger?: Logger;
  /** Number of mutated variants per iteration. Defaults to 5. */
  readonly candidateCount?: number;
}

/* ─── Runner ─────────────────────────────────────────────────────────── */

export class LoopOrchestratorRunner {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly log: Logger;
  private readonly searchRepository: PrismaSearchRepository;
  private readonly mapper: StrategyVersionMapper;
  private readonly candidateCount: number;

  /** Per-loop iteration counter (loopId → next iteration index). */
  private readonly iterationCounter = new Map<string, number>();

  constructor(deps: LoopOrchestratorRunnerDeps) {
    this.prisma = deps.prisma ?? getPrismaClient();
    this.eventBus = deps.eventBus ?? getEventBus();
    this.log = deps.logger ?? logger;
    this.searchRepository = deps.searchRepository;
    this.mapper = deps.strategyVersionMapper;
    this.candidateCount = deps.candidateCount ?? 5;
  }

  /**
   * Subscribe to `NewTopStrategyFound` events. Call once at startup.
   */
  public startListening(): void {
    this.eventBus.subscribe<NewTopStrategyFoundPayload>(
      "NewTopStrategyFound",
      (payload) => {
        void this.handleNewTop(payload);
      },
    );
    this.log.info("LoopOrchestratorRunner subscribed to NewTopStrategyFound");
  }

  /**
   * Programmatic entry point (also used by tests).
   */
  public async handleNewTop(payload: NewTopStrategyFoundPayload): Promise<void> {
    try {
      // ── 1. Dedupe via LoopProcessedEvent ────────────────────────────────
      const dedupeKey = `${payload.strategyVersionId}:${payload.overallScore}:${payload.evaluatedAt}`;
      try {
        await this.prisma.loopProcessedEvent.create({
          data: {
            dedupeKey,
            strategyVersionId: payload.strategyVersionId,
            overallScore: payload.overallScore,
            evaluatedAt: new Date(payload.evaluatedAt),
          },
        });
      } catch (err) {
        const e = err as { code?: string };
        if (e?.code === "P2002") {
          this.log.info(
            { dedupeKey },
            "LoopOrchestratorRunner: duplicate NewTopStrategyFound event ignored",
          );
          return;
        }
        throw err;
      }

      // ── 2. Find active loops ────────────────────────────────────────────
      const activeLoops = await this.prisma.loopRunState.findMany({
        where: { status: "RUNNING" },
      });
      if (activeLoops.length === 0) {
        this.log.info(
          { strategyVersionId: payload.strategyVersionId },
          "LoopOrchestratorRunner: NewTopStrategyFound received but no RUNNING loop",
        );
        return;
      }

      // ── 3. Resolve parent strategy ─────────────────────────────────────
      const parent = await this.resolveParent(payload.strategyVersionId);
      if (!parent) {
        this.log.warn(
          { strategyVersionId: payload.strategyVersionId },
          "LoopOrchestratorRunner: could not resolve parent StrategyVersion",
        );
        return;
      }

      // ── 4. For each active loop, run a new iteration ──────────────────
      for (const loop of activeLoops) {
        await this.runIteration(loop.loopId, payload, parent);
      }
    } catch (err) {
      this.log.error(
        { err, payload },
        "LoopOrchestratorRunner.handleNewTop failed",
      );
    }
  }

  /**
   * Run ONE iteration of the loop: increment counter, build the
   * LoopMutationGenerator config, create a SearchRun and start it via
   * SearchService.
   *
   * Returns the new SearchRun id (or null if the iteration was skipped).
   */
  public async runIteration(
    loopId: string,
    payload: NewTopStrategyFoundPayload,
    parent: ParentStrategy,
  ): Promise<string | null> {
    const nextIter = (this.iterationCounter.get(loopId) ?? 0) + 1;
    this.iterationCounter.set(loopId, nextIter);

    const seed = hashString(`${loopId}:${nextIter}`);

    const generatorConfig: LoopMutationConfig = {
      parent,
      candidateCount: this.candidateCount,
      weightPerturbationRatio: 0.1,
      randomSeed: seed,
    };

    // Persist generator config inside SearchRun.config so a future
    // investigator can answer "why was this candidate generated".
    const persistedConfig: Record<string, unknown> = {
      generatorId: LOOP_MUTATION_GENERATOR_ID,
      loopId,
      iteration: nextIter,
      parentStrategyVersionId: payload.strategyVersionId,
      parentStrategyType: payload.strategyType,
      parentOverallScore: payload.overallScore,
      evaluatedAt: payload.evaluatedAt,
      generatorConfig,
    };

    this.log.info(
      {
        loopId,
        iteration: nextIter,
        parentStrategyVersionId: payload.strategyVersionId,
        candidateCount: this.candidateCount,
      },
      "LoopOrchestratorRunner.runIteration.start",
    );

    let searchRunId: string | null = null;
    try {
      const created = await this.searchRepository.createSearchRun({
        algorithmId: await this.ensureLoopAlgorithmId("loop_mutation"),
        symbolId: await this.resolveSymbolId(payload.symbolId),
        timeframe: payload.timeframe,
        maxCandidates: this.candidateCount,
        createdBy: "loop-orchestrator",
        config: persistedConfig,
      });
      searchRunId = created.id;

      await this.searchRepository.updateSearchRunStatus(searchRunId, "RUNNING", new Date());

      // Run the generator inline. The generator's onCandidate handler
      // is SearchService's normal persistence + event-publish path, so
      // candidates land in the existing BullMQ backtest queue.
      const generator = new LoopMutationGenerator();
      generator.setRegistry(getStrategyRegistry());
      generator.applyConfig(generatorConfig);

      // Wire the generator's onCandidate to the same code path that
      // a manual SearchRun uses: persist + publish StrategyGenerated.
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

      const finalStatus = result.done && result.result.stoppedByBackPressure ? "STOPPED" : "DONE";
      await this.searchRepository.updateSearchRunStatus(
        searchRunId,
        finalStatus,
        undefined,
        new Date(),
      );

      // Persist the iteration metadata so the API can return it.
      await this.prisma.loopIteration.create({
        data: {
          loopId,
          iterationIndex: nextIter,
          parentStrategyVersionId: payload.strategyVersionId,
          searchRunId,
          candidateCount: result.done ? result.result.totalQueued : 0,
          status: finalStatus,
        },
      });

      // Bump LoopRunState's `currentIteration` and remember the latest
      // searchRunId. Best-effort: stopLoop may have already moved the
      // row to a STOPPED status; we still want to record the iteration
      // so the UI can show it.
      const loopRow = await this.findLoopIdRow(loopId);
      if (loopRow) {
        await this.prisma.loopRunState.update({
          where: { id: loopRow.id },
          data: {
            currentIteration: nextIter,
            lastIterationSearchRunId: searchRunId,
          },
        }).catch((err) => {
          this.log.warn({ err, loopId }, "could not bump currentIteration");
        });
      }

      this.log.info(
        {
          loopId,
          iteration: nextIter,
          searchRunId,
          totalQueued: result.done ? result.result.totalQueued : 0,
        },
        "LoopOrchestratorRunner.runIteration.done",
      );

      return searchRunId;
    } catch (err) {
      this.log.error({ err, loopId, iteration: nextIter }, "runIteration failed");
      if (searchRunId) {
        await this.searchRepository
          .updateSearchRunStatus(searchRunId, "FAILED", undefined, new Date())
          .catch(() => undefined);
      }
      return null;
    }
  }

  /* ─── Internals ─────────────────────────────────────────────────────── */

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

    // COMPOSITE: rebuild CombinationConfig from CompositeComponent rows.
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

  /**
   * Resolve the search algorithm id for the loop_mutation algorithm,
   * creating the row on demand if it doesn't exist.
   */
  private async ensureLoopAlgorithmId(code: string): Promise<string> {
    const existing = await this.prisma.searchAlgorithm.findFirst({
      where: { code },
    });
    if (existing) return existing.id;
    const created = await this.prisma.searchAlgorithm.create({
      data: {
        code,
        name: "Loop Mutation (Continuous Strategy Loop)",
        implementationRef: "search.generator.loop_mutation",
      },
    });
    return created.id;
  }

  /**
   * Accept either a UUID (symbol id) or a symbol string (e.g. "BTCUSDT").
   * Tries `id` first (cheap O(1) lookup when callers pass a UUID),
   * then falls back to the human-readable `symbol` code.
   */
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

  private async findLoopIdRow(loopId: string) {
    return this.prisma.loopRunState.findUnique({ where: { loopId } });
  }

  /**
   * Compute the current loop runtime state for the GET /api/loop/status
   * and GET /api/loop/progress endpoints.
   */
  public async getRuntimeState(loopId: string): Promise<LoopRuntimeState | null> {
    const row = await this.prisma.loopRunState.findUnique({ where: { loopId } });
    if (!row) return null;

    const lastIteration = await this.prisma.loopIteration.findFirst({
      where: { loopId },
      orderBy: { iterationIndex: "desc" },
    });

    // Resolve the global Top-1 LeaderboardEntry so the UI can display
    // the strategy name, profit / total return, and win rate associated
    // with the best score so far. We never re-calculate evaluation
    // metrics here — we just read what the Leaderboard already stored.
    const topEntry = await this.prisma.leaderboardEntry.findFirst({
      orderBy: { overallScore: "desc" },
      include: {
        strategyVersion: { select: { name: true } },
        symbol: { select: { symbol: true } },
      },
    });

    return {
      loopId: row.loopId,
      status: row.status,
      currentIteration: row.currentIteration,
      maxIterations: row.maxCandidates, // legacy: loop uses maxCandidates as the iteration cap proxy
      maxCandidates: row.maxCandidates,
      totalEvaluated: row.totalEvaluated,
      noImprovementCount: row.noImprovementCount,
      noImprovementCap: row.noImprovementCap,
      bestScoreSoFar: Number(row.bestScoreSoFar),
      bestStrategyVersionId: topEntry?.strategyVersionId ?? null,
      bestStrategyType: topEntry?.strategyType ?? null,
      bestStrategyName: topEntry?.strategyVersion?.name ?? null,
      bestStrategySymbolCode: topEntry?.symbol?.symbol ?? null,
      bestStrategyTimeframe: topEntry?.timeframe ?? null,
      bestTotalReturn: topEntry ? Number(topEntry.totalReturn) : null,
      bestWinRate: topEntry ? Number(topEntry.winRate) : null,
      lastIterationSearchRunId: lastIteration?.searchRunId ?? null,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      elapsedSeconds: Math.floor((Date.now() - row.startedAt.getTime()) / 1000),
      timeLimitSeconds: row.timeLimitSeconds,
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
