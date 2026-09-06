import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  // For each candidate in 65d89c34, verify the component strategy has family=SENTIMENT
  const candidates = await p.candidateStrategy.findMany({
    where: { searchRunId: "65d89c34-64c4-4602-82ab-aef150f14345" },
  });
  for (const c of candidates) {
    const sv = await p.strategyVersion.findUnique({
      where: { id: c.strategyVersionId },
      include: { definition: true },
    });
    const components = await p.compositeComponent.findMany({
      where: { compositeVersionId: sv?.id },
    });
    for (const comp of components) {
      const cvs = await p.strategyVersion.findUnique({
        where: { id: comp.componentVersionId },
        include: { definition: true },
      });
      console.log(
        `parent=${sv?.implementationRef.padEnd(35)} componentImpl=${cvs?.implementationRef.padEnd(28)} family=${cvs?.definition?.family ?? "?"} weight=${Number(comp.weight).toFixed(2)}`
      );
    }
  }
  await p.$disconnect();
})();
