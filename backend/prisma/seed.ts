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

  // 1. News provider reference row (CryptoPanic — requires API key).
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

  // 2. Default settings (leaderboard top-K, search defaults).
  await prisma.setting.upsert({
    where: { key: "leaderboard.top_k" },
    update: {},
    create: {
      key: "leaderboard.top_k",
      value: 10,
      description: "Default number of strategies displayed on the leaderboard.",
    },
  });

  // 3. Search algorithms consumed by /api/search/start and the SearchService
  //    `buildGenerator` dispatcher. implementationRef values match the
  //    path the route documentation expects so any client (and the API
  //    docs) can reference them unambiguously.
  const searchAlgorithms: ReadonlyArray<{
    code: string;
    name: string;
    implementationRef: string;
  }> = [
    {
      code: "random",
      name: "Random Search",
      implementationRef: "strategy.generator.random",
    },
    {
      code: "domain_guided",
      name: "Domain-guided Search",
      implementationRef: "strategy.generator.domain_guided",
    },
  ];

  for (const algo of searchAlgorithms) {
    await prisma.searchAlgorithm.upsert({
      where: { code: algo.code },
      update: { name: algo.name, implementationRef: algo.implementationRef },
      create: algo,
    });
  }

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