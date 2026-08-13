import { PrismaClient } from "@prisma/client";
import { loadEnv, isProduction } from "../../config/env";
import { logger } from "../../shared/logger/logger";

let client: PrismaClient | null = null;

/**
 * Returns a process-wide Prisma client. Module owners should never
 * import `@prisma/client` directly — they receive a port interface
 * and have this client injected at composition time.
 */
export function getPrismaClient(): PrismaClient {
  if (client) return client;

  const env = loadEnv();
  client = new PrismaClient({
    log: isProduction(env)
      ? [{ level: "error", emit: "event" }]
      : [
          { level: "query", emit: "event" },
          { level: "info", emit: "event" },
          { level: "warn", emit: "event" },
          { level: "error", emit: "event" },
        ],
  });

  // Forward Prisma logs to Pino for unified observability.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$on("error", (e: Error) =>
    logger.error({ err: e }, "Prisma error"),
  );
  if (!isProduction(env)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).$on("warn", (e: Error) =>
      logger.warn({ err: e }, "Prisma warning"),
    );
  }

  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}