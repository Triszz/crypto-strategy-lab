import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  // For each candidate in 65d89c34, count composite_components
  const cands = await prisma.candidateStrategy.findMany({
    where: { searchRunId: "65d89c34-64c4-4602-82ab-aef150f14345" },
  });
  for (const c of cands) {
    const count = await prisma.compositeComponent.count({
      where: { compositeVersionId: c.strategyVersionId },
    });
    console.log(`cand.strategyVersionId=${c.strategyVersionId.substring(0, 8)}  composite_components_count=${count}`);
  }
  await prisma.$disconnect();
})();
