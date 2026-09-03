import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { Logger } from "../../../shared/logger/logger";
import type { BackfillService } from "../application/BackfillService";
import type { ChartConfig } from "../domain/ChartConfig";
import type { CandleRepository } from "../domain/CandleRepository.port";
import { isSupportedTimeframe, type Timeframe } from "../domain/Timeframe";
import { loadActiveChartConfigs } from "./chart-config-loader";
import { getPrismaClient } from "../../../infrastructure/database/prisma";

const QuerySchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().refine(isSupportedTimeframe, {
    message: "unsupported timeframe",
  }),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1_000).optional(),
});

const LoadMoreSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().refine(isSupportedTimeframe, {
    message: "unsupported timeframe",
  }),
  beforeMs: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().positive().max(1_000).optional(),
});

const UpdateChartConfigSchema = z.object({
  chartIndex: z.number().int().min(0).max(3),
  symbol: z.string().min(1),
  timeframe: z.string().refine(isSupportedTimeframe, {
    message: "unsupported timeframe",
  }),
});

const MAX_LIMIT = 1_000;
/** Auto-backfill from Binance when DB returns fewer than this many candles. */
const AUTO_BACKFILL_THRESHOLD = 10;

export interface MarketDataRouterDeps {
  repo: CandleRepository;
  backfill: BackfillService;
  logger: Logger;
  /** Provider for the 4 default chart configs; injected for testability. */
  loadChartConfigs?: () => Promise<ChartConfig[]>;
}

/**
 * REST surface for the Market Data module.
 *
 *   GET    /api/candles                 – query DB; auto-backfill from Binance if empty
 *   POST   /api/candles/load-more       – extend history backwards (Binance → upsert → return)
 *   GET    /api/candles/chart-configs   – return the 4 default chart panes
 *
 * Routes validate input with `zod` and translate validation errors
 * into HTTP 400 with a stable shape `{ error: "...", details: [...] }`.
 */
export function buildMarketDataRouter(deps: MarketDataRouterDeps): Router {
  const router = Router();
  const logger = deps.logger;
  const loadCharts = deps.loadChartConfigs ?? loadActiveChartConfigs;

  router.get("/chart-configs", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const charts = await loadCharts();
      res.json({ success: true, data: charts });
    } catch (err) {
      next(err);
    }
  });

  router.put("/chart-configs", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = UpdateChartConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_BODY",
        details: parsed.error.issues,
      });
      return;
    }

    try {
      const { chartIndex, symbol, timeframe } = parsed.data;

      // Check if another chart already uses this timeframe
      const allCharts = await loadCharts();
      const conflict = allCharts.find(
        (c) => c.chartIndex !== chartIndex && c.timeframe === (timeframe as Timeframe),
      );

      if (conflict) {
        res.status(409).json({
          success: false,
          error: `Timeframe ${timeframe} đã được sử dụng ở chart ${conflict.chartIndex + 1}`,
          details: [{ chartIndex: conflict.chartIndex, timeframe: conflict.timeframe }],
        });
        return;
      }

      // Update the chart config
      const prisma = getPrismaClient();
      const tfRecord = await prisma.timeframe.findUnique({
        where: { code: timeframe },
      });

      if (!tfRecord) {
        res.status(400).json({
          success: false,
          error: "Timeframe not found",
        });
        return;
      }

      await prisma.chartConfig.update({
        where: { chartIndex },
        data: {
          pair: symbol.toUpperCase(),
          timeframeId: tfRecord.id,
          updatedAt: new Date(),
        },
      });

      const updated = await loadCharts();
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "INVALID_QUERY",
        details: parsed.error.issues,
      });
      return;
    }
    try {
      const limit = Math.min(parsed.data.limit ?? 500, MAX_LIMIT);
      const candles = await deps.repo.query({
        symbol: parsed.data.symbol.toUpperCase(),
        timeframe: parsed.data.timeframe as Timeframe,
        fromMs: parsed.data.from,
        toMs: parsed.data.to,
        limit,
      });
      console.log("candles 11231", candles);
      // Auto-backfill if DB returns too few candles
      if (candles.length < AUTO_BACKFILL_THRESHOLD) {
        logger.info(
          {
            symbol: parsed.data.symbol.toUpperCase(),
            timeframe: parsed.data.timeframe,
            dbCount: candles.length,
          },
          "market-data.api.auto-backfill.start",
        );
        try {
          const fetched = await deps.backfill.loadMore(
            parsed.data.symbol.toUpperCase(),
            parsed.data.timeframe as Timeframe,
            Date.now(),
            100,
          );
          if (fetched.length > 0) {
            // Re-query after backfill to get the freshest data
            const refreshed = await deps.repo.query({
              symbol: parsed.data.symbol.toUpperCase(),
              timeframe: parsed.data.timeframe as Timeframe,
              fromMs: parsed.data.from,
              toMs: parsed.data.to,
              limit,
            });
            logger.info(
              { symbol: parsed.data.symbol, timeframe: parsed.data.timeframe, count: refreshed.length },
              "market-data.api.auto-backfill.done",
            );
            res.json({ success: true, data: refreshed });
            return;
          }
        } catch (backfillErr) {
          logger.error(
            { err: (backfillErr as Error).message, symbol: parsed.data.symbol, timeframe: parsed.data.timeframe },
            "market-data.api.auto-backfill.failed",
          );
          // Fall through: return whatever we got from DB even if it's empty
        }
      }

      res.json({ success: true, data: candles });
    } catch (err) {
      logger.error(
        { err: (err as Error).message, query: req.query },
        "market-data.api.query.failed",
      );
      next(err);
    }
  });

  router.post(
    "/load-more",
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = LoadMoreSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "INVALID_BODY",
          details: parsed.error.issues,
        });
        return;
      }
      try {
        const candles = await deps.backfill.loadMore(
          parsed.data.symbol.toUpperCase(),
          parsed.data.timeframe as Timeframe,
          parsed.data.beforeMs,
          parsed.data.limit ?? 1_000,
        );
        res.json({
          success: true,
          data: {
            symbol: parsed.data.symbol.toUpperCase(),
            timeframe: parsed.data.timeframe,
            inserted: candles.length,
            candles,
          },
        });
      } catch (err) {
        logger.error(
          { err: (err as Error).message, body: req.body },
          "market-data.api.load-more.failed",
        );
        next(err);
      }
    },
  );

  return router;
}
