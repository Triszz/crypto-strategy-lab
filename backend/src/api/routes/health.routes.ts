import { Router, type Request, type Response } from "express";
import { loadEnv } from "../../config/env";

/**
 * /api/health — infra smoke test. Returns the service identity and a
 * status flag. Intended for load balancers and CI checks, NOT for
 * business use.
 */
export const healthRouter: Router = Router();

healthRouter.get("/health", (_req: Request, res: Response) => {
  const env = loadEnv();
  res.status(200).json({
    success: true,
    service: "crypto-strategy-lab-backend",
    status: "ok",
    env: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});