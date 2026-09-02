import { PrismaClient } from "@prisma/client";
import { loadEnv, isProduction } from "../../config/env";
import { logger } from "../../shared/logger/logger";

let client: PrismaClient | null = null;

/**
 * Build a Prisma-compatible DATABASE_URL with pool guard-rails appended.
 * Supabase's session pooler caps at pool_size=15 by default; we clamp
 * Prisma's connection pool to leave headroom for other consumers.
 *
 * If the URL already contains connection_limit, we leave it unchanged.
 */
function buildPrismaDatabaseUrl(raw: string): string {
  if (!raw.includes("?")) {
    return `${raw}?connection_limit=10&pool_timeout=15`;
  }
  if (/\bconnection_limit=/.test(raw)) {
    return raw; // respect user's explicit override
  }
  return `${raw}&connection_limit=10&pool_timeout=15`;
}

/**
 * Returns a process-wide Prisma client. Module owners should never
 * import `@prisma/client` directly — they receive a port interface
 * and have this client injected at composition time.
 */
export function getPrismaClient(): PrismaClient {
  if (client) return client;

  const env = loadEnv();
  const dbUrl = buildPrismaDatabaseUrl(env.DATABASE_URL);

  client = new PrismaClient({
    datasources: { db: { url: dbUrl } },
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