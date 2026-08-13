import http from "node:http";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { logger } from "./shared/logger/logger";
import { initSocketServer } from "./infrastructure/websocket/socket";
import { closeRedisConnection, getRedisConnection, pingRedis } from "./infrastructure/queue/redis";
import { closeSocketServer, getSocketServer } from "./infrastructure/websocket/socket";
import { getEventBus } from "./shared/event-bus";

/**
 * Process entrypoint. Responsibilities:
 *  1. Load + validate environment.
 *  2. Warm shared infrastructure singletons (EventBus, Redis).
 *  3. Build the Express application.
 *  4. Start the HTTP server and attach Socket.IO.
 *  5. Install graceful shutdown hooks.
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

  await new Promise<void>((resolve) => {
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

  installShutdown(httpServer);
}

function installShutdown(httpServer: http.Server): void {
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