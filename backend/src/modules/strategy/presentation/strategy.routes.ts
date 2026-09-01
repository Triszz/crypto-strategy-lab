/**
 * strategy · presentation · strategy.routes
 *
 * REST API endpoints for the Strategy catalogue.
 *
 *  GET /api/strategies          — list all registered strategies
 *  GET /api/strategies/:id      — get a single strategy detail
 *
 * Authentication: public (no auth middleware exists in this project yet).
 * Error convention: follows the project's ApiResponse shape from api.ts.
 */
import { Router } from "express";
import { StrategyService } from "./StrategyService";

export function buildStrategyRouter(): Router {
  const router = Router();
  const service = new StrategyService();

  // GET /api/strategies
  router.get("/", (_req, res) => {
    const result = service.list();
    res.json({ success: true as const, data: result });
  });

  // GET /api/strategies/:id
  router.get("/:id", (req, res) => {
    const { id } = req.params;
    const strategy = service.get(id);

    if (!strategy) {
      res.status(404).json({
        success: false as const,
        error: `Strategy "${id}" not found.`,
      });
      return;
    }

    res.json({ success: true as const, data: { strategy } });
  });

  return router;
}
