import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const candidates = await p.candidateStrategy.findMany({
    where: { searchRunId: "65d89c34-64c4-4602-82ab-aef150f14345" },
    orderBy: { createdAt: "asc" },
  });
  for (const c of candidates) {
    const sv = await p.strategyVersion.findUnique({ where: { id: c.strategyVersionId } });
    if (!sv) continue;
    const components = await p.compositeComponent.findMany({
      where: { compositeVersionId: sv.id },
      orderBy: { position: "asc" },
    });
    const compNames: string[] = [];
    for (const comp of components) {
      const cvs = await p.strategyVersion.findUnique({
        where: { id: comp.componentVersionId },
        include: { definition: true },
      });
      compNames.push(
        (cvs?.definition?.implementationRef ?? "?") + "@w=" + Number(comp.weight).toFixed(2),
      );
    }
    console.log(`${sv.implementationRef.padEnd(42)} name="${sv.name}" components=[${compNames.join(", ")}]`);
  }
  await p.$disconnect();
})();
