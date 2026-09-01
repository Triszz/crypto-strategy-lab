import { Request, Response } from "express";
import { NewsService } from "../application/news.service";
import { ApiResponse } from "../../../shared/types";
import {
  CrawlNewsBodySchema,
  GetNewsByIdParamsSchema,
  GetNewsQuerySchema,
} from "./news.dto";

export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  public getNews = async (req: Request, res: Response): Promise<void> => {
    const parsed = GetNewsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
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

    try {
      const { symbol, page, pageSize } = parsed.data;

      // Auto-trigger fetch to ensure fresh news data is available
      // (Phase 1.3 will move it to a dedicated POST /news/crawl endpoint.)
      await this.newsService.fetchAndStoreLatestNews(symbol);

      const result = await this.newsService.getNewsList({ symbol, page, pageSize });

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
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

    try {
      const { id } = parsed.data;
      const item = await this.newsService.getNewsDetail(id);

      if (!item) {
        const response: ApiResponse<null> = {
          success: false,
          error: { code: "NEWS_NOT_FOUND", message: `News item with ID ${id} not found` },
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse<typeof item> = {
        success: true,
        data: item,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
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
   * Phase 1.3 introduces this handler. Today (Phase 1.1) it is wired up
   * but its only job is to validate the body and delegate. The endpoint
   * is harmless even before we remove auto-fetch from `GET /news`.
   */
  public triggerCrawl = async (req: Request, res: Response): Promise<void> => {
    const parsed = CrawlNewsBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
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

    try {
      const items = await this.newsService.fetchAndStoreLatestNews(parsed.data.symbol);
      const response: ApiResponse<{ triggered: true; count: number }> = {
        success: true,
        data: { triggered: true, count: items.length },
        meta: { timestamp: new Date().toISOString() },
      };
      res.status(202).json(response);
    } catch (err) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "CRAWL_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };
}