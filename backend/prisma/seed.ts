/* eslint-disable no-console */
/**
 * Prisma seed — minimal reference data only.
 *
 * Goal of this script: prove that the schema can be applied against a
 * fresh PostgreSQL instance WITHOUT introducing fake business data.
 * Module owners can extend the seed (candle fixtures, news mocks, etc.)
 * in their own tasks.
 *
 * Run with: `npx prisma db seed` (configured in package.json).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("[seed] Reference data only — no business fixtures.");

  // 1. Market data provider reference row (Binance — public endpoint).
  await prisma.marketDataProvider.upsert({
    where: { code: "binance" },
    update: {},
    create: {
      code: "binance",
      name: "Binance",
      baseUrl: "https://api.binance.com",
      isActive: true,
    },
  });

  // 2. News provider reference row (CryptoPanic — requires API key).
  await prisma.newsProvider.upsert({
    where: { code: "cryptopanic" },
    update: {},
    create: {
      code: "cryptopanic",
      name: "CryptoPanic",
      baseUrl: "https://cryptopanic.com/api/v1",
      requiresApiKey: true,
      isActive: true,
    },
  });

  // 3. Default settings (leaderboard top-K, search defaults).
  await prisma.setting.upsert({
    where: { key: "leaderboard.top_k" },
    update: {},
    create: {
      key: "leaderboard.top_k",
      value: 10,
      description: "Default number of strategies displayed on the leaderboard.",
    },
  });

  console.log("[seed] Done.");
}

main()
  .catch((err: unknown) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });