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

  // 2b. Reference Symbols. Required by `NewsCoin` joins: a crawled news
  //     can only be linked to a Symbol row that already exists. The MVP
  //     MVP coin set matches the default crawl targets in
  //     `NewsCrawlerQueue`.
  const referenceSymbols = [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" },
    { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT" },
  ];
  for (const s of referenceSymbols) {
    await prisma.symbol.upsert({
      where: { symbol: s.symbol },
      update: { baseAsset: s.baseAsset, quoteAsset: s.quoteAsset, isActive: true },
      create: { ...s, isActive: true },
    });
  }

  // 2c. News provider row used by the demo RSS adapter. We upsert it
  //     here too so the crawler doesn't race with the seed on a fresh
  //     database.
  await prisma.newsProvider.upsert({
    where: { code: "CRYPTO_NEWS_RSS" },
    update: { requiresApiKey: false, isActive: true },
    create: {
      code: "CRYPTO_NEWS_RSS",
      name: "Crypto News RSS Provider",
      baseUrl: "https://cryptonews.example.com",
      requiresApiKey: false,
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

  // 4. Evaluation module — BullMQ v2 configuration.
  //    These rows drive getEvaluationConfig() at runtime.
  await prisma.evaluationSetting.upsert({
    where: { key: "evaluation.default_weights" },
    update: {},
    create: {
      key: "evaluation.default_weights",
      value: { return: 40, winRate: 40, drawdown: 20 },
    },
  });

  await prisma.evaluationSetting.upsert({
    where: { key: "evaluation.trade_count_threshold" },
    update: {},
    create: {
      key: "evaluation.trade_count_threshold",
      value: { threshold: 30 },
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