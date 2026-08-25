import { Router } from "express";
import { healthRouter } from "./health.routes";
import { buildMarketDataContainer } from "../../modules/market-data";
import type { MarketDataContainer } from "../../modules/market-data";
import type { SearchContainer } from "../../modules/search";
import { buildStrategyRouter } from "../../modules/strategy/presentation/strategy.routes";
import { backtestRouter } from "../../modules/backtest/presentation/backtest.routes";

/**
 * Aggregates every module-owned route under `/api`.
 *
 * Module routes will be added by their respective owners in later
 * tasks. Each module exposes its own `*.routes.ts` file inside its
 * `presentation/` directory and re-mounts it here.
 *
 * The Market Data container is *built once* in `server.ts` after the
 * Socket.IO server is initialised. We store the reference here so the
 * router can later be mounted without re-running the DI composition.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use("/backtests", backtestRouter);

let mountedMarketData: MarketDataContainer | null = null;
let mountedSearch: SearchContainer | null = null;
let mountedStrategy: ReturnType<typeof buildStrategyRouter> | null = null;

/**
 * Called by `server.ts` once the Socket.IO singleton is initialised
 * and the market-data container has been built. Safe to call multiple
 * times — subsequent calls are no-ops.
 */
export function mountMarketData(container: MarketDataContainer): void {
  if (mountedMarketData) return;
  mountedMarketData = container;
  apiRouter.use("/candles", container.router);
}

/**
 * Called by `server.ts` to mount the Search router under `/api/search`.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function mountSearch(container: SearchContainer): void {
  if (mountedSearch) return;
  mountedSearch = container;
  apiRouter.use("/search", container.router);
}

/**
 * Mounts the Strategy catalogue router under `/api/strategies`.
 * Strategy routes are stateless — no container or DI needed.
 */
export function mountStrategy(): void {
  if (mountedStrategy) return;
  mountedStrategy = buildStrategyRouter();
  apiRouter.use("/strategies", mountedStrategy);
}

void buildMarketDataContainer;

export { healthRouter, backtestRouter };