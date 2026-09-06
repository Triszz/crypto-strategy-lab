import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const sr = await p.searchRun.findFirst({
    where: { id: "65d89c34-64c4-4602-82ab-aef150f14345" },
  });
  if (!sr) return;
  const cands = await p.candidateStrategy.findMany({
    where: { searchRunId: sr.id },
  });
  for (const c of cands) {
    const sv = await p.strategyVersion.findUnique({
      where: { id: c.strategyVersionId },
      include: {
        definition: true,
        compositeChild: {
          include: {
            componentVersion: { include: { definition: true } },
          },
        },
      },
    });
    if (!sv) continue;
    const compStrs = sv.compositeChild.map(
      (cc) =>
        (cc.componentVersion.definition?.implementationRef ?? "?") + "@w=" + Number(cc.weight).toFixed(2),
    );
    console.log(
      `implRef=${sv.implementationRef}`,
      `name="${sv.name}"`,
      `components=[${compStrs.join(", ")}]`,
    );
  }
  await p.$disconnect();
})();
