import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const searchRunId = "ffc6239f-62db-4195-b4f4-a3c8f6383b2e";

  console.log("=== SearchRun (real Supabase row) ===");
  const run = await prisma.searchRun.findUnique({
    where: { id: searchRunId },
    include: {
      algorithm: { select: { code: true, name: true } },
      symbol: { select: { symbol: true } },
      candidates: {
        include: {
          strategyVersion: {
            include: {
              definition: { select: { type: true, family: true } },
              compositeParent: true,
              compositeChild: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  console.log(JSON.stringify(run, null, 2));

  console.log("=== SearchAlgorithms ===");
  const algos = await prisma.searchAlgorithm.findMany();
  console.log(JSON.stringify(algos, null, 2));

  console.log("=== Symbols (BTCUSDT, ETHUSDT) ===");
  const symbols = await prisma.symbol.findMany({
    where: { symbol: { in: ["BTCUSDT", "ETHUSDT"] } },
    select: { symbol: true, isActive: true, id: true },
  });
  console.log(JSON.stringify(symbols, null, 2));

  console.log("=== Timeframes (active ones) ===");
  const tfs = await prisma.timeframe.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });
  console.log(JSON.stringify(tfs, null, 2));

  // Try running a backtest with one of the existing candidates using strategyName-based approach
  console.log("=== Test: Try to fetch candidateId and resolve to strategyName ===");
  if (run && run.candidates.length > 0) {
    for (const c of run.candidates) {
      console.log({
        candidateId: c.id,
        strategyVersionName: c.strategyVersion.name,
        implementationRef: c.strategyVersion.implementationRef,
        definitionType: c.strategyVersion.definition.type,
        parametersKeys: Object.keys(c.parameters || {}),
      });
    }
  }

  // Check current experiments count
  console.log("=== Experiments count ===");
  console.log("Total Experiments:", await prisma.experiment.count());
  console.log("Total BacktestResults:", await prisma.backtestResult.count());
  console.log("Total Trades:", await prisma.trade.count());
}

main()
  .catch((err) => {
    console.error("[verify] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });