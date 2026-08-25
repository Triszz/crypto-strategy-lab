/**
 * search · presentation · search.routes
 *
 * REST surface for the Search module.
 *
 *   POST   /api/search/start   – Create and immediately start a SearchRun
 *   GET    /api/search/:id     – Get SearchRun details + candidate summary
 *
 * Routes validate input with `zod` and translate errors into HTTP responses.
 *
 * This module intentionally does NOT expose:
 *   - CandidateStrategy rows (those are owned by the Backtest module)
 *   - Internal generator configuration
 *   - Strategy registry details
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { SearchService } from "../application/SearchService";
import type { Logger } from "../../../shared/logger/logger";
import { logger as rootLogger } from "../../../shared/logger/logger";

const StartSearchSchema = z.object({
  algorithmId: z.string().uuid(),
  symbolId: z.string().uuid(),
  timeframe: z.string().min(1),
  maxCandidates: z.number().int().positive().max(10_000),
  fromTime: z.number().int().nonnegative().optional(),
  toTime: z.number().int().nonnegative().optional(),
  createdBy: z.string().max(64).optional(),
  generatorConfig: z.record(z.unknown()).optional(),
});

const SearchIdSchema = z.object({
  id: z.string().uuid(),
});

export interface SearchRouterDeps {
  /** Injected SearchService. Set during composition. */
  service: SearchService;
  /** Injected logger. */
  logger?: Logger;
}

/**
 * Builds the Search router. Mount at `/api/search`.
 *
 * @param deps  Must include a `service` instance.
 */
export function buildSearchRouter(deps: SearchRouterDeps): Router {
  const router = Router();
  const log = deps.logger ?? rootLogger;

  /**
   * POST /api/search/start
   *
   * Creates a SearchRun and immediately starts generation.
   *
   * Request body:
   *   {
   *     "algorithmId": "uuid",
   *     "symbolId": "uuid",
   *     "timeframe": "1h",
   *     "maxCandidates": 100,
   *     "fromTime": 1700000000000,
   *     "toTime": 1710000000000,
   *     "createdBy": "user-123",
   *     "generatorConfig": { "familyGroups": [...] }
   *   }
   *
   * Response 200:
   *   {
   *     "success": true,
   *     "data": {
   *       "searchRunId": "uuid",
   *       "algorithm": "random",
   *       "totalQueued": 100,
   *       "stopReason": "MAX_CANDIDATES"
   *     }
   *   }
   *
   * Response 400: Invalid input
   * Response 500: Unexpected error
   */
  router.post("/start", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = StartSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_BODY",
        details: parsed.error.issues,
      });
      return;
    }

    const body = parsed.data;

    // Determine algorithm from the SearchAlgorithm row (future: stored in DB; MVP: use a fixed map)
    // For MVP, we accept "algorithm" as a query param or default to "random"
    const algorithm = (req.query["algorithm"] as string | undefined) ?? "random";

    try {
      // Create the SearchRun
      const createResult = await deps.service.createSearchRun({
        algorithm,
        algorithmId: body.algorithmId,
        symbolId: body.symbolId,
        timeframe: body.timeframe,
        maxCandidates: body.maxCandidates,
        fromTime: body.fromTime ? BigInt(body.fromTime) : undefined,
        toTime: body.toTime ? BigInt(body.toTime) : undefined,
        createdBy: body.createdBy,
        generatorConfig: body.generatorConfig,
      });

      // Immediately start the run
      const startResult = await deps.service.start({
        searchRunId: createResult.searchRun.id,
        algorithm,
      });

      log.info(
        {
          searchRunId: createResult.searchRun.id,
          algorithm,
          totalQueued: startResult.generatorResult.totalQueued,
          reason: startResult.stopReason,
        },
        "search.api.start.complete",
      );

      res.status(200).json({
        success: true,
        data: {
          searchRunId: createResult.searchRun.id,
          algorithm,
          status: startResult.generatorResult.totalQueued >= body.maxCandidates ? "DONE" : "STOPPED",
          totalGenerated: startResult.generatorResult.totalGenerated,
          totalQueued: startResult.generatorResult.totalQueued,
          totalRejected: startResult.generatorResult.totalRejected,
          stopReason: startResult.stopReason,
          generationMs: startResult.generatorResult.generationMs,
        },
      });
    } catch (err) {
      log.error({ err, body }, "search.api.start.error");
      next(err);
    }
  });

  /**
   * GET /api/search/:id
   *
   * Returns a summary of a SearchRun including candidate counts.
   *
   * Response 200:
   *   {
   *     "success": true,
   *     "data": {
   *       "id": "uuid",
   *       "algorithmId": "uuid",
   *       "symbolId": "uuid",
   *       "timeframe": "1h",
   *       "maxCandidates": 100,
   *       "status": "DONE",
   *       "startedAt": "...",
   *       "finishedAt": "...",
   *       "candidateCount": 100
   *     }
   *   }
   *
   * Response 404: Not found
   */
  router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = SearchIdSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_PARAMS",
        details: parsed.error.issues,
      });
      return;
    }

    try {
      const searchRun = await deps.service.getSearchRun(parsed.data.id);
      if (!searchRun) {
        res.status(404).json({ success: false, error: "NOT_FOUND" });
        return;
      }
      res.json({
        success: true,
        data: {
          id: searchRun.id,
          algorithmId: searchRun.algorithmId,
          symbolId: searchRun.symbolId,
          timeframe: searchRun.timeframe,
          maxCandidates: searchRun.maxCandidates,
          status: searchRun.status,
          startedAt: searchRun.startedAt?.toISOString(),
          finishedAt: searchRun.finishedAt?.toISOString(),
          createdAt: searchRun.createdAt.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
