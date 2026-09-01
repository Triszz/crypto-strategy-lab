import { Router } from "express";
import { SentimentController } from "./sentiment.controller";
import { SentimentService } from "../application/sentiment.service";
import { PrismaSentimentRepository } from "../infrastructure/prisma-sentiment.repository";
import { LexiconSentimentAnalyzer } from "../infrastructure/lexicon-sentiment.analyzer";

export function buildSentimentRouter(): Router {
  const router = Router();
  const repository = new PrismaSentimentRepository();
  const analyzer = new LexiconSentimentAnalyzer();
  const sentimentService = new SentimentService(repository, analyzer);
  const controller = new SentimentController(sentimentService);

  router.get("/summary", controller.getSummary);

  return router;
}
