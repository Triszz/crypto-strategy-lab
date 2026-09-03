import type { RedisOptions } from "bullmq";
import { loadEnv } from "../../config/env";

/**
 * Returns standardized Redis connection options for BullMQ queues and workers.
 */
export function getRedisConnectionOptions(): RedisOptions {
  const env = loadEnv();
  return {
    host: env.REDIS_HOST || "localhost",
    port: env.REDIS_PORT || 6379,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB || 0,
    maxRetriesPerRequest: null,
  };
}
