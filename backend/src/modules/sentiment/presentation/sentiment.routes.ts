import { Router } from "express";
import { SentimentController } from "./sentiment.controller";
import { SentimentService } from "../application/sentiment.service";
import { PrismaSentimentRepository } from "../infrastructure/prisma-sentiment.repository";
import { LexiconSentimentAnalyzer } from "../infrastructure/lexicon-sentiment.analyzer";
import { GeminiSentimentAnalyzer } from "../infrastructure/gemini-sentiment.analyzer";

export function buildSentimentRouter(): Router {
  const router = Router();
  const repository = new PrismaSentimentRepository();

  // Dynamic selection via env: default to Lexicon, or Gemini if configured
  const analyzer =
    process.env.SENTIMENT_ANALYZER?.toLowerCase() === "gemini"
      ? new GeminiSentimentAnalyzer()
      : new LexiconSentimentAnalyzer();

  const sentimentService = new SentimentService(repository, analyzer);
  const controller = new SentimentController(sentimentService);

  router.get("/summary", controller.getSummary);

  return router;
}
