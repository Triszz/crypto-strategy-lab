/**
 * leaderboard · presentation · loop.routes
 *
 * REST endpoints for the Continuous Strategy Loop:
 *
 *   POST   /api/loop/start         — start (or restart) a loop; optionally
 *                                      register an existing SearchRun as
 *                                      iteration #1 (initial combination search)
 *   POST   /api/loop/pause         — pause a RUNNING loop
 *   POST   /api/loop/resume        — resume a PAUSED loop
 *   POST   /api/loop/stop          — stop a loop
 *   GET    /api/loop/status        — current loop state (or 404 if no loop)
 *   GET    /api/loop/progress      — iteration + best (loop-local) + elapsed
 *   GET    /api/loop/candidates    — candidates grouped by iteration
 *   GET    /api/loop/list          — list all loops
 *
 * The router delegates to `LoopOrchestratorService` (state + stop
 * conditions) and `LoopOrchestratorRunner` (iteration metadata) when
 * available. It NEVER touches CandidateStrategy or Backtest directly.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { LoopOrchestratorService } from "../application/loop-orchestrator.service";
import type { LoopOrchestratorRunner } from "../application/loop-orchestrator-runner";
import { logger as rootLogger } from "../../../shared/logger/logger";
import type { Logger } from "../../../shared/logger/logger";

export interface LoopRouterDeps {
  /** Required — the teammate-owned orchestrator that owns state + stop conditions. */
  orchestrator: LoopOrchestratorService;
  /** Optional — the Search-side runner that owns iteration metadata. */
  runner?: LoopOrchestratorRunner;
  logger?: Logger;
}

const StartSchema = z.object({
  loopId: z.string().min(1).max(64).optional(),
  maxCandidates: z.number().int().positive().max(100_000).optional(),
  maxIterations: z.number().int().positive().max(1000).optional(),
  timeLimitSeconds: z.number().int().positive().max(86_400).optional(),
  noImprovementCap: z.number().int().positive().max(10_000).optional(),
  candidateCountPerIteration: z.number().int().min(1).max(100).optional(),
  mutationRatio: z.number().min(0).max(1).optional(),
  crossoverRatio: z.number().min(0).max(1).optional(),
  explorationRatio: z.number().min(0).max(1).optional(),
  elitePoolSize: z.number().int().min(1).max(20).optional(),
  // ── Initial iteration binding ──────────────────────────────────────────
  // When provided, the existing SearchRun is registered as iteration #1.
  initialSearchRunId: z.string().uuid().optional(),
  parentStrategyVersionId: z.string().uuid().optional(),
});

const IdSchema = z.object({
  loopId: z.string().min(1).max(64),
});

export function buildLoopRouter(deps: LoopRouterDeps): Router {
  const router = Router();
  const log = deps.logger ?? rootLogger;
  const prisma = getPrismaClient();

  // ── POST /api/loop/start ──────────────────────────────────────────────────
  router.post("/start", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_BODY",
        details: parsed.error.issues,
      });
      return;
    }
    try {
      const effectiveLoopId =
        parsed.data.loopId ?? `loop-${Date.now()}`;

      // Start (or restart) the loop in the orchestrator.
      await deps.orchestrator.startLoop({
        loopId: effectiveLoopId,
        maxCandidates: parsed.data.maxCandidates,
        maxIterations: parsed.data.maxIterations,
        timeLimitSeconds: parsed.data.timeLimitSeconds,
        noImprovementCap: parsed.data.noImprovementCap,
        candidateCountPerIteration: parsed.data.candidateCountPerIteration,
        mutationRatio: parsed.data.mutationRatio,
        crossoverRatio: parsed.data.crossoverRatio,
        explorationRatio: parsed.data.explorationRatio,
        elitePoolSize: parsed.data.elitePoolSize,
        initialParentStrategyVersionId: parsed.data.parentStrategyVersionId,
      });

      // Phase 3.3: persist the active-loop pointer so navigating away
      // and back to /loop without ?loopId auto-restores THIS loop.
      await prisma.loopActivePointer.upsert({
        where: { id: 1 },
        update: { loopId: effectiveLoopId },
        create: { id: 1, loopId: effectiveLoopId },
      }).catch((err) => {
        // Non-fatal: the active pointer is a soft signal used only
        // for auto-restore. A failure here must not break loop start.
        log.warn({ err, loopId: effectiveLoopId }, "loop.api.active.upsert.failed");
      });

      // Register the initial SearchRun as LoopIteration #1 if provided.
      // This is called by Combination.handleSubmit() after startSearch() has
      // created the initial full-search SearchRun.
      //
      // Phase 3.2: the runner's registerIteration is the single
      // idempotent path for persisting any iteration, including #1. It
      // counts `candidateCount` from the actual DB rows and re-computes
      // `evaluatedCount` from existing experiments (handles the "search
      // already evaluated before loop registered" race).
      if (
        parsed.data.initialSearchRunId &&
        parsed.data.parentStrategyVersionId &&
        deps.runner
      ) {
        const initialCandidatesCount = await prisma.candidateStrategy.count({
          where: { searchRunId: parsed.data.initialSearchRunId },
        }).catch(() => 0);
        const effectiveCandidateCount =
          initialCandidatesCount > 0
            ? initialCandidatesCount
            : (parsed.data.candidateCountPerIteration ?? 5);

        await deps.runner.registerIteration({
          loopId: effectiveLoopId,
          iterationIndex: 1,
          parentStrategyVersionId: parsed.data.parentStrategyVersionId,
          searchRunId: parsed.data.initialSearchRunId,
          candidateCount: effectiveCandidateCount,
          isInitial: true,
        });
      }

      const state = await deps.runner?.getRuntimeState(effectiveLoopId);
      res.json({ success: true as const, data: state ?? { status: "RUNNING", loopId: effectiveLoopId } });
    } catch (err) {
      log.error({ err }, "loop.api.start.error");
      next(err);
    }
  });

  // ── POST /api/loop/pause ──────────────────────────────────────────────────
  router.post("/pause", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = IdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "INVALID_BODY" });
      return;
    }
    try {
      await deps.orchestrator.pauseLoop(parsed.data.loopId);
      const state = await deps.runner?.getRuntimeState(parsed.data.loopId);
      res.json({ success: true as const, data: state });
    } catch (err) {
      log.error({ err }, "loop.api.pause.error");
      next(err);
    }
  });

  // ── POST /api/loop/resume ─────────────────────────────────────────────────
  router.post("/resume", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = IdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "INVALID_BODY" });
      return;
    }
    try {
      // Re-use startLoop semantics: status -> RUNNING. This preserves the
      // existing iteration counter and bestScoreSoFar (loop-orchestrator
      // service does an upsert that keeps counters).
      await deps.orchestrator.startLoop({ loopId: parsed.data.loopId });
      const state = await deps.runner?.getRuntimeState(parsed.data.loopId);
      res.json({ success: true as const, data: state });
    } catch (err) {
      log.error({ err }, "loop.api.resume.error");
      next(err);
    }
  });

  // ── POST /api/loop/stop ───────────────────────────────────────────────────
  router.post("/stop", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = IdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "INVALID_BODY" });
      return;
    }
    try {
      await deps.orchestrator.stopLoop(parsed.data.loopId);
      const state = await deps.runner?.getRuntimeState(parsed.data.loopId);
      res.json({ success: true as const, data: state });
    } catch (err) {
      log.error({ err }, "loop.api.stop.error");
      next(err);
    }
  });

  // ── GET /api/loop/status?loopId=… ─────────────────────────────────────────
  router.get("/status", async (req: Request, res: Response, next: NextFunction) => {
    const loopId = (req.query["loopId"] as string | undefined) ?? undefined;
    if (!loopId) {
      res.status(400).json({ success: false, error: "MISSING_LOOP_ID" });
      return;
    }
    try {
      const state =
        (await deps.runner?.getRuntimeState(loopId)) ??
        (await deps.orchestrator.getLoopState(loopId));
      if (!state) {
        res.status(404).json({ success: false, error: "NOT_FOUND" });
        return;
      }
      res.json({ success: true as const, data: state });
    } catch (err) {
      log.error({ err, loopId }, "loop.api.status.error");
      next(err);
    }
  });

  // ── GET /api/loop/progress?loopId=… ──────────────────────────────────────
  router.get("/progress", async (req: Request, res: Response, next: NextFunction) => {
    const loopId = (req.query["loopId"] as string | undefined) ?? undefined;
    if (!loopId) {
      res.status(400).json({ success: false, error: "MISSING_LOOP_ID" });
      return;
    }
    try {
      const state = await deps.runner?.getRuntimeState(loopId);
      if (!state) {
        res.status(404).json({ success: false, error: "NOT_FOUND" });
        return;
      }
      const lastIter = await prisma.loopIteration.findFirst({
        where: { loopId },
        orderBy: { iterationIndex: "desc" },
      });
      res.json({
        success: true as const,
        data: {
          ...state,
          lastIterationParentStrategyVersionId:
            lastIter?.parentStrategyVersionId ?? null,
        },
      });
    } catch (err) {
      log.error({ err, loopId }, "loop.api.progress.error");
      next(err);
    }
  });

  // ── GET /api/loop/candidates?loopId=… ──────────────────────────────────
  // Returns candidates for the loop grouped by iteration.
  //
  // Phase 3.3: per-candidate authoritative metrics.
  //
  // The Candidate History MUST show consistent metrics per candidate.
  // A candidate can have multiple Experiment rows (and thus multiple
  // BacktestResult rows) created by retries, duplicate StrategyEvaluated
  // events, or other races. Picking the row with the maximum
  // `overallScore` is wrong: a stale retry can inflate the score and
  // later be replaced by the correct final result, producing the
  // observed "46.04 → 8.79" transient flicker in the UI.
  //
  // Authoritative selection: the candidate's experiment whose
  // `LoopProcessedEvent.evaluatedAt` is the LATEST for this loop is the
  // one the orchestrator treated as final. We resolve the BacktestResult
  // from that exact experimentId, so score/return/winRate/maxDrawdown
  // always come from the SAME row.
  router.get("/candidates", async (req: Request, res: Response, next: NextFunction) => {
    const loopId = (req.query["loopId"] as string | undefined) ?? undefined;
    if (!loopId) {
      res.status(400).json({ success: false, error: "MISSING_LOOP_ID" });
      return;
    }
    try {
      const iterations = await prisma.loopIteration.findMany({
        where: { loopId },
        orderBy: { iterationIndex: "asc" },
      });

      // Pre-fetch the latest LoopProcessedEvent rows for this loop.
      // `dedupeKey = "${loopId}:${experimentId}"` → we can derive the
      // experimentId per candidate. There is at most one row per
      // (loopId, experimentId) so this is the deduped stream of
      // evaluations the orchestrator acknowledged.
      const processedEvents = await prisma.loopProcessedEvent.findMany({
        where: { loopId },
        orderBy: { evaluatedAt: "desc" },
        select: {
          dedupeKey: true,
          evaluatedAt: true,
          strategyVersionId: true,
        },
      });
      // Map: candidateId → { experimentId, evaluatedAt, strategyVersionId }
      // StrategyEvaluated's payload includes the candidateId; we store
      // it implicitly via the experimentId lookup below. The orchestrator
      // does not write candidateId into LoopProcessedEvent, so we resolve
      // it through the experiment row when reading.
      const latestProcessedByExperiment = new Map<
        string,
        { evaluatedAt: Date; strategyVersionId: string }
      >();
      for (const ev of processedEvents) {
        const idx = ev.dedupeKey.indexOf(":");
        const experimentId = idx >= 0 ? ev.dedupeKey.slice(idx + 1) : null;
        if (!experimentId) continue;
        if (!latestProcessedByExperiment.has(experimentId)) {
          latestProcessedByExperiment.set(experimentId, {
            evaluatedAt: ev.evaluatedAt,
            strategyVersionId: ev.strategyVersionId,
          });
        }
      }

      const iterationsWithCandidates = await Promise.all(
        iterations.map(async (iter) => {
          const base = {
            iterationIndex: iter.iterationIndex,
            status: iter.status,
            parentStrategyVersionId: iter.parentStrategyVersionId,
            searchRunId: iter.searchRunId,
            candidateCount: iter.candidateCount,
            evaluatedCount: iter.evaluatedCount,
            bestScoreInIteration: Number(iter.bestScoreInIteration),
            bestStrategyVersionId: iter.bestStrategyVersionId,
            completedAt: iter.completedAt?.toISOString() ?? null,
          };
          if (!iter.searchRunId) {
            return { ...base, candidates: [] };
          }
          const candidates = await prisma.candidateStrategy.findMany({
            where: { searchRunId: iter.searchRunId },
            orderBy: { createdAt: "asc" },
            include: {
              strategyVersion: {
                select: {
                  name: true,
                  implementationRef: true,
                  definition: { select: { type: true } },
                },
              },
            },
          });

          // For each candidate, fetch ALL its experiments, pick the one
          // the orchestrator processed latest (by `evaluatedAt`), and
          // join to that experiment's BacktestResult. Score/return/etc.
          // always come from the same row.
          const withMetrics = await Promise.all(
            candidates.map(async (c) => {
              const experiments = await prisma.experiment.findMany({
                where: { candidateId: c.id },
                select: { id: true },
              });
              if (experiments.length === 0) {
                return {
                  id: c.id,
                  strategyName: c.strategyVersion.name,
                  strategyType: c.strategyVersion.definition.type,
                  overallScore: null,
                  totalReturn: null,
                  winRate: null,
                  maxDrawdown: null,
                };
              }

              let authoritativeExperimentId: string | null = null;
              let authoritativeEvaluatedAt: Date | null = null;
              for (const exp of experiments) {
                const ev = latestProcessedByExperiment.get(exp.id);
                if (!ev) continue;
                if (
                  authoritativeEvaluatedAt === null ||
                  ev.evaluatedAt > authoritativeEvaluatedAt
                ) {
                  authoritativeExperimentId = exp.id;
                  authoritativeEvaluatedAt = ev.evaluatedAt;
                }
              }
              if (!authoritativeExperimentId) {
                // No StrategyEvaluated event was ever processed for this
                // candidate (e.g. still running or pre-evaluation). Pick
                // the experiment the orchestrator would have processed
                // next — the most recently CREATED one. This gives a
                // meaningful "current" snapshot without picking a stale
                // inflated result from an abandoned earlier run.
                const fallback = experiments
                  .slice()
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .pop();
                authoritativeExperimentId = fallback?.id ?? null;
              }
              if (!authoritativeExperimentId) {
                return {
                  id: c.id,
                  strategyName: c.strategyVersion.name,
                  strategyType: c.strategyVersion.definition.type,
                  overallScore: null,
                  totalReturn: null,
                  winRate: null,
                  maxDrawdown: null,
                };
              }
              const result = await prisma.backtestResult.findFirst({
                where: { experimentId: authoritativeExperimentId },
              });
              return {
                id: c.id,
                strategyName: c.strategyVersion.name,
                strategyType: c.strategyVersion.definition.type,
                overallScore: result ? Number(result.overallScore) : null,
                totalReturn: result ? Number(result.totalReturn) : null,
                winRate: result ? Number(result.winRate) : null,
                maxDrawdown: result ? Number(result.maxDrawdown) : null,
              };
            }),
          );
          return { ...base, candidates: withMetrics };
        }),
      );

      res.json({ success: true as const, data: iterationsWithCandidates });
    } catch (err) {
      log.error({ err, loopId }, "loop.api.candidates.error");
      next(err);
    }
  });

  // ── GET /api/loop/list ────────────────────────────────────────────────────
  // Phase 3.3: list endpoint supports two query params:
  //   - `today=true` (UTC): filter loops created today (00:00 UTC).
  //   - `limit=N` (default 50): cap results.
  // Without params, behaves exactly as before (most recent 50, all-time).
  // Empty `today` filter when no rows → returns []. The endpoint is the
  // single source of truth for the frontend's "Today's Loop History" UI
  // and the active-loop discovery.
  router.get("/list", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const todayOnly = String(req.query["today"] ?? "").toLowerCase() === "true";
      const limit = Math.max(
        1,
        Math.min(200, Number(req.query["limit"] ?? 50) || 50),
      );

      let startOfDay: Date | null = null;
      if (todayOnly) {
        // UTC midnight boundary for "today". Documented so frontend
        // doesn't silently mix local-time filtering with UTC display.
        const now = new Date();
        startOfDay = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
        );
      }

      const rows = await prisma.loopRunState.findMany({
        where: startOfDay ? { startedAt: { gte: startOfDay } } : undefined,
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          // Include iteration aggregates for the "total candidates /
          // evaluated" fields in the history list.
          iterations: {
            select: { candidateCount: true, evaluatedCount: true },
          },
        },
      });
      const data = rows.map((r) => {
        const candidateCount = r.iterations.reduce(
          (acc, it) => acc + it.candidateCount,
          0,
        );
        const evaluatedCount = r.iterations.reduce(
          (acc, it) => acc + it.evaluatedCount,
          0,
        );
        return {
          id: r.id,
          loopId: r.loopId,
          status: r.status,
          maxCandidates: r.maxCandidates,
          timeLimitSeconds: r.timeLimitSeconds,
          noImprovementCap: r.noImprovementCap,
          totalEvaluated: r.totalEvaluated,
          noImprovementCount: r.noImprovementCount,
          bestScoreSoFar: r.bestScoreSoFar.toString(),
          currentIteration: r.currentIteration,
          lastIterationSearchRunId: r.lastIterationSearchRunId,
          startedAt: r.startedAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          stopReason: r.stopReason,
          candidateCount,
          evaluatedCount,
        };
      });
      res.json({ success: true as const, data });
    } catch (err) {
      log.error({ err }, "loop.api.list.error");
      next(err);
    }
  });

  // ── POST /api/loop/active ──────────────────────────────────────────────
  // Phase 3.3: explicitly set the user's active/followed loop. Called
  // by the frontend whenever it lands on `/loop?loopId=X` so a refresh
  // or back-navigation lands the user back on the same loop.
  router.post("/active", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = z
      .object({ loopId: z.string().min(1).max(64) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "INVALID_BODY" });
      return;
    }
    try {
      // Verify the loop exists in the DB before pointing at it, so we
      // never persist a dangling reference.
      const loop = await prisma.loopRunState.findUnique({
        where: { loopId: parsed.data.loopId },
        select: { loopId: true },
      });
      if (!loop) {
        res.status(404).json({ success: false, error: "NOT_FOUND" });
        return;
      }
      await prisma.loopActivePointer.upsert({
        where: { id: 1 },
        update: { loopId: parsed.data.loopId },
        create: { id: 1, loopId: parsed.data.loopId },
      });
      res.json({ success: true as const, data: { loopId: parsed.data.loopId } });
    } catch (err) {
      log.error({ err, loopId: parsed.data.loopId }, "loop.api.active.set.error");
      next(err);
    }
  });

  // ── DELETE /api/loop/active ─────────────────────────────────────────────
  // Phase 3.3: clear the active pointer. The frontend calls this when
  // the loop has stopped and the user navigates away (so the next
  // auto-restore doesn't pick a stale STOPPED loop).
  router.delete("/active", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.loopActivePointer.deleteMany({ where: { id: 1 } });
      res.json({ success: true as const, data: { cleared: true } });
    } catch (err) {
      log.error({ err }, "loop.api.active.clear.error");
      next(err);
    }
  });
  // Phase 3.3: returns the user's currently active RUNNING or PAUSED
  // loop, if any. Used by the frontend Loop page to auto-restore the
  // followed loop after navigation. Precedence:
  //   1. Explicit LoopActivePointer (set on startLoop). If the pointer
  //      points to a still-existing loop that is RUNNING/PAUSED, that
  //      wins.
  //   2. Most recently-updated RUNNING/PAUSED loopRunState.
  //   3. null → the frontend shows the "No Loop Selected" / history state.
  router.get("/active", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pointer = await prisma.loopActivePointer.findUnique({
        where: { id: 1 },
      });
      if (pointer) {
        const row = await prisma.loopRunState.findUnique({
          where: { loopId: pointer.loopId },
        });
        if (row && (row.status === "RUNNING" || row.status === "PAUSED")) {
          res.json({
            success: true as const,
            data: {
              loopId: row.loopId,
              status: row.status,
              currentIteration: row.currentIteration,
              startedAt: row.startedAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
              source: "pointer",
            },
          });
          return;
        }
      }
      const row = await prisma.loopRunState.findFirst({
        where: { status: { in: ["RUNNING", "PAUSED"] } },
        orderBy: { updatedAt: "desc" },
      });
      if (!row) {
        res.json({ success: true as const, data: null });
        return;
      }
      res.json({
        success: true as const,
        data: {
          loopId: row.loopId,
          status: row.status,
          currentIteration: row.currentIteration,
          startedAt: row.startedAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          source: "most-recent-running",
        },
      });
    } catch (err) {
      log.error({ err }, "loop.api.active.error");
      next(err);
    }
  });

  return router;
}
