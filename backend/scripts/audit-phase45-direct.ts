import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const cands = await prisma.candidateStrategy.findMany({
    where: { searchRunId: "65d89c34-64c4-4602-82ab-aef150f14345" },
    orderBy: { createdAt: "asc" },
  });
  for (const c of cands) {
    const sv = await prisma.strategyVersion.findUnique({
      where: { id: c.strategyVersionId },
    });
    console.log(`cand=${c.id.substring(0, 8)} sv.name="${sv?.name}" dnww="${sv?.displayNameWithWeights}"`);
  }
  await prisma.$disconnect();
})();
