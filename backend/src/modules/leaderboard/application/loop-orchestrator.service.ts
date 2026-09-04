/**
 * leaderboard · application · LoopOrchestratorService
 *
 * Owns the `loop_run_states` table and emits the per-loop counters
 * (cumulative `totalEvaluated`, `noImprovementCount`, `bestScoreSoFar`)
 * in response to `StrategyEvaluated` events.
 *
 * Cross-loop safety (Phase 3):
 *
 *   The previous version of this file iterated over EVERY RUNNING loop
 *   for EVERY `StrategyEvaluated` event, which meant that one loop's
 *   candidates would corrupt another loop's counters. The current
 *   implementation filters by `payload.loopId` derived upstream by
 *   the evaluation worker (see `evaluation/infrastructure/
 *   strategyEvaluatedContext.ts`). Only the loop whose `loopId` is in
 *   the payload is updated.
 *
 *   When `payload.loopId` is null (e.g. a manual backtest or a search
 *   run started outside a loop) we skip — the event has no loop
 *   owner.
 *
 * Stop-condition semantics (Phase 3):
 *
 *   - `totalEvaluated` and `noImprovementCount` are bumped on every
 *     candidate that finishes evaluation. This is the
 *     "cumulative across the loop" semantic requested by the spec.
 *   - `STOPPED_NO_IMPROVEMENT` therefore fires after
 *     `noImprovementCap` consecutive non-improving candidates, not
 *     iterations. This matches the existing `noImprovementCap` column
 *     semantics.
 *   - For iteration-level no-improvement the orchestrator runner uses
 *     `LoopIteration.bestScoreInIteration` and updates
 *     `LoopRunState.noImprovementCount` once per completed iteration
 *     (see `loop-orchestrator-runner.ts`).
 *
 * Idempotency:
 *
 *   We do NOT write to `loop_processed_events` here. The runner owns
 *   the dedupe table for `NewTopStrategyFound` events. This service
 *   simply updates counters; counter updates are idempotent for
 *   re-deliveries because each candidate only emits one
 *   `StrategyEvaluated`.
 */
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus, type EventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";

export interface LoopConfig {
  loopId: string;
  maxCandidates?: number;
  timeLimitSeconds?: number;
  noImprovementCap?: number;
  maxIterations?: number;
  candidateCountPerIteration?: number;
  mutationRatio?: number;
  crossoverRatio?: number;
  explorationRatio?: number;
  elitePoolSize?: number;
  initialParentStrategyVersionId?: string | null;
}

export type LoopStatus =
  | "RUNNING"
  | "PAUSED"
  | "STOPPED_MAX_CANDIDATES"
  | "STOPPED_TIMEOUT"
  | "STOPPED_NO_IMPROVEMENT"
  | "STOPPED_MAX_ITERATIONS"
  | "STOPPED_MANUAL";

export class LoopOrchestratorService {
  private prisma = getPrismaClient();

  constructor(private readonly eventBus: EventBus = getEventBus()) {
    this.registerEventListener();
  }

  private registerEventListener(): void {
    this.eventBus.subscribe<{
      strategyVersionId: string;
      overallScore: number;
      loopId?: string | null;
      experimentId?: string;
      candidateId?: string | null;
      searchRunId?: string | null;
      iterationIndex?: number | null;
    }>("StrategyEvaluated", (payload) => {
      void this.handleStrategyEvaluatedForLoop(payload);
    });
  }

  public async startLoop(config: LoopConfig): Promise<void> {
    const loopId = config.loopId;
    if (!loopId) {
      throw new Error("LoopOrchestratorService.startLoop: loopId is required");
    }
    const maxCandidates = config.maxCandidates ?? 100;
    const timeLimitSeconds = config.timeLimitSeconds ?? 3600;
    const noImprovementCap = config.noImprovementCap ?? 50;
    const maxIterations = config.maxIterations ?? 20;
    const candidateCountPerIteration = config.candidateCountPerIteration ?? 5;
    const mutationRatio = config.mutationRatio ?? 0.4;
    const crossoverRatio = config.crossoverRatio ?? 0.2;
    const explorationRatio = config.explorationRatio ?? 0.4;
    const elitePoolSize = config.elitePoolSize ?? 3;

    await this.prisma.loopRunState.upsert({
      where: { loopId },
      update: {
        status: "RUNNING",
        maxCandidates,
        timeLimitSeconds,
        noImprovementCap,
        maxIterations,
        candidateCountPerIteration,
        mutationRatio,
        crossoverRatio,
        explorationRatio,
        elitePoolSize,
        // Reset cumulative counters when (re-)starting.
        totalEvaluated: 0,
        noImprovementCount: 0,
        bestScoreSoFar: 0,
        bestStrategyVersionId: null,
        bestStrategySymbolId: null,
        bestStrategyTimeframe: null,
        bestTotalReturn: null,
        bestWinRate: null,
        stopReason: null,
        inFlightSearchRunId: null,
        lastIterationSearchRunId: null,
        updatedAt: new Date(),
      },
      create: {
        loopId,
        status: "RUNNING",
        maxCandidates,
        timeLimitSeconds,
        noImprovementCap,
        maxIterations,
        candidateCountPerIteration,
        mutationRatio,
        crossoverRatio,
        explorationRatio,
        elitePoolSize,
        initialParentStrategyVersionId:
          config.initialParentStrategyVersionId ?? null,
        totalEvaluated: 0,
        noImprovementCount: 0,
        bestScoreSoFar: 0,
      },
    });

    logger.info(
      {
        loopId,
        maxCandidates,
        timeLimitSeconds,
        noImprovementCap,
        maxIterations,
        candidateCountPerIteration,
      },
      "Continuous Strategy Loop started",
    );
    this.eventBus.publish("LoopStatusChanged", { loopId, status: "RUNNING" });
  }

  public async pauseLoop(loopId: string): Promise<void> {
    await this.prisma.loopRunState.update({
      where: { loopId },
      data: { status: "PAUSED" },
    });
    this.eventBus.publish("LoopStatusChanged", { loopId, status: "PAUSED" });
  }

  public async stopLoop(loopId: string, reason: LoopStatus = "STOPPED_MANUAL"): Promise<void> {
    await this.prisma.loopRunState.update({
      where: { loopId },
      data: { status: reason, stopReason: reason },
    });
    logger.info({ loopId, reason }, "Continuous Strategy Loop stopped");
    this.eventBus.publish("LoopStatusChanged", { loopId, status: reason });
  }

  public async getLoopState(loopId: string) {
    return this.prisma.loopRunState.findUnique({ where: { loopId } });
  }

  /**
   * Update cumulative counters for the SPECIFIC loop whose `loopId` was
   * derived upstream. Cross-loop pollution is no longer possible.
   *
   * No-op when the payload has no `loopId`.
   */
  private async handleStrategyEvaluatedForLoop(payload: {
    strategyVersionId: string;
    overallScore: number;
    loopId?: string | null;
    experimentId?: string;
    candidateId?: string | null;
    searchRunId?: string | null;
    iterationIndex?: number | null;
  }): Promise<void> {
    if (!payload.loopId) {
      return; // No loop ownership → nothing to update.
    }
    const loop = await this.prisma.loopRunState.findUnique({
      where: { loopId: payload.loopId },
    });
    if (!loop || loop.status !== "RUNNING") {
      return; // Only update RUNNING loops.
    }

    const newTotalEvaluated = loop.totalEvaluated + 1;
    const currentBest = Number(loop.bestScoreSoFar);
    const newScore = payload.overallScore;

    let newBest = currentBest;
    let newNoImpCount = loop.noImprovementCount + 1;
    if (newScore > currentBest && newScore > 0) {
      newBest = newScore;
      newNoImpCount = 0;
    }

    // Per-iteration bookkeeping (best score in the current iteration).
    if (payload.iterationIndex != null) {
      const iter = await this.prisma.loopIteration.findFirst({
        where: {
          loopId: payload.loopId,
          iterationIndex: payload.iterationIndex,
        },
      });
      if (iter) {
        const iterBest = Number(iter.bestScoreInIteration);
        const newEvaluatedCount = iter.evaluatedCount + 1;
        const newIterBest = Math.max(iterBest, newScore);
        await this.prisma.loopIteration.update({
          where: { id: iter.id },
          data: {
            evaluatedCount: newEvaluatedCount,
            bestScoreInIteration: newIterBest,
            bestStrategyVersionId:
              newScore > iterBest ? payload.strategyVersionId : iter.bestStrategyVersionId,
          },
        });
      }
    }

    // Stop conditions (per spec §20).
    const elapsedSeconds = (Date.now() - loop.startedAt.getTime()) / 1000;
    let stopReason: LoopStatus | null = null;
    if (newTotalEvaluated >= loop.maxCandidates) {
      stopReason = "STOPPED_MAX_CANDIDATES";
    } else if (elapsedSeconds >= loop.timeLimitSeconds) {
      stopReason = "STOPPED_TIMEOUT";
    } else if (newNoImpCount >= loop.noImprovementCap) {
      stopReason = "STOPPED_NO_IMPROVEMENT";
    }

    const nextStatus = stopReason || "RUNNING";

    await this.prisma.loopRunState.update({
      where: { id: loop.id },
      data: {
        totalEvaluated: newTotalEvaluated,
        bestScoreSoFar: newBest,
        noImprovementCount: newNoImpCount,
        status: nextStatus,
        stopReason: stopReason ?? undefined,
      },
    });

    if (stopReason) {
      logger.info(
        {
          loopId: loop.loopId,
          stopReason,
          totalEvaluated: newTotalEvaluated,
        },
        "Stop Condition triggered",
      );
      this.eventBus.publish("LoopStatusChanged", { loopId: loop.loopId, status: stopReason });
    }
  }
}
