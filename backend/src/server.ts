import http from "node:http";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { logger } from "./shared/logger/logger";
import { initSocketServer } from "./infrastructure/websocket/socket";
import { closeRedisConnection, getRedisConnection, pingRedis } from "./infrastructure/queue/redis";
import { closeSocketServer, getSocketServer } from "./infrastructure/websocket/socket";
import { getEventBus } from "./shared/event-bus";
import { buildMarketDataContainer } from "./modules/market-data";
import { buildSearchContainer } from "./modules/search";
import { mountMarketData, mountSearch, mountStrategy } from "./api/routes";
import { bootstrapStrategies } from "./modules/strategy";

/**
 * Process entrypoint. Responsibilities:
 *  1. Load + validate environment.
 *  2. Warm shared infrastructure singletons (EventBus, Redis).
 *  3. Build the Express application.
 *  4. Start the HTTP server and attach Socket.IO.
 *  5. Boot the Market Data service (sync symbols, backfill, WS connect).
 *  6. Install graceful shutdown hooks.
 *
 * No business logic lives here.
 */

async function main(): Promise<void> {
  const env = loadEnv();

  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Starting backend");

  // Warm infrastructure singletons early so module initialisers can
  // pull them synchronously when needed.
  getEventBus();
  getRedisConnection();

  const app = createApp();
  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  // Build the Market Data container at the right point so the
  // Socket.IO singleton is initialised before the gateway attaches.
  const marketData = buildMarketDataContainer();
  mountMarketData(marketData);
  marketData.socketGateway.start();
  marketData.persister.start();
  const marketStartPromise = marketData.service.start().catch((err: unknown) => {
    logger.fatal(
      { err },
      "Market Data service failed to start — backend will keep running without realtime data",
    );
  });

  // Build and mount the Search container.
  const search = buildSearchContainer();
  mountSearch(search);

  // Mount Strategy catalogue routes (stateless, no container needed).
  bootstrapStrategies();
  mountStrategy();

  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", (err: unknown) => {
      const error = err as { code?: string };
      if (error.code === "EADDRINUSE") {
        logger.error(
          { port: env.PORT },
          `Port ${env.PORT} is already in use by a running backend instance. You do not need to run "npm run dev" again.`,
        );
      }
      reject(err);
    });
    httpServer.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, "HTTP server listening");
      resolve();
    });
  });

  // Best-effort Redis ping (informational, never blocks startup).
  void pingRedis().then((ok) => {
    if (ok) logger.info("Redis ping OK");
    else logger.warn("Redis ping failed (queue/cache will be unavailable)");
  });

  // Start the Market Data service asynchronously so HTTP can serve
  // health checks immediately while backfill + WS connect happen.
  void marketStartPromise;

  installShutdown(httpServer, marketData, search);
}

function installShutdown(
  httpServer: http.Server,
  marketData: ReturnType<typeof buildMarketDataContainer>,
  _search: ReturnType<typeof buildSearchContainer>,
): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    httpServer.close((err) => {
      if (err) logger.error({ err }, "HTTP close error");
      logger.info("HTTP server closed");
    });

    try {
      await marketData.service.stop();
    } catch (err) {
      logger.warn({ err }, "Market data shutdown error");
    }
    try {
      marketData.persister.stop();
    } catch (err) {
      logger.warn({ err }, "Candle persister stop error");
    }
    try {
      marketData.socketGateway.stop();
    } catch (err) {
      logger.warn({ err }, "Socket gateway stop error");
    }

    try {
      await closeSocketServer();
    } catch (err) {
      logger.warn({ err }, "Socket close error");
    }
    try {
      await closeRedisConnection();
    } catch (err) {
      logger.warn({ err }, "Redis close error");
    }

    // Touch Socket.IO singleton to make sure it was initialised.
    try {
      getSocketServer();
    } catch {
      /* not initialised; safe to ignore */
    }

    process.exit(0);
  };

  process.on("SIGINT", (sig) => void shutdown(sig));
  process.on("SIGTERM", (sig) => void shutdown(sig));
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });
}

void main().catch((err: unknown) => {
  logger.fatal({ err }, "Failed to start backend");
  process.exit(1);
});