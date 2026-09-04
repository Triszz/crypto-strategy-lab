import { Router } from "express";
import { healthRouter } from "./health.routes";
import { buildMarketDataContainer } from "../../modules/market-data";
import type { MarketDataContainer } from "../../modules/market-data";
import type { SearchContainer } from "../../modules/search";
import { buildStrategyRouter } from "../../modules/strategy/presentation/strategy.routes";
import { backtestRouter } from "../../modules/backtest/presentation/backtest.routes";
import { buildEvaluationRouter } from "../../modules/evaluation/presentation/evaluation.routes";
import { buildNewsRouter } from "../../modules/news/presentation/news.routes";
import { buildSentimentRouter } from "../../modules/sentiment/presentation/sentiment.routes";
import { buildLeaderboardRouter } from "../../modules/leaderboard/presentation/leaderboard.routes";
import { buildLoopRouter } from "../../modules/leaderboard/presentation/loop.routes";
import type { LoopOrchestratorService } from "../../modules/leaderboard/application/loop-orchestrator.service";
import type { LoopOrchestratorRunner } from "../../modules/leaderboard/application/loop-orchestrator-runner";

/**
 * Aggregates every module-owned route under `/api`.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use("/backtests", backtestRouter);
apiRouter.use("/evaluation", buildEvaluationRouter());
apiRouter.use("/news", buildNewsRouter());
apiRouter.use("/sentiment", buildSentimentRouter());
apiRouter.use("/leaderboard", buildLeaderboardRouter());

let mountedMarketData: MarketDataContainer | null = null;
let mountedSearch: SearchContainer | null = null;
let mountedStrategy: ReturnType<typeof buildStrategyRouter> | null = null;
let mountedLoop: ReturnType<typeof buildLoopRouter> | null = null;

export function mountMarketData(container: MarketDataContainer): void {
  if (mountedMarketData) return;
  mountedMarketData = container;
  apiRouter.use("/candles", container.router);
}

export function mountSearch(container: SearchContainer): void {
  if (mountedSearch) return;
  mountedSearch = container;
  apiRouter.use("/search", container.router);
}

export function mountStrategy(): void {
  if (mountedStrategy) return;
  mountedStrategy = buildStrategyRouter();
  apiRouter.use("/strategies", mountedStrategy);
}

export function mountLoop(deps: {
  orchestrator: LoopOrchestratorService;
  runner?: LoopOrchestratorRunner;
}): void {
  if (mountedLoop) return;
  mountedLoop = buildLoopRouter(deps);
  apiRouter.use("/loop", mountedLoop);
}

void buildMarketDataContainer;

export { healthRouter, backtestRouter };