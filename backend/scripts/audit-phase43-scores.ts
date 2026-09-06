// Audit — look at score history for a loop
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const loop = await prisma.loopRunState.findFirst({
    where: { loopId: "combo-2eea25a0-3ff3-4863-be36-025b5b4e8518" },
  });
  if (!loop) return;

  // For each iteration, find the top-1 BacktestResult
  const iters = await prisma.loopIteration.findMany({
    where: { loopId: loop.loopId },
    orderBy: { iterationIndex: "asc" },
  });

  for (const it of iters) {
    if (!it.searchRunId) continue;
    const cands = await prisma.candidateStrategy.findMany({
      where: { searchRunId: it.searchRunId },
      select: { id: true },
    });
    if (cands.length === 0) continue;

    // Get all experiments for these candidates
    const exps = await prisma.experiment.findMany({
      where: { candidateId: { in: cands.map((c) => c.id) } },
      select: { id: true, candidateId: true, createdAt: true, status: true },
    });

    // Get all backtest results
    const bts = await prisma.backtestResult.findMany({
      where: { experimentId: { in: exps.map((e) => e.id) } },
      orderBy: { createdAt: "asc" },
    });
    console.log(`\nITER ${it.iterationIndex} (sr=${it.searchRunId.substring(0,8)}) - ${exps.length} exps, ${bts.length} backtest results`);

    // Sort by createdAt and show the score evolution
    for (const bt of bts.slice(0, 12)) {
      const exp = exps.find((e) => e.id === bt.experimentId);
      const cand = cands.find((c) => c.id === exp?.candidateId);
      const lpe = await prisma.loopProcessedEvent.findFirst({
        where: { dedupeKey: { endsWith: bt.experimentId } },
        orderBy: { evaluatedAt: "desc" },
      });
      console.log(`  ${bt.createdAt.toISOString()} exp=${bt.experimentId.substring(0,8)} score=${bt.overallScore} return=${bt.totalReturn} wr=${bt.winRate} cand=${cand?.id.substring(0,8)} ${lpe ? `LPE=${lpe.evaluatedAt.toISOString()}` : "noLPE"}`);
    }
  }

  // Also check loop-level: bestScoreSoFar history
  console.log("\n\nLOOP RUN STATE HISTORY:");
  console.log(`  bestScoreSoFar=${loop.bestScoreSoFar}`);
  console.log(`  bestStrategyVersionId=${loop.bestStrategyVersionId?.substring(0, 8)}`);
  console.log(`  bestTotalReturn=${loop.bestTotalReturn}`);
  console.log(`  bestWinRate=${loop.bestWinRate}`);

  // Check the StrategyEvaluated event ordering
  const lp = await prisma.loopProcessedEvent.findMany({
    where: { loopId: loop.loopId },
    orderBy: { evaluatedAt: "asc" },
  });
  console.log(`\n  LoopProcessedEvent count: ${lp.length}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
