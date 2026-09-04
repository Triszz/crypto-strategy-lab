/**
 * strategy · presentation · strategy.routes
 *
 * REST API endpoints for the Strategy catalogue and the Strategy
 * Engine.
 *
 * Catalogue (system-registered):
 *  GET    /api/strategies           — list all registered strategies
 *  GET    /api/strategies/:id       — get a single strategy detail
 *
 * Strategy Engine (user-created / imported):
 *  POST   /api/strategies/prompt    — generate from natural-language prompt (LLM)
 *  POST   /api/strategies/import-url — import from a public URL
 *  POST   /api/strategies/validate  — validate a strategy JSON
 *  POST   /api/strategies/saved     — persist a validated strategy
 *  GET    /api/strategies/saved     — list recent saved strategies
 *  GET    /api/strategies/saved/:id — get one saved strategy
 *
 * Authentication: public (no auth middleware exists in this project yet).
 * Error convention: follows the project's ApiResponse shape from api.ts.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { StrategyService } from "./StrategyService";
import {
  StrategyEngineService,
} from "../application/StrategyEngineService";
import { PrismaSavedStrategyRepository } from "../application/PrismaSavedStrategyRepository";
import { buildDefaultStrategyLlmAdapter } from "../infrastructure/GeminiStrategyAdapter";
import { WebStrategyExtractor } from "../infrastructure/WebStrategyExtractor";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { Logger } from "../../../shared/logger/logger";
import { logger as rootLogger } from "../../../shared/logger/logger";

const PromptBodySchema = z.object({
  prompt: z.string().min(10, "prompt must be at least 10 characters").max(10_000),
  source: z.enum(["USER_PROMPT", "WEB_IMPORT"]).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
});

const ImportUrlBodySchema = z.object({
  url: z.string().url("url must be a valid http(s) URL").max(2_000),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
});

const ValidateBodySchema = z.object({
  json: z.unknown(),
});

const SaveBodySchema = z.object({
  json: z.unknown(),
  ownerId: z.string().max(64).optional(),
});

export interface StrategyRouterDeps {
  /** Optional override for the engine service (tests / DI). */
  engineService?: StrategyEngineService;
  logger?: Logger;
}

export function buildStrategyRouter(deps: StrategyRouterDeps = {}): Router {
  const router = Router();
  const log = deps.logger ?? rootLogger;
  const catalogue = new StrategyService();

  const engine: StrategyEngineService =
    deps.engineService ??
    new StrategyEngineService(
      new PrismaSavedStrategyRepository(getPrismaClient()),
      buildDefaultStrategyLlmAdapter(),
      new WebStrategyExtractor(),
    );

  // ─── Catalogue ───────────────────────────────────────────────────────

  // GET /api/strategies
  router.get("/", (_req, res) => {
    const result = catalogue.list();
    res.json({ success: true as const, data: result });
  });

  // ─── Strategy Engine: Saved strategies ───────────────────────────────
  // NOTE: /saved MUST be registered before the catch-all /:id below so
  // Express matches the literal segment first.

  // GET /api/strategies/saved
  router.get("/saved", async (_req, res, next) => {
    try {
      const records = await engine.listSavedStrategies({ limit: 100 });
      res.json({
        success: true as const,
        data: {
          strategies: records.map(toSavedStrategyDto),
          total: records.length,
        },
      });
    } catch (err) {
      log.error({ err }, "strategy.saved.list.error");
      next(err);
    }
  });

  // GET /api/strategies/saved/:id
  router.get("/saved/:id", async (req, res, next) => {
    const id = req.params["id"];
    if (typeof id !== "string" || !isUuid(id)) {
      res.status(400).json({ success: false, error: "INVALID_ID" });
      return;
    }
    try {
      const record = await engine.getSavedStrategy(id);
      if (!record) {
        res.status(404).json({ success: false, error: "NOT_FOUND" });
        return;
      }
      res.json({ success: true as const, data: toSavedStrategyDto(record) });
    } catch (err) {
      log.error({ err, id }, "strategy.saved.get.error");
      next(err);
    }
  });

  // POST /api/strategies/saved
  router.post("/saved", async (req, res, next) => {
    const parsed = SaveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_BODY",
        details: parsed.error.issues,
      });
      return;
    }
    try {
      const result = await engine.saveStrategy({
        json: parsed.data.json as never,
        ownerId: parsed.data.ownerId ?? null,
      });
      if (!result.ok || !result.record) {
        res.status(400).json({
          success: false,
          error: result.error?.code ?? "INVALID",
          message: result.error?.message,
          validation: result.validation,
        });
        return;
      }
      res.status(201).json({
        success: true as const,
        data: toSavedStrategyDto(result.record),
      });
    } catch (err) {
      log.error({ err }, "strategy.saved.create.error");
      next(err);
    }
  });

  // ─── Strategy Engine: Generation & Validation ───────────────────────

  // POST /api/strategies/prompt
  router.post("/prompt", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = PromptBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_BODY",
        details: parsed.error.issues,
      });
      return;
    }
    try {
      const result = await engine.generateFromPrompt({
        prompt: parsed.data.prompt,
        source: parsed.data.source,
        tags: parsed.data.tags,
      });
      if (!result.ok || !result.json) {
        const status = result.error?.code === "NOT_CONFIGURED" ? 503 : 502;
        res.status(status).json({
          success: false,
          error: result.error?.code ?? "GENERATION_FAILED",
          message: result.error?.message,
          validation: result.validation,
        });
        return;
      }
      res.json({ success: true as const, data: result.json });
    } catch (err) {
      log.error({ err }, "strategy.prompt.error");
      next(err);
    }
  });

  // POST /api/strategies/import-url
  router.post(
    "/import-url",
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = ImportUrlBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "INVALID_BODY",
          details: parsed.error.issues,
        });
        return;
      }
      try {
        const result = await engine.importFromUrl({
          url: parsed.data.url,
          tags: parsed.data.tags,
        });
        if (!result.ok || !result.json) {
          const status =
            result.error?.code === "NOT_CONFIGURED"
              ? 503
              : result.error?.code === "INVALID_URL" ||
                  result.error?.code === "UNSUPPORTED_PROTOCOL"
                ? 400
                : 502;
          res.status(status).json({
            success: false,
            error: result.error?.code ?? "IMPORT_FAILED",
            message: result.error?.message,
          });
          return;
        }
        res.json({ success: true as const, data: result.json });
      } catch (err) {
        log.error({ err }, "strategy.import-url.error");
        next(err);
      }
    },
  );

  // POST /api/strategies/validate
  router.post("/validate", (req: Request, res: Response) => {
    const parsed = ValidateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_BODY",
        details: parsed.error.issues,
      });
      return;
    }
    const result = engine.validateJson(parsed.data.json);
    res.json({ success: true as const, data: result });
  });

  // ─── Catalogue: Single strategy ──────────────────────────────────────

  // GET /api/strategies/:id — MUST come AFTER all literal routes above.
  router.get("/:id", (req, res) => {
    const id = req.params["id"];
    const strategy = catalogue.get(id);
    if (!strategy) {
      res.status(404).json({
        success: false as const,
        error: `Strategy "${id}" not found.`,
      });
      return;
    }
    res.json({ success: true as const, data: { strategy } });
  });

  // ─── Saved Combinations ──────────────────────────────────────────────────────

  /**
   * POST /api/strategies/combinations
   *
   * Persist a user-created strategy combination to the saved_combinations table.
   * The combination can then be used as the basis for a Domain-guided or
   * Random Search run (via POST /api/search/start with the returned id in
   * generatorConfig.combinationId, or simply by the user reviewing saved combos).
   *
   * Body:
   *   name:        string  (required)
   *   description: string  (optional)
   *   operator:    "MAJORITY_VOTE" | "WEIGHTED"  (default WEIGHTED)
   *   components:  Array<{ strategyId: string, weight: number, position: number }>
   *   tags:        string[] (optional)
   *   ownerId:     string   (optional)
   *
   * Response 201: { success: true, data: SavedCombinationDto }
   * Response 400: { success: false, error: string }
   */
  const SaveCombinationSchema = z.object({
    name: z.string().min(1, "name is required").max(255),
    description: z.string().max(1000).optional(),
    operator: z
      .enum(["MAJORITY_VOTE", "WEIGHTED"])
      .optional()
      .default("WEIGHTED"),
    components: z
      .array(
        z.object({
          strategyId: z.string().min(1),
          weight: z.number().min(0).max(1),
          position: z.number().int().min(0),
        }),
      )
      .min(1, "at least one component is required"),
    tags: z.array(z.string().min(1).max(64)).max(50).optional().default([]),
    ownerId: z.string().max(64).optional(),
  });

  router.post("/combinations", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = SaveCombinationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_BODY",
        details: parsed.error.issues,
      });
      return;
    }
    try {
      const prisma = getPrismaClient();
      const record = await prisma.savedCombination.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description,
          operator: parsed.data.operator as never,
          components: parsed.data.components as never,
          tags: parsed.data.tags,
          ownerId: parsed.data.ownerId,
        },
      });
      res.status(201).json({
        success: true as const,
        data: toCombinationDto(record),
      });
    } catch (err) {
      log.error({ err }, "strategy.combination.create.error");
      next(err);
    }
  });

  /**
   * GET /api/strategies/combinations
   *
   * Lists all saved combinations, most recent first.
   *
   * Query: ?limit=20&cursor=<id>
   *
   * Response 200: { success: true, data: SavedCombinationDto[] }
   */
  router.get("/combinations", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limitRaw = req.query["limit"];
      const cursor = req.query["cursor"];
      const limit = (() => {
        if (typeof limitRaw !== "string") return 50;
        const n = Number.parseInt(limitRaw, 10);
        return Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 50;
      })();

      const prisma = getPrismaClient();
      const rows = await prisma.savedCombination.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        ...(typeof cursor === "string" && cursor.length > 0
          ? { cursor: { id: cursor }, skip: 1 }
          : {}),
      });
      res.json({
        success: true as const,
        data: rows.map(toCombinationDto),
      });
    } catch (err) {
      log.error({ err }, "strategy.combination.list.error");
      next(err);
    }
  });

  return router;
}

// ─── Helpers ────────────────────────────────────────────────────────────

interface SavedStrategyDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly jsonDef: Readonly<Record<string, unknown>>;
  readonly source: "USER_PROMPT" | "WEB_IMPORT";
  readonly tags: ReadonlyArray<string>;
  readonly ownerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toSavedStrategyDto(r: {
  id: string;
  name: string;
  version: string;
  description: string | null;
  jsonDef: Readonly<Record<string, unknown>>;
  source: "USER_PROMPT" | "WEB_IMPORT";
  tags: ReadonlyArray<string>;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SavedStrategyDto {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    description: r.description,
    jsonDef: r.jsonDef,
    source: r.source,
    tags: r.tags,
    ownerId: r.ownerId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── SavedCombination DTO ────────────────────────────────────────────────────

export interface CombinationComponentDto {
  readonly strategyId: string;
  readonly weight: number;
  readonly position: number;
}

export interface SavedCombinationDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly operator: "MAJORITY_VOTE" | "WEIGHTED";
  readonly components: ReadonlyArray<CombinationComponentDto>;
  readonly tags: ReadonlyArray<string>;
  readonly ownerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toCombinationDto(r: {
  id: string;
  name: string;
  description: string | null;
  operator: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: any;
  tags: ReadonlyArray<string>;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SavedCombinationDto {
  const allowedOperators = ["MAJORITY_VOTE", "WEIGHTED"] as const;
  type Operator = (typeof allowedOperators)[number];
  const operator: Operator = (allowedOperators as readonly string[]).includes(r.operator)
    ? (r.operator as Operator)
    : "WEIGHTED";

  return {
    id: r.id,
    name: r.name,
    description: r.description,
    operator,
    components: (Array.isArray(r.components) ? r.components : []) as ReadonlyArray<CombinationComponentDto>,
    tags: r.tags,
    ownerId: r.ownerId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
