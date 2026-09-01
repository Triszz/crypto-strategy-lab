import { Router } from "express";
import { LeaderboardController } from "./leaderboard.controller";
import { LeaderboardService } from "../application/leaderboard.service";
import { PrismaLeaderboardRepository } from "../infrastructure/prisma-leaderboard.repository";

export function buildLeaderboardRouter(): Router {
  const router = Router();
  const repository = new PrismaLeaderboardRepository();
  const leaderboardService = new LeaderboardService(repository);
  const controller = new LeaderboardController(leaderboardService);

  router.get("/", controller.getTopK);
  router.get("/history/:strategyVersionId", controller.getHistory);

  return router;
}
