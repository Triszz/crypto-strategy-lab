/**
 * Evaluation API Routes.
 *
 * Mounted at `/api/evaluation` by `src/api/routes/index.ts`.
 *
 * Endpoints:
 *  - GET  /api/evaluation/:experimentId       — fetch computed metrics + equity curve
 *  - GET  /api/evaluation/:experimentId/queue — fetch BullMQ job status for an experiment
 *
 * Both endpoints delegate to `EvaluationController` and do NOT contain business logic.
 */

import { Router } from "express";
import { EvaluationController } from "./evaluation.controller";

export function buildEvaluationRouter(): Router {
  const router = Router();
  const controller = new EvaluationController();

  router.get("/:experimentId", controller.getMetrics);
  router.get("/:experimentId/queue", controller.getQueueStatus);

  return router;
}
