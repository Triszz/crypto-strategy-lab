import IORedis, { type Redis, type RedisOptions } from "ioredis";
import { loadEnv } from "../../config/env";
import { logger } from "../../shared/logger/logger";

/**
 * Single shared Redis connection used by BullMQ and future caching
 * concerns. The connection is intentionally lazy: clients opt-in via
 * `getRedisConnection()` so that the import of this file alone does
 * NOT open a TCP connection.
 */
let connection: Redis | null = null;

function buildOptions(): RedisOptions {
  const env = loadEnv();
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD && env.REDIS_PASSWORD.length > 0
      ? env.REDIS_PASSWORD
      : undefined,
    db: env.REDIS_DB,
    lazyConnect: true,
    maxRetriesPerRequest: null, // BullMQ-friendly
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 3) {
        // Stop reconnecting if Redis is not running locally
        return null;
      }
      return Math.min(times * 200, 1000);
    },
  };
}

let loggedErrorOnce = false;

export function getRedisConnection(): Redis {
  if (connection) return connection;
  connection = new IORedis(buildOptions());

  connection.on("connect", () => {
    logger.info("Redis connection established");
    loggedErrorOnce = false;
  });
  connection.on("ready", () => {
    logger.info("Redis ready");
  });
  connection.on("error", (err: Error) => {
    if (!loggedErrorOnce) {
      logger.warn({ message: err.message }, "Redis connection failed (queue will operate offline/mock)");
      loggedErrorOnce = true;
    }
  });
  connection.on("close", () => {
    logger.warn("Redis connection closed");
  });
  connection.on("end", () => {
    logger.warn("Redis connection ended");
  });
  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection && connection.status !== "end") {
    try {
      await connection.quit();
    } catch (err) {
      logger.warn({ err }, "Error while quitting Redis connection; forcing disconnect");
      connection.disconnect();
    }
  }
  connection = null;
}

/**
 * Best-effort health check. Returns true if Redis replies to PING.
 * Used by diagnostic endpoints, never required for the app to start.
 */
export async function pingRedis(): Promise<boolean> {
  try {
    const conn = getRedisConnection();
    if (conn.status === "wait" || conn.status === "end") {
      await conn.connect();
    }
    const reply = await conn.ping();
    return reply === "PONG";
  } catch (err) {
    logger.warn({ err }, "Redis ping failed");
    return false;
  }
}