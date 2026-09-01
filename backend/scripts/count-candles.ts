/**
 * Diagnostic: count candles per (symbol, timeframe) and print.
 * Run via: npx tsx scripts/count-candles.ts
 */
import { getPrismaClient } from "../src/infrastructure/database/prisma";

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const groups = await prisma.candle.groupBy({
    by: ["symbolId", "timeframeId"],
    _count: { _all: true },
    _max: { openTime: true },
  });
  const symbols = await prisma.symbol.findMany({ select: { id: true, symbol: true } });
  const timeframes = await prisma.timeframe.findMany({ select: { id: true, code: true } });
  const symMap = new Map(symbols.map((s) => [s.id, s.symbol]));
  const tfMap = new Map(timeframes.map((t) => [t.id, t.code]));
  let total = 0;
  console.table(
    groups.map((g) => {
      total += g._count._all;
      return {
        symbol: symMap.get(g.symbolId) ?? "?",
        timeframe: tfMap.get(g.timeframeId) ?? "?",
        count: g._count._all,
        latestOpenTime: g._max.openTime ? new Date(Number(g._max.openTime)).toISOString() : null,
      };
    }),
  );
  console.log(`TOTAL: ${total}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});