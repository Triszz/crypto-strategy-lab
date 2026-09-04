import { Router } from "express";
import { NewsController } from "./news.controller";
import { buildNewsContainer } from "../news.container";
import { ApiResponse } from "../../../shared/types";
import { NewsCrawlProgress } from "../infrastructure/news-crawler.queue";

/**
 * HTTP surface for the News module.
 *
 * Routes after Phase A:
 *  - `GET  /`           — pure read, filterable by `symbol`.
 *  - `GET  /:id`        — pure read of a single item.
 *  - `POST /crawl`      — synchronous manual trigger (returns 202 + count).
 *  - `GET  /crawl/:jobId/status` — status of a background cron-triggered
 *                                   crawl. Phase A.4 added this so the FE
 *                                   can render "last crawl at ..." info.
 *
 * Composition: both routes and the background queue share the same
 * `NewsService` instance via `buildNewsContainer()`. This is the fix
 * for the previous "controller uses one instance, cron uses another"
 * risk identified in `News_Module_Analysis.md` (Section 8, N1).
 */
export function buildNewsRouter(): Router {
  const router = Router();
  const { service } = buildNewsContainer();
  const controller = new NewsController(service);

  // Pure read — list news with optional filters/pagination.
  router.get("/", controller.getNews);

  // Pure read — single news item by id.
  router.get("/:id", controller.getNewsById);

  // Side-effecting — explicitly trigger a crawl. Decoupled from GET /news in Phase 1.3.
  router.post("/crawl", controller.triggerCrawl);

  // Status of a background crawl job. Phase A.4 added this so the
  // dashboard / admin can observe the periodic crawler.
  router.get("/crawl/:jobId/status", (req, res) => {
    const { jobId } = req.params;
    const { crawler } = buildNewsContainer();
    const progress: NewsCrawlProgress | null = crawler.getJobStatus(jobId);

    if (!progress) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "JOB_NOT_FOUND", message: `No crawl job with id ${jobId}` },
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse<NewsCrawlProgress> = {
      success: true,
      data: progress,
      meta: { timestamp: new Date().toISOString() },
    };
    res.json(response);
  });

  // LLM-assisted extraction template & self-healing routes
  router.get("/templates", controller.getExtractionTemplate);
  router.post("/self-healing/toggle", controller.toggleSelfHealing);

  return router;
}
