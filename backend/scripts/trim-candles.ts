/**
 * One-shot retention cleanup. Trims the `candles` table so each
 * (symbol, timeframe) pair only keeps its newest N rows.
 *
 * Usage (from `backend/`):
 *   npx tsx scripts/trim-candles.ts           # uses env.MAX_CANDLES_PER_CHART
 *   npx tsx scripts/trim-candles.ts --keep=50 # override
 *
 * See docs/Market Data Service.md §6.3 (trimToLatest).
 */
import { logger as rootLogger } from "../src/shared/logger/logger";
import { loadEnv } from "../src/config/env";
import { getPrismaClient } from "../src/infrastructure/database/prisma";
import { PostgresCandleRepository } from "../src/modules/market-data/infrastructure/PostgresCandleRepository";

interface ParsedArgs {
  keep: number;
}

function parseArgs(): ParsedArgs {
  const arg = process.argv.find((a) => a.startsWith("--keep="));
  const parsed = arg ? Number(arg.slice("--keep=".length)) : NaN;
  const fallback = loadEnv().MAX_CANDLES_PER_CHART;
  return {
    keep: Number.isFinite(parsed) && parsed > 0 ? parsed : fallback,
  };
}

async function main(): Promise<void> {
  const { keep } = parseArgs();
  const log = rootLogger;
  const prisma = getPrismaClient();
  const repo = new PostgresCandleRepository(prisma, log);

  log.info({ keep }, "trim-candles.start");

  // Discover every (symbol, timeframe) pair currently in the table.
  const pairs = await prisma.candle.findMany({
    distinct: ["symbolId", "timeframeId"],
    select: {
      symbol: { select: { symbol: true } },
      timeframe: { select: { code: true } },
    },
  });

  let totalDeleted = 0;
  let processed = 0;

  for (const row of pairs) {
    const symbol = row.symbol.symbol;
    const timeframe = row.timeframe.code as Parameters<
      typeof repo.trimToLatest
    >[1];
    try {
      const deleted = await repo.trimToLatest(symbol, timeframe, keep);
      totalDeleted += deleted;
      processed++;
      if (deleted > 0) {
        log.info(
          { symbol, timeframe, deleted, processed, total: pairs.length },
          "trim-candles.pair",
        );
      }
    } catch (err) {
      log.error(
        { symbol, timeframe, err: (err as Error).message },
        "trim-candles.pair.failed",
      );
    }
  }

  log.info(
    { keep, processed, totalDeleted },
    "trim-candles.complete",
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  rootLogger.error({ err: (err as Error).message }, "trim-candles.fatal");
  process.exit(1);
});