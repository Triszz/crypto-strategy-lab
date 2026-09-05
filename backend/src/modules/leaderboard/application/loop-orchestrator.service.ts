/**
 * leaderboard · application · LoopOrchestratorService  (Phase 3.2)
 *
 * Single owner of LoopRunState and LoopIteration row state. Every
 * counter / metric is updated transactionally so concurrent events for
 * the same loop cannot double-count, leak memory, or drift.
 *
 * Lifecycle invariants (Phase 3.2):
 *
 *   1. Every `StrategyEvaluated` is de-duplicated by
 *      `(loopId, experimentId)` via the persistent
 *      `LoopProcessedEvent` table (unique `dedupeKey`). Duplicate
 *      events are silently skipped — they do NOT bump counters,
 *      noImprovement, bestScore, or trigger iteration completion.
 *
 *   2. `LoopRunState.totalEvaluated` reflects the number of UNIQUE
 *      candidates that reached a terminal evaluation state. It can
 *      never exceed `actualCandidateCount` summed across iterations.
 *
 *   3. `LoopIteration.bestScoreInIteration` is ALWAYS recomputed
 *      from the authoritative `BacktestResult` rows for that
 *       iteration's SearchRun, not from event-arrival order.
 *
 *   4. `LoopIteration.bestStrategyVersionId` is the
 *      `CandidateStrategy.strategyVersionId` of the candidate whose
 *      score is the iteration's best — attribution and score come
 *      from the same row in the same read.
 *
 *   5. Iteration completion is idempotent: `updateMany` with
 *      `status: "RUNNING"` guard. Only the FIRST winner may proceed;
 *      later calls become no-ops.
 *
 *   6. `LoopRunState` and `LoopIteration` status are mutually
 *      consistent. When the loop transitions to STOPPED_*, any
 *      still-RUNNING iterations are cascaded to STOPPED in the same
 *      transaction. The endpoint invariant is:
 *         status == STOPPED_*  →  no iteration is RUNNING.
 *
 *   7. Stop conditions use ONE writer (this service) per counter:
 *      - `totalEvaluated`  — single writer (this service).
 *      - `noImprovementCount` — single writer (this service).
 *      - `bestScoreSoFar` / best strategy identity — single writer (this service).
 *
 *   8. No in-memory Set / Map is used for correctness. All hot-path
 *      mutations persist to the database and rely on SQL constraints
 *      for concurrency safety.
 */
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { PrismaClient } from "@prisma/client";
import { getEventBus, type EventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";

/**
 * Forward-declared subset of `LoopOrchestratorRunner`. The runner owns
 * the iteration lifecycle (candidate generation + per-iteration CAS
 * completion). The orchestrator owns EVERYTHING ELSE: counters, stop
 * conditions, best-score recompute, dedupe, and the decision to start
 * the next iteration or stop the loop.
 */
export interface LoopOrchestratorRunnerLike {
  /**
   * Create an iteration's SearchRun (HybridLoopGenerator) and persist
   * the LoopIteration row. Idempotent for (loopId, iterationIndex).
   */
  runIteration(
    loopId: string,
    iterationIndex: number,
    parentStrategyVersionId: string,
  ): Promise<string | null>;

  /**
   * Persist a new LoopIteration row for an already-existing
   * SearchRun. Used for iteration #1 by Combination.handleSubmit.
   */
  registerIteration(args: RegisterIterationArgs): Promise<void>;

  /**
   * Idempotent iteration completion check. Returns true iff THIS
   * call is the one that transitioned RUNNING → DONE.
   */
  maybeCompleteIteration(
    loopId: string,
    iterationIndex: number,
  ): Promise<{ completed: boolean; parentForNextIter: string | null }>;
}

export interface RegisterIterationArgs {
  loopId: string;
  iterationIndex: number;
  parentStrategyVersionId: string;
  searchRunId: string;
  candidateCount: number;
  isInitial?: boolean;
}

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

export interface IterationLifecycleEvent {
  loopId: string;
  iterationIndex: number;
  eventType:
    | "ITERATION_REGISTERED"
    | "ITERATION_COMPLETED"
    | "ITERATION_BEST_UPDATED";
  searchRunId: string | null;
  bestScore: number | null;
  bestStrategyVersionId: string | null;
  evaluatedCount: number;
  actualCandidateCount: number;
}

export class LoopOrchestratorService {
  private prisma: PrismaClient;
  private runner: LoopOrchestratorRunnerLike | null = null;

  constructor(
    private readonly eventBus: EventBus = getEventBus(),
    prismaOverride?: PrismaClient,
  ) {
    this.prisma = prismaOverride ?? getPrismaClient();
    this.registerEventListener();
  }

  public setRunner(runner: LoopOrchestratorRunnerLike): void {
    this.runner = runner;
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
      symbolId?: string;
      timeframe?: string;
      totalReturn?: number;
      winRate?: number;
      maxDrawdown?: number;
    }>("StrategyEvaluated", (payload) => {
      this.handleStrategyEvaluatedForLoop(payload).catch((err) => {
        logger.error(
          { err, loopId: payload.loopId, experimentId: payload.experimentId },
          "[Phase 3.2 e2e] handleStrategyEvaluatedForLoop threw",
        );
      });
    });
    // BacktestFailed for a loop-owned candidate is counted as
    // evaluated (with overallScore=0). The runner already invokes
    // the same counter path internally.
    this.eventBus.subscribe<{
      jobId?: string;
      candidateId?: string;
      error?: string;
      failedAt?: string;
    }>("BacktestFailed", (payload) => {
      void this.handleBacktestFailedForLoop(payload);
    });
    // LoopIterationCompleted — fired by the runner when an
    // iteration transitions RUNNING → DONE (CAS winner). Triggers
    // the orchestrator's afterIterationCompleted to start iter N+1
    // or stop the loop.
    this.eventBus.subscribe<{
      loopId: string;
      iterationIndex: number;
      parentForNextIter: string | null;
    }>("LoopIterationCompleted", (payload) => {
      this.afterIterationCompleted(
        payload.loopId,
        payload.iterationIndex,
        payload.parentForNextIter,
      ).catch((err) => {
        logger.error(
          { err, ...payload },
          "[ContinuousLoop] afterIterationCompleted via event threw",
        );
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Lifecycle: start / pause / resume / stop
   * ─────────────────────────────────────────────────────────────── */

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
        currentIteration: 0,
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

    // Always start a fresh processing ledger per restart.
    logger.info({ loopId }, "[Phase 3.2 e2e] startLoop deleteMany called");
    await this.prisma.loopProcessedEvent.deleteMany({ where: { loopId } });
    await this.prisma.loopIteration.deleteMany({ where: { loopId } });

    logger.info(
      {
        loopId,
        maxCandidates,
        timeLimitSeconds,
        noImprovementCap,
        maxIterations,
        candidateCountPerIteration,
      },
      "[ContinuousLoop] started",
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

  public async stopLoop(
    loopId: string,
    reason: LoopStatus = "STOPPED_MANUAL",
  ): Promise<void> {
    await this.cascadeStop(loopId, reason, /* fromOrchestrator */ false);
  }

  public async getLoopState(loopId: string) {
    return this.prisma.loopRunState.findUnique({ where: { loopId } });
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Single-writer event handler
   * ─────────────────────────────────────────────────────────────── */

  private async handleStrategyEvaluatedForLoop(payload: {
    strategyVersionId: string;
    overallScore: number;
    loopId?: string | null;
    experimentId?: string;
    candidateId?: string | null;
    searchRunId?: string | null;
    iterationIndex?: number | null;
    symbolId?: string;
    timeframe?: string;
    totalReturn?: number;
    winRate?: number;
    maxDrawdown?: number;
  }): Promise<void> {
    if (!payload.loopId || !payload.experimentId) return;
    const loopId = payload.loopId;
    const dedupeKey = `${loopId}:${payload.experimentId}`;

    // ── Dedupe via UNIQUE persistent row. ───────────────────────────
    let isNewEvaluation = true;
    try {
      await this.prisma.loopProcessedEvent.create({
        data: {
          dedupeKey,
          strategyVersionId: payload.strategyVersionId,
          overallScore: payload.overallScore,
          loopId,
          evaluatedAt: new Date(),
        },
      });
    } catch (err) {
      // P2002 = unique violation → duplicate event, skip.
      const code = (err as { code?: string }).code;
      if (code !== "P2002") {
        logger.error(
          { err, dedupeKey },
          "[ContinuousLoop] unexpected error inserting LoopProcessedEvent",
        );
      }
      isNewEvaluation = false;
    }
    if (!isNewEvaluation) {
      // Re-check completion: a duplicate event might be the last
      // arrival that triggers an iteration transition.
      if (payload.iterationIndex != null && this.runner) {
        await this.runner
          .maybeCompleteIteration(loopId, payload.iterationIndex)
          .catch(() => undefined);
      }
      return;
    }

    // ── Persist the candidate's backtestResult attribution (best score
    // recompute needs the BacktestResult row; it was already created by
    // the evaluator before this event fires, so we can read it now).
    // ─────────────────────────────────────────────────────────────────

    // ── Loop-level atomic update (CAS-guarded best score). ──────────
    // All counters are owned by this service; we avoid RMW races on
    // bestScore by recomputing the best from this candidate's score.
    const previous = await this.prisma.loopRunState.findUnique({
      where: { loopId },
    });
    if (!previous) return;
    if (previous.status !== "RUNNING") {
      // Late arrival for a loop that's no longer running. We still
      // record it (above) but do not mutate counters.
      return;
    }

    const previousBest = Number(previous.bestScoreSoFar);
    const newScore = Number(payload.overallScore);

    // Phase 3.2 fix: REMOVED the per-event CAS-guarded
    // `bestScoreSoFar = newScore` write. It is race-unsafe (CAS
    // guard uses stale `previousBest` and silently fails for
    // concurrent events), AND it leaves `bestStrategyVersionId`
    // null because attribution is only set by `recomputeLoopBest`
    // further down. Now the loop-level best metrics are owned
    // entirely by `recomputeLoopBest`, which always reads
    // authoritative BacktestResult rows.

    // For the counters: totalEvaluated is bumped once per unique
    // evaluation (the unique insert above). `noImprovementCount` is
    // reset to 0 on improvement, otherwise incremented by 1. We use
    // CAS guards on RUNNING status for safety. The +1 of
    // totalEvaluated is always executed because dedupe has already
    // ensured we never enter this branch twice for the same event.
    const updateResult = await this.prisma.loopRunState.updateMany({
      where: { loopId, status: "RUNNING" },
      data: {
        totalEvaluated: { increment: 1 },
        ...(newScore > previousBest
          ? { noImprovementCount: 0 }
          : { noImprovementCount: { increment: 1 } }),
        updatedAt: new Date(),
      },
    });
    logger.info(
      {
        loopId,
        experimentId: payload.experimentId,
        newScore,
        previousBest,
        updateCount: updateResult.count,
      },
      "[Phase 3.2 e2e] orchestrator totalEvaluated increment result",
    );

    // Re-read for downstream bookkeeping.
    const loopAfter = await this.prisma.loopRunState.findUnique({
      where: { loopId },
    });
    if (!loopAfter) return;

    // ── Per-iteration counter: bump current iteration's
    //   `evaluatedCount` atomically by 1, so frontend
    //   `currentIterationEvaluatedCount` reflects real progress.
    if (payload.iterationIndex != null && payload.searchRunId != null) {
      try {
        await this.prisma.loopIteration.updateMany({
          where: {
            loopId,
            iterationIndex: payload.iterationIndex,
            status: "RUNNING",
          },
          data: {
            evaluatedCount: { increment: 1 },
          },
        });
      } catch (err) {
        logger.error(
          { err, loopId, iterationIndex: payload.iterationIndex },
          "[ContinuousLoop] per-iteration evaluatedCount increment failed",
        );
      }
    }

    // ── Per-iteration bookkeeping: recompute bestScoreInIteration
    //   and bestStrategyVersionId from the authoritative rows.
    // ─────────────────────────────────────────────────────────────────
    if (
      payload.iterationIndex != null &&
      payload.candidateId != null
    ) {
      await this.recomputeIterationBest(
        loopId,
        payload.iterationIndex,
        payload.candidateId,
      );
    }

    // ── Stop-condition checks (post-update). ────────────────────────
    const stop = await this.checkStopConditions(loopAfter);
    if (stop) {
      await this.cascadeStop(loopId, stop, /* fromOrchestrator */ true);
      return;
    }

    // ── Delegate iteration completion. The runner is the only place
    // that decides whether to flip RUNNING → DONE; we always delegate.
    // The orchestrator then decides whether to start iteration N+1
    // or stop the loop based on the loop-level state.
    // ─────────────────────────────────────────────────────────────────
    if (payload.iterationIndex != null && this.runner) {
      try {
        // The runner emits `LoopIterationCompleted` if it CAS-wins
        // the iteration to DONE. We don't need the return value
        // here — the orchestrator listens to that event for
        // post-completion decisions.
        await this.runner.maybeCompleteIteration(
          loopId,
          payload.iterationIndex,
        );
      } catch (err) {
        logger.error(
          { err, loopId, iterationIndex: payload.iterationIndex },
          "[ContinuousLoop] maybeCompleteIteration failed",
        );
      }
      // Always recompute loop-local best after a candidate event.
      // Cheap (one indexed MAX query) and keeps loop metrics in sync
      // with the authoritative BacktestResult rows.
      logger.info(
        { loopId, iterationIndex: payload.iterationIndex },
        "[Phase 3.2 e2e] about to call recomputeLoopBest",
      );
      await this.recomputeLoopBest(loopId);

      // Note: afterIterationCompleted is NOT called directly here.
      // The runner emits a LoopIterationCompleted event after the
      // CAS winner call; the orchestrator listens to that event and
      // runs afterIterationCompleted there. This ensures we never
      // start iteration N+1 from a stale view of the world.
    }
  }

  /* ─── Decide what happens after an iteration transitions to DONE ───── */

  /**
   * Called AFTER the runner reports an iteration has just completed
   * (CAS winner). The orchestrator owns the decision tree:
   *
   *   1. Read the latest loop state.
   *   2. Re-check stop conditions. If met, cascade stop.
   *   3. Otherwise: bump currentIteration (visual progress) and ask
   *      the runner to spin up iteration N+1.
   *
   * Single-writer invariant: this method always runs in the same
   * process as the caller (the orchestrator), so the
   * `lastIterationSearchRunId` swap is safe (sequential).
   */
  private async afterIterationCompleted(
    loopId: string,
    completedIterationIndex: number,
    parentForNextIter: string | null,
  ): Promise<void> {
    const loop = await this.prisma.loopRunState.findUnique({
      where: { loopId },
    });
    if (!loop) return;

    // Already stopped? Don't try to advance.
    if (loop.status !== "RUNNING") return;

    // Re-check stop conditions — these may be triggered by the
    // events we just processed.
    const stop = await this.checkStopConditions(loop);
    if (stop) {
      await this.cascadeStop(loopId, stop, /* fromOrchestrator */ true);
      return;
    }

    const nextIterationIndex = completedIterationIndex + 1;

    // maxIterations cap: if we'd exceed maxIterations, stop with
    // STOPPED_MAX_ITERATIONS. `maxIterations` is the COUNT of
    // iterations, independent from `maxCandidates`.
    if (nextIterationIndex > loop.maxIterations) {
      await this.cascadeStop(
        loopId,
        "STOPPED_MAX_ITERATIONS",
        /* fromOrchestrator */ true,
      );
      return;
    }

    // Bump loop.currentIteration so the UI sees the latest
    // iteration index even before iteration N+1 finishes generating.
    await this.prisma.loopRunState.update({
      where: { loopId },
      data: {
        currentIteration: nextIterationIndex,
        lastIterationSearchRunId:
          (
            await this.prisma.loopIteration.findFirst({
              where: { loopId, iterationIndex: completedIterationIndex },
              select: { searchRunId: true },
            })
          )?.searchRunId ?? loop.lastIterationSearchRunId,
        updatedAt: new Date(),
      },
    });

    // Ask the runner to create iteration N+1. The runner is
    // idempotent and refuses to create duplicates for the same
    // (loopId, nextIterationIndex). If the loop stopped between
    // the check above and now, runIteration early-returns.
    if (this.runner && parentForNextIter) {
      try {
        await this.runner.runIteration(
          loopId,
          nextIterationIndex,
          parentForNextIter,
        );
      } catch (err) {
        logger.error(
          { err, loopId, nextIterationIndex },
          "[ContinuousLoop] runIteration failed",
        );
      }
    }
  }

  /* ─── Failed-candidate terminal accounting ────────────────────────── */

  private async handleBacktestFailedForLoop(payload: {
    jobId?: string;
    candidateId?: string;
    error?: string;
    failedAt?: string;
  }): Promise<void> {
    if (!payload.candidateId) return;
    const candidate = await this.prisma.candidateStrategy.findUnique({
      where: { id: payload.candidateId },
      select: {
        id: true,
        strategyVersionId: true,
        searchRunId: true,
      },
    });
    if (!candidate) return;
    const iteration = await this.prisma.loopIteration.findFirst({
      where: { searchRunId: candidate.searchRunId },
      select: { loopId: true, iterationIndex: true },
    });
    if (!iteration) return;

    // Re-route through the canonical path with overallScore=0.
    await this.handleStrategyEvaluatedForLoop({
      strategyVersionId: candidate.strategyVersionId,
      overallScore: 0,
      loopId: iteration.loopId,
      iterationIndex: iteration.iterationIndex,
      candidateId: candidate.id,
      searchRunId: candidate.searchRunId,
      experimentId: `failed:${payload.jobId ?? payload.candidateId}`,
    });
  }

  /* ─── Best-score recompute (per iteration) ───────────────────────── */

  /**
   * Recomputes `bestScoreInIteration` and `bestStrategyVersionId`
   * from the authoritative `BacktestResult` rows for this iteration's
   * SearchRun.
   *
   * Single source of truth: the candidate whose `BacktestResult` has
   * the highest `overallScore` for the SearchRun. The same row's
   * `experiment.candidate.strategyVersionId` is the attribution —
   * score and identity ALWAYS come from the same candidate.
   *
   * Out-of-order safe: we ignore `BacktestResult.evaluatedAt`-like
   * arrival order and only consider the persisted score rows.
   */
  public async recomputeIterationBest(
    loopId: string,
    iterationIndex: number,
    _candidateIdHint?: string,
  ): Promise<void> {
    // Pick the iteration row (we need its searchRunId).
    const iteration = await this.prisma.loopIteration.findFirst({
      where: { loopId, iterationIndex },
    });
    if (!iteration || !iteration.searchRunId) return;

    const searchRunId = iteration.searchRunId;

    // Highest score from the authoritative BacktestResult rows for
    // this SearchRun. The result is matched to its candidate's
    // StrategyVersion so attribution and score are 1:1.
    //
    // Phase 3.2 fix: avoid Prisma's chained-relation join which can
    // throw "Field candidate is required to return data, got null".
    // We resolve candidate IDs first, query BacktestResult by
    // experiment.candidateId IN (one hop), then resolve the
    // candidate's strategyVersionId separately.
    const candidates = await this.prisma.candidateStrategy.findMany({
      where: { searchRunId },
      select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);
    if (candidateIds.length === 0) return;

    const top = await this.prisma.backtestResult.findFirst({
      where: { experiment: { candidateId: { in: candidateIds } } },
      orderBy: [{ overallScore: "desc" }, { createdAt: "asc" }],
      include: {
        experiment: { select: { candidateId: true } },
      },
    });
    if (!top) return;

    const candidateId = top.experiment?.candidateId;
    if (!candidateId) return;
    const candidateRow = await this.prisma.candidateStrategy.findUnique({
      where: { id: candidateId },
      select: { strategyVersionId: true },
    });
    if (!candidateRow) return;

    const bestScore = Number(top.overallScore);
    const bestStrategyVersionId = candidateRow.strategyVersionId;

    await this.prisma.loopIteration.update({
      where: { id: iteration.id },
      data: {
        bestScoreInIteration: bestScore,
        bestStrategyVersionId,
      },
    });

    this.eventBus.publish("LoopIterationEvent", {
      loopId,
      iterationIndex,
      eventType: "ITERATION_BEST_UPDATED",
      searchRunId,
      bestScore,
      bestStrategyVersionId,
      evaluatedCount: iteration.evaluatedCount,
      actualCandidateCount: iteration.candidateCount,
    } satisfies IterationLifecycleEvent);
  }

  /* ─── Stop-condition checks + cascade ─────────────────────────────── */

  private async checkStopConditions(loop: {
    totalEvaluated: number;
    maxCandidates: number;
    startedAt: Date;
    timeLimitSeconds: number;
    noImprovementCount: number;
    noImprovementCap: number;
    currentIteration: number;
    maxIterations: number;
  }): Promise<LoopStatus | null> {
    if (loop.totalEvaluated >= loop.maxCandidates) {
      return "STOPPED_MAX_CANDIDATES";
    }
    const elapsed = (Date.now() - loop.startedAt.getTime()) / 1000;
    if (elapsed >= loop.timeLimitSeconds) {
      return "STOPPED_TIMEOUT";
    }
    if (loop.noImprovementCount >= loop.noImprovementCap) {
      return "STOPPED_NO_IMPROVEMENT";
    }
    return null;
  }

  /**
   * Stop a loop AND cascade status to any in-flight RUNNING iteration
   * so the API endpoint invariant holds:
   *    loop.status == STOPPED_*  →  no iteration is RUNNING.
   *
   * Also recomputes loop-local best metrics from authoritative rows
   * (so we don't lose attribution on a non-improving candidate that
   * scored higher than the loop's last persisted best). This is the
   * closing path for `bestScoreSoFar` / `bestStrategyVersionId`.
   */
  public async cascadeStop(
    loopId: string,
    reason: LoopStatus,
    fromOrchestrator: boolean,
  ): Promise<void> {
    logger.info({ loopId, reason, fromOrchestrator }, "[Phase 3.2 e2e] cascadeStop called");
    const loopBefore = await this.prisma.loopRunState.findUnique({
      where: { loopId },
    });
    if (!loopBefore) return;

    // Atomic status transition. If the loop is already non-RUNNING
    // (already stopped via a parallel path), skip — we never want to
    // un-stop a loop.
    const trans = await this.prisma.loopRunState.updateMany({
      where: { loopId, status: "RUNNING" },
      data: { status: reason, stopReason: reason },
    });
    if (trans.count === 0 && fromOrchestrator) {
      // Already not RUNNING — orchestrator's race. Nothing to do.
      return;
    }

    // Cascade RUNNING iterations to STOPPED. Same transaction.
    await this.prisma.loopIteration.updateMany({
      where: { loopId, status: "RUNNING" },
      data: { status: "STOPPED" },
    });

    // Recompute the loop-local best from authoritative BacktestResult
    // rows. This guarantees `bestScoreSoFar` and the loop's
    // `bestStrategyVersionId` reflect the highest-scoring candidate
    // across all iterations, regardless of event arrival order.
    await this.recomputeLoopBest(loopId);

    logger.info(
      {
        loopId,
        reason,
        fromOrchestrator,
        finalStatus: "STOPPED",
      },
      "[ContinuousLoop] loop stopped (cascaded)",
    );

    this.eventBus.publish("LoopStatusChanged", { loopId, status: reason });
  }

  /**
   * Recompute the loop-level best score + identity from authoritative
   * BacktestResult rows. Looks at every iteration's SearchRun → all
   * candidates → max overallScore, and writes the same candidate's
   * strategyVersionId / symbol / timeframe / metrics into
   * LoopRunState.
   *
   * Idempotent and race-safe (always uses the persisted rows; never
   * reads in-memory counters).
   */
  public async recomputeLoopBest(loopId: string): Promise<void> {
    logger.info({ loopId }, "[Phase 3.2 e2e] recomputeLoopBest called");
    const iterations = await this.prisma.loopIteration.findMany({
      where: { loopId, searchRunId: { not: null } },
      select: { searchRunId: true },
    });
    const runIds = iterations
      .map((i) => i.searchRunId)
      .filter((s): s is string => Boolean(s));
    if (runIds.length === 0) {
      logger.info({ loopId, iterCount: iterations.length }, "[Phase 3.2 e2e] recomputeLoopBest no runIds");
      return;
    }

    // Phase 3.2 fix: avoid Prisma's chained-relation join which can
    // throw "Field candidate is required to return data, got null".
    // Resolve candidate IDs in one query, then fetch the top
    // backtestResult via experiment.candidateId IN (one hop), then
    // resolve strategyVersionId via a separate findUnique.
    const candidates = await this.prisma.candidateStrategy.findMany({
      where: { searchRunId: { in: runIds } },
      select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);
    if (candidateIds.length === 0) {
      logger.info({ loopId, runIds, candCount: candidates.length }, "[Phase 3.2 e2e] recomputeLoopBest no candidateIds");
      return;
    }

    const top = await this.prisma.backtestResult.findFirst({
      where: { experiment: { candidateId: { in: candidateIds } } },
      orderBy: [{ overallScore: "desc" }, { createdAt: "asc" }],
      include: {
        experiment: { select: { candidateId: true } },
      },
    });
    if (!top) {
      logger.info({ loopId, candidateIds }, "[Phase 3.2 e2e] recomputeLoopBest no top BR");
      return;
    }

    const candidateId = top.experiment?.candidateId;
    if (!candidateId) return;
    const topCandidate = await this.prisma.candidateStrategy.findUnique({
      where: { id: candidateId },
      select: { strategyVersionId: true, searchRunId: true },
    });
    if (!topCandidate) {
      logger.info({ loopId, candidateId }, "[Phase 3.2 e2e] recomputeLoopBest no topCandidate");
      return;
    }
    logger.info(
      {
        loopId,
        runIds,
        topOverallScore: top?.overallScore ? Number(top.overallScore) : null,
        // top.experiment only has candidateId in the select; the full
        // candidate row (with searchRunId/strategyVersionId) is
        // resolved separately via topCandidate below. We log the
        // resolved topCandidate fields instead.
        topCandidateSearchRunId: topCandidate.searchRunId,
        topCandidateStrategyVersionId: topCandidate.strategyVersionId,
      },
      "[Phase 3.2 e2e] recomputeLoopBest top pick",
    );
    if (!top) return;

    const loop = await this.prisma.loopRunState.findUnique({
      where: { loopId },
    });
    if (!loop) return;
    if (Number(loop.bestScoreSoFar) >= Number(top.overallScore)) {
      // Already at or above this score. Don't regress.
      return;
    }

    await this.prisma.loopRunState.update({
      where: { loopId },
      data: {
        bestScoreSoFar: top.overallScore,
        bestStrategyVersionId: topCandidate.strategyVersionId,
        bestStrategySymbolId: top.symbolId,
        bestStrategyTimeframe: top.timeframe,
        bestTotalReturn: top.totalReturn,
        bestWinRate: top.winRate,
        updatedAt: new Date(),
      },
    });
  }
}
