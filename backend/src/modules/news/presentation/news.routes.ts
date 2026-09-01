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

  router.get("/", controller.getNews);
  router.get("/:id", controller.getNewsById);

  return router;
}
