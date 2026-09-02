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