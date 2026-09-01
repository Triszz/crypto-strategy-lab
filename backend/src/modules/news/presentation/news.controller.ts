import { Request, Response } from "express";
import { NewsService } from "../application/news.service";
import { ApiResponse } from "../../../shared/types";

export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  public getNews = async (req: Request, res: Response): Promise<void> => {
    try {
      const symbol = req.query.symbol as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 10;

      // Auto-trigger fetch to ensure fresh news data is available
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
    try {
      const { id } = req.params;
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
}
