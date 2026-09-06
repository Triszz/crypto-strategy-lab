// Phase 4.3 audit script — investigates the actual database state
// of the most recent Continuous Loop runs.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n========== LATEST 3 LOOPS ==========\n");
  const loops = await prisma.loopRunState.findMany({
    orderBy: { startedAt: "desc" },
    take: 3,
  });
  for (const loop of loops) {
    console.log(`\nLOOP: ${loop.loopId}`);
    console.log(`  status=${loop.status} curIter=${loop.currentIteration}`);
    console.log(`  bestScore=${loop.bestScoreSoFar} bestSvId=${loop.bestStrategyVersionId?.substring(0, 8)}`);
    console.log(`  startedAt=${loop.startedAt.toISOString()}`);
    console.log(`  updatedAt=${loop.updatedAt.toISOString()}`);

    const iters = await prisma.loopIteration.findMany({
      where: { loopId: loop.loopId },
      orderBy: { iterationIndex: "asc" },
    });
    for (const it of iters) {
      console.log(`\n  ITER ${it.iterationIndex}:`);
      console.log(`    id=${it.id}`);
      console.log(`    searchRunId=${it.searchRunId?.substring(0, 8)}...`);
      console.log(`    parentSv=${it.parentStrategyVersionId?.substring(0, 8)}`);
      console.log(`    bestSvId=${it.bestStrategyVersionId?.substring(0, 8)}`);
      console.log(`    bestScore=${it.bestScore}`);
      console.log(`    candidateCount=${it.candidateCount}`);
      console.log(`    evaluatedCount=${it.evaluatedCount}`);
      console.log(`    createdAt=${it.createdAt.toISOString()}`);
      console.log(`    completedAt=${it.completedAt?.toISOString() ?? "null"}`);

      if (it.searchRunId) {
        const sr = await prisma.searchRun.findUnique({
          where: { id: it.searchRunId },
          select: {
            id: true,
            status: true,
            algorithmId: true,
            createdBy: true,
            createdAt: true,
            config: true,
            maxCandidates: true,
          },
        });
        if (sr) {
          console.log(`    SearchRun:`);
          console.log(`      id=${sr.id.substring(0, 8)}`);
          console.log(`      algorithmId=${sr.algorithmId}`);
          console.log(`      createdBy=${sr.createdBy}`);
          console.log(`      status=${sr.status}`);
          console.log(`      maxCandidates=${sr.maxCandidates}`);
          console.log(`      createdAt=${sr.createdAt.toISOString()}`);
          const cfg = sr.config as any;
          if (cfg?.generatorId) console.log(`      config.generatorId=${cfg.generatorId}`);
          if (cfg?.generatorConfig?.parent?.type) console.log(`      config.generatorConfig.parent.type=${cfg.generatorConfig.parent.type}`);
        }

        const cands = await prisma.candidateStrategy.findMany({
          where: { searchRunId: it.searchRunId },
          take: 15,
        });
        console.log(`    Candidates (showing ${cands.length}):`);
        for (const c of cands) {
          const sv = await prisma.strategyVersion.findUnique({
            where: { id: c.strategyVersionId },
            select: { id: true, implementationRef: true, name: true, indicatorTypeId: true },
          });
          console.log(`      - implRef=${sv?.implementationRef ?? "?"} name=${sv?.displayName ?? "?"} candId=${c.candidateId}`);
        }
      }
    }
  }

  console.log("\n========== STRATEGY REGISTRY (current set) ==========\n");
  const all = await prisma.strategy.findMany({});
  for (const s of all) {
    console.log(`  ${s.id}  family=${s.family ?? "?"}`);
  }

  console.log("\n========== DOMAIN_GUIDED SEARCHES (most recent 5) ==========\n");
  const dgs = await prisma.searchRun.findMany({
    where: { algorithmId: { contains: "domain" } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const sr of dgs) {
    console.log(`  ${sr.id.substring(0, 8)}  algoId=${sr.algorithmId}  createdBy=${sr.createdBy}  createdAt=${sr.createdAt.toISOString()}`);
    const cfg = sr.config as any;
    if (cfg?.familyGroups) {
      console.log(`    familyGroups=${JSON.stringify(cfg.familyGroups)}`);
    }
    if (cfg?.generatorId) {
      console.log(`    config.generatorId=${cfg.generatorId}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
