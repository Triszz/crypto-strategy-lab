import { Request, Response } from "express";
import { NewsService } from "../application/news.service";
import { ApiResponse } from "../../../shared/types";
import { logger as defaultLogger, Logger } from "../../../shared/logger/logger";
import {
  CrawlNewsBodySchema,
  GetNewsByIdParamsSchema,
  GetNewsQuerySchema,
} from "./news.dto";

export class NewsController {
  constructor(
    private readonly newsService: NewsService,
    private readonly log: Logger = defaultLogger,
  ) {}

  public getNews = async (req: Request, res: Response): Promise<void> => {
    const parsed = GetNewsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      this.log.warn(
        { event: "news.api.list.invalid_query", issues: parsed.error.issues, query: req.query },
        "Rejected GET /news with invalid query",
      );
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: "INVALID_QUERY",
          message: "Invalid query parameters",
          details: { issues: parsed.error.issues },
        },
      };
      res.status(400).json(response);
      return;
    }

    this.log.debug(
      { event: "news.api.list.request", query: parsed.data },
      "GET /news received",
    );

    try {
      const { symbol, page, pageSize } = parsed.data;

      // Pure read — Phase 1.3 removed the implicit crawl from this handler.
      // Crawling is exposed as POST /news/crawl (controller.triggerCrawl).
      const result = await this.newsService.getNewsList({ symbol, page, pageSize });

      this.log.debug(
        {
          event: "news.api.list.response",
          returned: result.items.length,
          total: result.total,
        },
        "GET /news responded",
      );

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
      this.log.error(
        { event: "news.api.list.error", err: (err as Error).message },
        "GET /news failed",
      );
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "NEWS_FETCH_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };

  public getNewsById = async (req: Request, res: Response): Promise<void> => {
    const parsed = GetNewsByIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      this.log.warn(
        { event: "news.api.detail.invalid_params", issues: parsed.error.issues, params: req.params },
        "Rejected GET /news/:id with invalid params",
      );
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: "Invalid path parameters",
          details: { issues: parsed.error.issues },
        },
      };
      res.status(400).json(response);
      return;
    }

    this.log.debug(
      { event: "news.api.detail.request", id: parsed.data.id },
      "GET /news/:id received",
    );

    try {
      const { id } = parsed.data;
      const item = await this.newsService.getNewsDetail(id);

      if (!item) {
        this.log.info(
          { event: "news.api.detail.not_found", id },
          "News item not found",
        );
        const response: ApiResponse<null> = {
          success: false,
          error: { code: "NEWS_NOT_FOUND", message: `News item with ID ${id} not found` },
        };
        res.status(404).json(response);
        return;
      }

      this.log.debug(
        { event: "news.api.detail.response", id: item.id },
        "GET /news/:id responded",
      );

      const response: ApiResponse<typeof item> = {
        success: true,
        data: item,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
      this.log.error(
        { event: "news.api.detail.error", err: (err as Error).message, id: req.params.id },
        "GET /news/:id failed",
      );
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "NEWS_DETAIL_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };

  /**
   * POST /news/crawl — explicitly trigger a crawl.
   *
   * Decoupled from `GET /news` in Phase 1.3. The read endpoint is now
   * pure; clients must call this endpoint to refresh the news corpus.
   */
  public triggerCrawl = async (req: Request, res: Response): Promise<void> => {
    const parsed = CrawlNewsBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      this.log.warn(
        { event: "news.api.crawl.invalid_body", issues: parsed.error.issues, body: req.body },
        "Rejected POST /news/crawl with invalid body",
      );
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: "INVALID_BODY",
          message: "Invalid request body",
          details: { issues: parsed.error.issues },
        },
      };
      res.status(400).json(response);
      return;
    }

    this.log.info(
      { event: "news.api.crawl.request", symbol: parsed.data.symbol ?? null },
      "POST /news/crawl received",
    );

    try {
      const items = await this.newsService.fetchAndStoreLatestNews(parsed.data.symbol);
      const response: ApiResponse<{ triggered: true; count: number }> = {
        success: true,
        data: { triggered: true, count: items.length },
        meta: { timestamp: new Date().toISOString() },
      };
      this.log.info(
        { event: "news.api.crawl.response", count: items.length },
        "POST /news/crawl completed",
      );
      res.status(202).json(response);
    } catch (err) {
      this.log.error(
        { event: "news.api.crawl.error", err: (err as Error).message },
        "POST /news/crawl failed",
      );
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "CRAWL_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };
}