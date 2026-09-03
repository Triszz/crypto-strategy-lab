/**
 * leaderboard · presentation · loop.routes
 *
 * REST endpoints for the Continuous Strategy Loop:
 *
 *   POST   /api/loop/start        — start (or restart) a loop
 *   POST   /api/loop/pause       — pause a RUNNING loop
 *   POST   /api/loop/resume      — resume a PAUSED loop
 *   POST   /api/loop/stop        — stop a loop
 *   GET    /api/loop/status      — current loop state (or 404 if no loop)
 *   GET    /api/loop/progress    — current iteration + best + elapsed
 *   GET    /api/loop/list        — list all loops
 *
 * The router delegates to `LoopOrchestratorService` (state + stop
 * conditions) and `LoopOrchestratorRunner` (iteration progress) when
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
  timeLimitSeconds: z.number().int().positive().max(86_400).optional(),
  noImprovementCap: z.number().int().positive().max(10_000).optional(),
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
      await deps.orchestrator.startLoop({
        loopId: parsed.data.loopId ?? `loop-${Date.now()}`,
        maxCandidates: parsed.data.maxCandidates,
        timeLimitSeconds: parsed.data.timeLimitSeconds,
        noImprovementCap: parsed.data.noImprovementCap,
      });
      const state = await deps.runner?.getRuntimeState(
        parsed.data.loopId ?? `loop-${Date.now()}`,
      );
      res.json({ success: true as const, data: state ?? { status: "RUNNING" } });
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
      // Augment with best leaderboard row (top-1) for UI.
      const best = await prisma.leaderboardEntry.findFirst({
        where: {
          // We don't have symbolId directly here — fetch from any
          // iteration we tracked.
        },
        orderBy: { overallScore: "desc" },
      });
      const lastIter = await prisma.loopIteration.findFirst({
        where: { loopId },
        orderBy: { iterationIndex: "desc" },
        include: {
          // No direct relation; surface raw fields only.
        },
      });
      res.json({
        success: true as const,
        data: {
          ...state,
          leaderboardTopScore: best ? Number(best.overallScore) : null,
          lastIterationParentStrategyVersionId:
            lastIter?.parentStrategyVersionId ?? null,
        },
      });
    } catch (err) {
      log.error({ err, loopId }, "loop.api.progress.error");
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
