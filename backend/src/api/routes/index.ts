import { Router } from "express";
import { healthRouter } from "./health.routes";

/**
 * Aggregates every module-owned route under `/api`.
 *
 * Module routes will be added by their respective owners in later
 * tasks. Each module exposes its own `*.routes.ts` file inside its
 * `presentation/` directory and re-mounts it here.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);

// Future mounts (each module owner adds their own):
// apiRouter.use('/candles', marketDataRouter);
// apiRouter.use('/strategies', strategyRouter);
// apiRouter.use('/search', searchRouter);
// apiRouter.use('/backtests', backtestRouter);
// apiRouter.use('/evaluations', evaluationRouter);
// apiRouter.use('/leaderboard', leaderboardRouter);
// apiRouter.use('/news', newsRouter);
// apiRouter.use('/sentiments', sentimentRouter);

export { healthRouter };