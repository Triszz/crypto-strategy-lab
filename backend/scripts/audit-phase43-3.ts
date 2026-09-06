// Audit — list components of iter 1 candidates to see which strategies appear
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const loop = await prisma.loopRunState.findFirst({
    where: { loopId: "combo-6534d9a1-009e-40cb-bcc3-636b2da61a56" },
  });
  if (!loop) { console.log("loop not found"); return; }

  const it1 = await prisma.loopIteration.findFirst({
    where: { loopId: loop.loopId, iterationIndex: 1 },
  });
  if (!it1?.searchRunId) { console.log("no iter1"); return; }

  console.log("SearchRunId=", it1.searchRunId);

  const sr = await prisma.searchRun.findUnique({ where: { id: it1.searchRunId } });
  console.log("\nSearchRun config:");
  console.log(JSON.stringify(sr?.config, null, 2));

  const cands = await prisma.candidateStrategy.findMany({
    where: { searchRunId: it1.searchRunId },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\nFound ${cands.length} candidates for iter 1`);

  for (const c of cands) {
    const sv = await prisma.strategyVersion.findUnique({ where: { id: c.strategyVersionId } });
    const def = sv ? await prisma.strategyDefinition.findUnique({ where: { id: sv.definitionId } }) : null;
    const components = await prisma.compositeComponent.findMany({
      where: { compositeVersionId: sv?.id },
    });
    const strategyIds: string[] = [];
    for (const comp of components) {
      if (!comp.componentVersionId) continue;
      const csv = await prisma.strategyVersion.findUnique({ where: { id: comp.componentVersionId } });
      const csvDef = csv ? await prisma.strategyDefinition.findUnique({ where: { id: csv.definitionId } }) : null;
      strategyIds.push(`${csvDef?.implementationRef ?? "?"}/${csv?.implementationRef ?? "?"}/w=${comp.weight.toFixed(2)}`);
    }
    console.log(`  implRef=${sv?.implementationRef}`);
    console.log(`    components: ${strategyIds.join(" + ")}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
