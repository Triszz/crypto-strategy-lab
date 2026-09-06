// Audit — timestamp trace per candidate
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Get iter 1 candidates for the most recent loop
  const loop = await prisma.loopRunState.findFirst({
    where: { loopId: "combo-2eea25a0-3ff3-4863-be36-025b5b4e8518" },
  });
  if (!loop) { console.log("loop not found"); return; }

  const iter1 = await prisma.loopIteration.findFirst({
    where: { loopId: loop.loopId, iterationIndex: 1 },
  });
  if (!iter1?.searchRunId) { console.log("no iter1 sr"); return; }

  console.log(`ITER 1: createdAt=${iter1.createdAt.toISOString()} completedAt=${iter1.completedAt?.toISOString() ?? "null"}`);
  console.log(`Duration: ${iter1.completedAt ? (iter1.completedAt.getTime() - iter1.createdAt.getTime()) : "n/a"}ms`);
  console.log(`SearchRun: ${iter1.searchRunId}`);

  const cands = await prisma.candidateStrategy.findMany({
    where: { searchRunId: iter1.searchRunId },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n${cands.length} candidates for iter 1`);

  for (const c of cands) {
    const exp = await prisma.experiment.findFirst({
      where: { candidateId: c.id },
      orderBy: { createdAt: "desc" },
    });
    const bt = exp ? await prisma.backtestResult.findFirst({ where: { experimentId: exp.id } }) : null;
    const lpe = exp ? await prisma.loopProcessedEvent.findFirst({
      where: { dedupeKey: { endsWith: exp.id } },
      orderBy: { evaluatedAt: "desc" },
    }) : null;
    console.log(`  cand createdAt=${c.createdAt.toISOString()}`);
    if (exp) {
      console.log(`    experiment: createdAt=${exp.createdAt.toISOString()}, status=${exp.status}`);
    }
    if (bt) {
      console.log(`    backtestResult: createdAt=${bt.createdAt.toISOString()}, score=${bt.overallScore}`);
    }
    if (lpe) {
      console.log(`    loopProcessedEvent: evaluatedAt=${lpe.evaluatedAt.toISOString()}`);
    }
    if (exp && bt) {
      const total = bt.createdAt.getTime() - c.createdAt.getTime();
      console.log(`    TOTAL: ${total}ms`);
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
