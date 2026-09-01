import { Router } from "express";
import { NewsController } from "./news.controller";
import { NewsService } from "../application/news.service";
import { PrismaNewsRepository } from "../infrastructure/prisma-news.repository";
import { RSSNewsAdapter } from "../infrastructure/rss-news.adapter";

export function buildNewsRouter(): Router {
  const router = Router();
  const repository = new PrismaNewsRepository();
  const adapter = new RSSNewsAdapter();
  const newsService = new NewsService(repository, adapter);
  const controller = new NewsController(newsService);

  // Pure read — list news with optional filters/pagination.
  router.get("/", controller.getNews);

  // Pure read — single news item by id.
  router.get("/:id", controller.getNewsById);

  // Side-effecting — explicitly trigger a crawl. Decoupled from GET /news in Phase 1.3.
  router.post("/crawl", controller.triggerCrawl);

  return router;
}