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
          const withMetrics = await Promise.all(
            candidates.map(async (c) => {
              const result = await prisma.backtestResult.findFirst({
                where: { experiment: { candidateId: c.id } },
                orderBy: { overallScore: "desc" },
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
  router.get("/list", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await prisma.loopRunState.findMany({
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
      res.json({ success: true as const, data: rows });
    } catch (err) {
      log.error({ err }, "loop.api.list.error");
      next(err);
    }
  });

  return router;
}
