/**
 * search · presentation · search.routes
 *
 * REST surface for the Search module.
 *
 *   GET    /api/search/algorithms  – List available SearchAlgorithms (id, code, name)
 *   GET    /api/search/symbols     – List available Symbols (id, code, baseAsset, quoteAsset)
 *   POST   /api/search/start       – Create and immediately start a SearchRun
 *   GET    /api/search/:id         – Get SearchRun details + candidate summary
 *
 * Routes validate input with `zod` and translate errors into HTTP responses.
 *
 * This module intentionally does NOT expose:
 *   - CandidateStrategy rows (those are owned by the Backtest module)
 *   - Internal generator configuration
 *   - Strategy registry details
 *
 * NOTE: GET /algorithms and GET /symbols are intentionally colocated here
 * rather than on the market-data module. They are required inputs to
 * POST /api/search/start, so keeping them under the same router gives
 * the frontend a single, cohesive API surface and avoids expanding
 * the DI composition just for two read-only listings. These endpoints
 * are pure read-only Prisma queries against the same Symbol and
 * SearchAlgorithm models that already power the rest of the app.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { SearchService } from "../application/SearchService";
import type { Logger } from "../../../shared/logger/logger";
import { logger as rootLogger } from "../../../shared/logger/logger";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getStrategyRegistry } from "../../strategy/domain/StrategyRegistry";

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
   * GET /api/search/algorithms
   *
   * Lists available SearchAlgorithm rows. Each entry exposes the `id`
   * (UUID) the frontend needs to populate `algorithmId` in the
   * POST /api/search/start request body.
   *
   * Response 200:
   *   {
   *     "success": true,
   *     "data": [
   *       { "id": "uuid", "code": "random", "name": "Random Search", "implementationRef": "strategy.generator.random" },
   *       { "id": "uuid", "code": "domain_guided", "name": "Domain-guided Search", "implementationRef": "strategy.generator.domain_guided" }
   *     ]
   *   }
   */
  router.get("/algorithms", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const prisma = getPrismaClient();
      const rows = await prisma.searchAlgorithm.findMany({
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          implementationRef: true,
        },
      });
      res.json({ success: true as const, data: rows });
    } catch (err) {
      log.error({ err }, "search.api.algorithms.error");
      next(err);
    }
  });

  /**
   * GET /api/search/symbols
   *
   * Lists active Symbol rows. Each entry exposes the `id` (UUID) the
   * frontend needs to populate `symbolId` in the POST /api/search/start
   * request body.
   *
   * Response 200:
   *   {
   *     "success": true,
   *     "data": [
   *       { "id": "uuid", "symbol": "BTCUSDT", "baseAsset": "BTC", "quoteAsset": "USDT" }
   *     ]
   *   }
   */
  router.get("/symbols", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const prisma = getPrismaClient();
      const rows = await prisma.symbol.findMany({
        where: { isActive: true },
        orderBy: { symbol: "asc" },
        select: {
          id: true,
          symbol: true,
          baseAsset: true,
          quoteAsset: true,
        },
      });
      res.json({ success: true as const, data: rows });
    } catch (err) {
      log.error({ err }, "search.api.symbols.error");
      next(err);
    }
  });

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
   * GET /api/search
   *
   * Lists recent SearchRuns, most recent first. Used by the Discovery
   * dashboard to show prior runs and let users navigate back to them.
   *
   * Query parameters:
   *   - status:   optional SearchStatus filter ("PENDING"|"RUNNING"|...)
   *   - limit:    integer 1..200, default 50
   *   - cursor:   SearchRun id — when supplied, results start after this row.
   *
   * Response 200:
   *   { "success": true, "data": [{...}, ...] }
   */
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitRaw = req.query["limit"];
      const cursor = req.query["cursor"];
      const status = req.query["status"];

      const limit = (() => {
        if (typeof limitRaw !== "string") return undefined;
        const n = Number.parseInt(limitRaw, 10);
        if (!Number.isFinite(n)) return undefined;
        return Math.min(Math.max(n, 1), 200);
      })();

      const allowedStatuses = new Set(["PENDING", "RUNNING", "DONE", "STOPPED", "FAILED"]);
      const statusFilter =
        typeof status === "string" && allowedStatuses.has(status)
          ? (status as "PENDING" | "RUNNING" | "DONE" | "STOPPED" | "FAILED")
          : undefined;

      const runs = await deps.service.listSearchRuns({
        ...(limit !== undefined ? { limit } : {}),
        ...(typeof cursor === "string" && cursor.length > 0 ? { cursor } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });

      const summaries = await Promise.all(
        runs.map(async (r) => {
          const [algorithm, symbol, candidateCount, strategies] = await Promise.all([
            deps.service.getAlgorithmSummary(r.algorithmId),
            deps.service.getSymbolSummary(r.symbolId),
            deps.service.countCandidatesByRun(r.id),
            getStrategiesForRun(r.config),
          ]);
          return {
            id: r.id,
            status: r.status,
            timeframe: r.timeframe,
            maxCandidates: r.maxCandidates,
            algorithm,
            symbol,
            candidateCount,
            strategies,
            startedAt: r.startedAt?.toISOString() ?? null,
            finishedAt: r.finishedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          };
        }),
      );

      res.json({ success: true as const, data: summaries });
    } catch (err) {
      log.error({ err }, "search.api.list.error");
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

  /**
   * GET /api/search/:id/candidates
   *
   * Returns all CandidateStrategy rows persisted for the given SearchRun,
   * enriched with the linked StrategyVersion + StrategyDefinition data
   * so the frontend can show "what strategy this candidate represents".
   *
   * Response 200:
   *   {
   *     "success": true,
   *     "data": [
   *       {
   *         "id": "uuid",
   *         "searchRunId": "uuid",
   *         "strategyVersionId": "uuid",
   *         "parameters": { ... },
   *         "status": "PENDING",
   *         "errorMessage": null,
   *         "createdAt": "...",
   *         "strategyVersion": {
   *           "id": "uuid",
   *           "name": "Relative Strength Index (Wilder)",
   *           "implementationRef": "strategy.rsi",
   *           "definition": { "type": "BASE", "family": "TREND" }
   *         }
   *       }
   *     ]
   *   }
   *
   * Response 404: SearchRun not found
   */
  router.get("/:id/candidates", async (req: Request, res: Response, next: NextFunction) => {
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
      const prisma = getPrismaClient();

      // Verify the SearchRun exists (return 404 if not).
      const searchRun = await prisma.searchRun.findUnique({
        where: { id: parsed.data.id },
        select: { id: true },
      });
      if (!searchRun) {
        res.status(404).json({ success: false, error: "NOT_FOUND" });
        return;
      }

      const rows = await prisma.candidateStrategy.findMany({
        where: { searchRunId: parsed.data.id },
        orderBy: { createdAt: "asc" },
        include: {
          strategyVersion: {
            select: {
              id: true,
              name: true,
              implementationRef: true,
              definition: { select: { type: true, family: true } },
            },
          },
        },
      });

      res.json({
        success: true,
        data: rows.map((r) => ({
          id: r.id,
          searchRunId: r.searchRunId,
          strategyVersionId: r.strategyVersionId,
          parameters: r.parameters as Record<string, unknown>,
          status: r.status,
          errorMessage: r.errorMessage,
          createdAt: r.createdAt.toISOString(),
          strategyVersion: r.strategyVersion
            ? {
                id: r.strategyVersion.id,
                name: r.strategyVersion.name,
                implementationRef: r.strategyVersion.implementationRef,
                definitionType: r.strategyVersion.definition.type,
                definitionFamily: r.strategyVersion.definition.family,
              }
            : null,
        })),
      });
    } catch (err) {
      log.error({ err, id: parsed.data.id }, "search.api.candidates.error");
      next(err);
    }
  });

  return router;
}

/**
 * One component of a saved combination — name, family, and position
 * within the combination (0 = first, 1 = second, …).
 */
export interface CombinationStrategySummary {
  readonly name: string;
  readonly family: string;
  readonly position: number;
}

/**
 * Resolve the strategies referenced by a SearchRun's saved combination.
 *
 * 1. Reads `config.combinationId` from the SearchRun JSON `config` field.
 * 2. Loads the matching `saved_combinations` row.
 * 3. For each component, looks up the latest active `StrategyVersion` whose
 *    `implementationRef` matches the component's `strategyId`, and joins
 *    `StrategyDefinition` to retrieve the family.
 *
 * Returns an empty array if the run has no combination, the combination
 * has no components, or any lookup fails — Discovery UI must never
 * break because of a missing combination reference.
 */
async function getStrategiesForRun(
  config: unknown,
): Promise<CombinationStrategySummary[]> {
  if (!config || typeof config !== "object") return [];
  const combinationId = (config as { combinationId?: unknown }).combinationId;
  if (typeof combinationId !== "string" || combinationId.length === 0) {
    return [];
  }

  try {
    const prisma = getPrismaClient();
    const combo = await prisma.savedCombination.findUnique({
      where: { id: combinationId },
    });
    if (!combo) return [];

    const rawComponents = Array.isArray(combo.components)
      ? (combo.components as Array<{
          strategyId?: unknown;
          position?: unknown;
        }>)
      : [];
    if (rawComponents.length === 0) return [];

    // Deduplicate strategyIds — fetch versions in one query
    const strategyIds = [
      ...new Set(
        rawComponents
          .map((c) =>
            typeof c.strategyId === "string" && c.strategyId.length > 0
              ? c.strategyId
              : null,
          )
          .filter((s): s is string => s !== null),
      ),
    ];

    if (strategyIds.length === 0) return [];

    // ── Canonical family lookup: prefer the in-process StrategyRegistry
    //    because it is the source of truth for taxonomy. Fall back to the
    //    DB only if the strategy isn't registered (e.g. legacy / external
    //    strategies whose taxonomy may also be stale).
    const registry = getStrategyRegistry();
    const registryFamilyByRef = new Map<string, string>();
    for (const id of strategyIds) {
      const strat = registry.resolve(id);
      if (strat?.family) {
        registryFamilyByRef.set(id, String(strat.family));
      }
    }

    const versions = await prisma.strategyVersion.findMany({
      where: {
        implementationRef: { in: strategyIds },
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
      include: { definition: { select: { family: true } } },
    });

    // Pick the most recent active version per implementationRef
    const latestByRef = new Map<
      string,
      { name: string; family: string }
    >();
    for (const v of versions) {
      if (!latestByRef.has(v.implementationRef)) {
        // Prefer the registry's family; fall back to DB family, then
        // "unknown" only if neither source has it.
        const family =
          registryFamilyByRef.get(v.implementationRef) ??
          (v.definition?.family ? String(v.definition.family) : "unknown");
        latestByRef.set(v.implementationRef, {
          name: v.name,
          family,
        });
      }
    }

    // Preserve the position order from the components array
    const result: CombinationStrategySummary[] = [];
    for (const c of rawComponents) {
      if (typeof c.strategyId !== "string") continue;
      const meta = latestByRef.get(c.strategyId);
      if (!meta) continue;
      const position =
        typeof c.position === "number" && Number.isFinite(c.position)
          ? c.position
          : result.length;
      result.push({
        name: meta.name,
        family: meta.family,
        position,
      });
    }
    return result;
  } catch {
    // Non-fatal: return empty list so Discovery UI never breaks
    return [];
  }
}
