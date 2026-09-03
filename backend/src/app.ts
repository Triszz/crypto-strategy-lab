import express, { type Application, type NextFunction, type Request, type Response } from "express";
import morgan from "morgan";
import { loadEnv } from "./config/env";
import { apiRouter } from "./api/routes";
import { errorHandler, notFoundHandler } from "./api/middleware";
import { logger } from "./shared/logger/logger";

/** Simple CORS middleware – reads CORS_ORIGINS from env (default "*"). */
function corsMiddleware(env: ReturnType<typeof loadEnv>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowed = env.CORS_ORIGINS;
    const origin = req.headers.origin;
    if (allowed === "*" || !origin || allowed.split(",").includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    } else {
      res.setHeader("Access-Control-Allow-Origin", allowed);
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * Builds the Express `Application`. Pure construction: no side-effects,
 * no `listen()`. `server.ts` uses this to wire the HTTP server, and
 * tests use it to obtain an Express app without binding a port.
 */
export function createApp(): Application {
  const env = loadEnv();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // CORS must run before the API router so pre-flight OPTIONS requests
  // are handled before any route logic.
  app.use(corsMiddleware(env));

  // Morgan HTTP request logger (dev format for colored output)
  app.use(morgan("dev"));

  // Lightweight access log. The structured logger (Pino) is the
  // single source of truth for application logs.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const started = Date.now();
    _res.on("finish", () => {
      logger.debug(
        {
          method: req.method,
          path: req.originalUrl,
          status: _res.statusCode,
          durationMs: Date.now() - started,
        },
        "http_request",
      );
    });
    next();
  });

  // API root
  app.use("/api", apiRouter);

  // Root sanity check (helps humans + curl smoke tests)
  app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      service: "crypto-strategy-lab-backend",
      message: "Backend is up. Try GET /api/health.",
      env: env.NODE_ENV ?? "development",
    });
  });

  // 404 + error handler must be LAST.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}